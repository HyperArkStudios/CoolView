mod config;
mod monitor;
mod sensors;

use std::{
    fs, io::Write, path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use chrono::{Duration as ChronoDuration, Local};
use config::Config;
use monitor::Monitor;
use sensors::SensorReader;
use sysinfo::{System, ProcessesToUpdate};
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, Runtime, WebviewWindow,
};

struct AppState { config: Config, monitor: Monitor, visible: bool }
type SharedState = Arc<Mutex<AppState>>;

#[derive(Clone, Serialize, Deserialize)]
struct ProcessInfo { name: String, cpu_percent: f32, pid: u32 }

#[derive(Clone, Serialize, Deserialize)]
struct TempPayload {
    cpu: f32, gpu: Option<f32>, motherboard: Option<f32>,
    is_warning: bool, history: Vec<f32>, top_processes: Vec<ProcessInfo>,
}

#[derive(Clone, Serialize, Deserialize)]
struct HistoryEntry {
    timestamp: String, cpu: f32, gpu: Option<f32>,
    motherboard: Option<f32>, top_processes: Vec<ProcessInfo>,
}

// ── Paths ─────────────────────────────────────────────────────────────────────

fn config_path(app: &AppHandle) -> PathBuf {
    app.path().app_config_dir().unwrap_or_default().join("config.toml")
}
fn history_path(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap_or_default().join("history.csv")
}
fn log_path(app: &AppHandle) -> PathBuf {
    app.path().app_log_dir().unwrap_or_default().join("warnings.log")
}

// ── Config ────────────────────────────────────────────────────────────────────

fn load_config(app: &AppHandle) -> Config {
    let path = config_path(app);
    if let Ok(contents) = fs::read_to_string(&path) {
        toml::from_str(&contents).unwrap_or_default()
    } else { Config::default() }
}

fn save_config(app: &AppHandle, config: &Config) -> anyhow::Result<()> {
    let path = config_path(app);
    if let Some(p) = path.parent() { fs::create_dir_all(p)?; }
    fs::write(path, toml::to_string_pretty(config)?)?;
    Ok(())
}

// ── Logging ───────────────────────────────────────────────────────────────────

fn append_log(app: &AppHandle, message: &str) {
    let path = log_path(app);
    if let Some(p) = path.parent() { let _ = fs::create_dir_all(p); }
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "[{}] {}", Local::now().format("%Y-%m-%d %H:%M:%S"), message);
    }
}

fn append_history(app: &AppHandle, cpu: f32, gpu: Option<f32>, mb: Option<f32>) {
    let path = history_path(app);
    if let Some(p) = path.parent() { let _ = fs::create_dir_all(p); }
    let write_header = !path.exists();
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&path) {
        if write_header { let _ = writeln!(f, "timestamp,cpu,gpu,motherboard"); }
        let g_s = gpu.map(|v| format!("{:.1}", v)).unwrap_or_default();
        let m_s = mb.map(|v| format!("{:.1}", v)).unwrap_or_default();
        let _ = writeln!(f, "{},{:.1},{},{}", Local::now().format("%Y-%m-%dT%H:%M:%S"), cpu, g_s, m_s);
    }
}

// ── Window positioning ────────────────────────────────────────────────────────

fn position_window<R: Runtime>(window: &WebviewWindow<R>, position: &str) {
    if let (Ok(Some(monitor)), Ok(win_size)) = (window.current_monitor(), window.outer_size()) {
        let screen = monitor.size();
        let scale  = monitor.scale_factor();
        let pad    = (12.0 * scale) as u32;
        let (x, y) = match position {
            "top-left"     => (pad as i32, pad as i32),
            "bottom-right" => (
                screen.width.saturating_sub(win_size.width.saturating_add(pad)) as i32,
                screen.height.saturating_sub(win_size.height.saturating_add(pad)) as i32,
            ),
            "bottom-left"  => (
                pad as i32,
                screen.height.saturating_sub(win_size.height.saturating_add(pad)) as i32,
            ),
            _ => (
                screen.width.saturating_sub(win_size.width.saturating_add(pad)) as i32,
                pad as i32,
            ),
        };
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
}

// ── Adaptive polling ──────────────────────────────────────────────────────────

fn effective_interval(cpu: f32, base: u64) -> u64 {
    if cpu >= 80.0 { base.min(10) }
    else if cpu >= 70.0 { base.min(20) }
    else { base }
    .max(5)
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
fn get_config(state: tauri::State<SharedState>) -> Config {
    state.lock().unwrap().config.clone()
}

#[tauri::command]
fn get_history(app: AppHandle) -> Vec<HistoryEntry> {
    let path = history_path(&app);
    let Ok(contents) = fs::read_to_string(&path) else { return vec![]; };
    let cutoff = (Local::now() - ChronoDuration::hours(24))
        .format("%Y-%m-%dT%H:%M:%S").to_string();
    contents.lines().skip(1).filter_map(|line| {
        let mut cols = line.splitn(4, ',');
        let ts = cols.next()?.to_string();
        if ts < cutoff { return None; }
        let cpu: f32 = cols.next()?.parse().ok()?;
        let gpu: Option<f32> = cols.next().and_then(|s| s.parse().ok());
        let mb: Option<f32>  = cols.next().and_then(|s| s.parse().ok());
        Some(HistoryEntry { timestamp: ts, cpu, gpu, motherboard: mb, top_processes: vec![] })
    }).collect()
}

#[tauri::command]
fn get_history_path(app: AppHandle) -> String {
    history_path(&app).to_string_lossy().to_string()
}

#[tauri::command]
fn set_config(
    app: AppHandle,
    state: tauri::State<SharedState>,
    new_config: Config,
) -> Result<(), String> {
    let old_pos = state.lock().unwrap().config.display.position.clone();
    let old_launch = state.lock().unwrap().config.display.launch_at_login;
    state.lock().unwrap().config = new_config.clone();
    save_config(&app, &new_config).map_err(|e| e.to_string())?;

    if new_config.display.launch_at_login != old_launch {
        use tauri_plugin_autostart::ManagerExt;
        if new_config.display.launch_at_login {
            let _ = app.autolaunch().enable();
        } else {
            let _ = app.autolaunch().disable();
        }
    }

    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_always_on_top(new_config.display.always_on_top);
        if new_config.display.position != old_pos {
            position_window(&w, &new_config.display.position);
        }
    }
    Ok(())
}

#[tauri::command]
async fn open_panel(app: AppHandle, label: String) {
    // If any panel already open, close it and wait briefly
    if let Some(existing) = app.get_webview_window("panel") {
        let current_url = existing.url()
            .map(|u| u.to_string())
            .unwrap_or_default();
        // Same panel — just focus
        if current_url.contains(&label) {
            let _ = existing.set_focus();
            return;
        }
        // Different panel — close and wait
        let _ = existing.close();
        std::thread::sleep(Duration::from_millis(300));
    }

    let hud = match app.get_webview_window("main") {
        Some(w) => w,
        None => return,
    };

    let pos  = hud.outer_position().unwrap_or_default();
    let size = hud.outer_size().unwrap_or_default();
    let panel_w: f64 = 350.0;
    let panel_h: f64 = 540.0;

    let spawn_y = if let Ok(Some(mon)) = hud.current_monitor() {
        let screen_h = mon.size().height as i32;
        if pos.y > screen_h / 2 {
            pos.y - panel_h as i32 - 8
        } else {
            pos.y + size.height as i32 + 8
        }
    } else {
        pos.y + size.height as i32 + 8
    };

    let spawn_y = spawn_y.max(0) as f64;

    let _ = tauri::WebviewWindowBuilder::new(
        &app,
        "panel",
        tauri::WebviewUrl::App(format!("index.html#{}", label).into()),
    )
    .position(pos.x as f64, spawn_y)
    .inner_size(panel_w, panel_h)
    .transparent(false)
    .resizable(false)
    .build();
}

// ── Poll loop ─────────────────────────────────────────────────────────────────

fn start_poll_loop(app: AppHandle, state: SharedState) {
    std::thread::spawn(move || {
        let mut reader = SensorReader::new();
        let mut last_cpu: f32 = 0.0;

        loop {
            let (cfg, m_cfg) = {
                let s = state.lock().unwrap();
                (s.config.clone(), s.config.monitor.clone())
            };

            let interval = Duration::from_secs(
                effective_interval(last_cpu, cfg.thresholds.poll_interval_seconds)
            );

            let reading = reader.read();
            let cpu = if m_cfg.cpu { reading.cpu } else { 0.0 };
            let gpu = if m_cfg.gpu { reading.gpu } else { None };
            let mb  = if m_cfg.motherboard { reading.motherboard } else { None };
            last_cpu = cpu;

            // Top processes when hot — create System inside the thread
            let top_processes: Vec<ProcessInfo> = if cpu >= 80.0 {
                let mut sys = System::new();
                sys.refresh_processes(ProcessesToUpdate::All, true);
                std::thread::sleep(Duration::from_millis(200));
                sys.refresh_processes(ProcessesToUpdate::All, true);
                let mut procs: Vec<ProcessInfo> = sys.processes().values()
                    .filter(|p| p.cpu_usage() > 0.1)
                    .map(|p| ProcessInfo {
                        name: p.name().to_string_lossy().to_string(),
                        cpu_percent: p.cpu_usage(),
                        pid: p.pid().as_u32(),
                    })
                    .collect();
                procs.sort_by(|a, b| b.cpu_percent.partial_cmp(&a.cpu_percent).unwrap_or(std::cmp::Ordering::Equal));
                procs.truncate(5);
                procs
            } else { vec![] };

            append_history(&app, cpu, gpu, mb);

            let (is_warning, state_changed, history) = {
                let mut s = state.lock().unwrap();
                s.monitor.tick(cpu, &cfg.thresholds)
            };

            let _ = app.emit("temp-update", &TempPayload {
                cpu, gpu, motherboard: mb, is_warning,
                history, top_processes,
            });

            // Warning state transitions
            {
                let s = state.lock().unwrap();
                let triggered = s.monitor.just_triggered(state_changed);
                let cleared   = s.monitor.just_cleared(state_changed);

                if triggered {
                    drop(s);
                    append_log(&app, &format!("WARNING triggered — CPU {cpu:.1}°C"));
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.set_always_on_top(true);
                        let _ = w.set_focus();
                    }
                    #[cfg(not(target_os = "linux"))]
                    {
                        use tauri_plugin_notification::NotificationExt;
                        let _ = app.notification().builder()
                            .title("CoolView ⚠ Temperature Warning")
                            .body(format!("CPU above {:.0}°C — check your cooling!", cfg.thresholds.warning_temp))
                            .show();
                    }
                } else if cleared {
                    drop(s);
                    append_log(&app, &format!("Warning cleared — CPU now {cpu:.1}°C"));
                    if let Some(w) = app.get_webview_window("main") {
                        let pref = state.lock().unwrap().config.display.always_on_top;
                        let _ = w.set_always_on_top(pref);
                    }
                }
            }

            std::thread::sleep(interval);
        }
    });
}

// ── App entry ─────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .setup(|app| {
            let cfg = load_config(app.handle());
            let state: SharedState = Arc::new(Mutex::new(AppState {
                monitor: Monitor::new(),
                config: cfg.clone(),
                visible: true,
            }));
            app.manage(state.clone());

            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_always_on_top(cfg.display.always_on_top);
                position_window(&w, &cfg.display.position);
            }

            // Tray
            let tray_state = state.clone();
            let show = MenuItemBuilder::with_id("show", "Show / Hide").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit CoolView").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;
            let icon = app.default_window_icon().cloned().expect("icon required");

            TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .tooltip("CoolView")
                .on_menu_event(move |app: &AppHandle, event: tauri::menu::MenuEvent| {
                    match event.id().as_ref() {
                        "quit" => app.exit(0),
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let mut s = tray_state.lock().unwrap();
                                if s.visible { let _ = w.hide(); s.visible = false; }
                                else { let _ = w.show(); let _ = w.set_focus(); s.visible = true; }
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray: &tauri::tray::TrayIcon, event: TrayIconEvent| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up, ..
                    } = event {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let visible = w.is_visible().unwrap_or(true);
                            if visible { let _ = w.hide(); } else { let _ = w.show(); }
                        }
                    }
                })
                .build(app)?;

            start_poll_loop(app.handle().clone(), state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config, set_config, get_history, get_history_path, open_panel
        ])
        .run(tauri::generate_context!())
        .expect("error while running CoolView");
}
