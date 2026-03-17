mod config;
mod monitor;
mod sensors;

use std::{
    fs,
    io::Write,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

use chrono::{Duration as ChronoDuration, Local};
use config::Config;
use monitor::Monitor;
use sensors::SensorReader;
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, Runtime, WebviewWindow,
};

struct AppState {
    config: Config,
    monitor: Monitor,
}

type SharedState = Arc<Mutex<AppState>>;

#[derive(Clone, Serialize, Deserialize)]
struct TempPayload {
    cpu: f32,
    gpu: Option<f32>,
    motherboard: Option<f32>,
    is_warning: bool,
    history: Vec<f32>,
}

#[derive(Clone, Serialize, Deserialize)]
struct HistoryEntry {
    timestamp: String,
    cpu: f32,
    gpu: Option<f32>,
    motherboard: Option<f32>,
}

// ── Paths ─────────────────────────────────────────────────────────────────────

fn config_path(app: &AppHandle) -> PathBuf {
    app.path().app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("config.toml")
}

fn log_path(app: &AppHandle) -> PathBuf {
    app.path().app_log_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("warnings.log")
}

fn history_path(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("history.csv")
}

// ── Config load/save ──────────────────────────────────────────────────────────

fn load_config(app: &AppHandle) -> Config {
    let path = config_path(app);
    if let Ok(contents) = fs::read_to_string(&path) {
        toml::from_str(&contents).unwrap_or_default()
    } else {
        Config::default()
    }
}

fn save_config(app: &AppHandle, config: &Config) -> anyhow::Result<()> {
    let path = config_path(app);
    if let Some(parent) = path.parent() { fs::create_dir_all(parent)?; }
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

fn append_history(app: &AppHandle, cpu: f32, gpu: Option<f32>, motherboard: Option<f32>) {
    let path = history_path(app);
    if let Some(p) = path.parent() { let _ = fs::create_dir_all(p); }
    let write_header = !path.exists();
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&path) {
        if write_header {
            let _ = writeln!(f, "timestamp,cpu,gpu,motherboard");
        }
        let gpu_s = gpu.map(|v| format!("{:.1}", v)).unwrap_or_default();
        let mb_s  = motherboard.map(|v| format!("{:.1}", v)).unwrap_or_default();
        let _ = writeln!(f, "{},{:.1},{},{}", Local::now().format("%Y-%m-%dT%H:%M:%S"), cpu, gpu_s, mb_s);
    }
}

// ── Window positioning ────────────────────────────────────────────────────────

fn position_window<R: Runtime>(window: &WebviewWindow<R>, position: &str) {
    if let (Ok(Some(monitor)), Ok(win_size)) = (window.current_monitor(), window.outer_size()) {
        let screen = monitor.size();
        let scale  = monitor.scale_factor();
        let pad    = (12.0 * scale) as u32;
        let w      = win_size.width;
        let h      = win_size.height;
        let (x, y) = match position {
            "top-left"     => (pad as i32,                        pad as i32),
            "bottom-right" => ((screen.width - w - pad) as i32,  (screen.height - h - pad) as i32),
            "bottom-left"  => (pad as i32,                        (screen.height - h - pad) as i32),
            _              => ((screen.width - w - pad) as i32,   pad as i32),
        };
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
}

// ── Adaptive polling interval ─────────────────────────────────────────────────
// User's configured interval is the *maximum* (used when cool).
// Automatically tightens as temps rise.

fn effective_interval(cpu: f32, base: u64) -> u64 {
    if cpu >= 80.0 {
        base.min(10)
    } else if cpu >= 70.0 {
        base.min(20)
    } else {
        base
    }.max(5) // never faster than 5s regardless
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
fn get_config(state: tauri::State<SharedState>) -> Config {
    state.lock().unwrap().config.clone()
}

#[tauri::command]
fn set_config(
    app: AppHandle,
    state: tauri::State<SharedState>,
    new_config: Config,
) -> Result<(), String> {
    let old_launch = state.lock().unwrap().config.display.launch_at_login;
    state.lock().unwrap().config = new_config.clone();
    save_config(&app, &new_config).map_err(|e| e.to_string())?;

    // Toggle autolaunch if changed
    if new_config.display.launch_at_login != old_launch {
        use tauri_plugin_autostart::ManagerExt;
        if new_config.display.launch_at_login {
            let _ = app.autolaunch().enable();
        } else {
            let _ = app.autolaunch().disable();
        }
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_always_on_top(new_config.display.always_on_top);
        position_window(&window, &new_config.display.position);
    }
    Ok(())
}

#[tauri::command]
fn get_history(app: AppHandle) -> Vec<HistoryEntry> {
    let path = history_path(&app);
    let Ok(contents) = fs::read_to_string(&path) else { return vec![]; };

    // Cutoff string — ISO format sorts lexicographically so string compare works
    let cutoff = (Local::now() - ChronoDuration::hours(24))
        .format("%Y-%m-%dT%H:%M:%S").to_string();

    contents.lines().skip(1) // skip CSV header
        .filter_map(|line| {
            let mut cols = line.splitn(4, ',');
            let ts  = cols.next()?;
            if ts < cutoff.as_str() { return None; }
            let cpu: f32       = cols.next()?.parse().ok()?;
            let gpu: Option<f32>         = cols.next().and_then(|s| s.parse().ok());
            let motherboard: Option<f32> = cols.next().and_then(|s| s.parse().ok());
            Some(HistoryEntry { timestamp: ts.to_string(), cpu, gpu, motherboard })
        })
        .collect()
}

#[tauri::command]
fn get_history_path(app: AppHandle) -> String {
    history_path(&app).to_string_lossy().to_string()
}

// ── Poll loop ─────────────────────────────────────────────────────────────────

fn start_poll_loop(app: AppHandle, state: SharedState) {
    std::thread::spawn(move || {
        let mut reader = SensorReader::new();
        let mut last_cpu: f32 = 0.0;

        loop {
            let (cfg, monitor_cfg) = {
                let s = state.lock().unwrap();
                (s.config.clone(), s.config.monitor.clone())
            };

            // Adaptive interval based on LAST reading (so we react quickly)
            let interval = Duration::from_secs(
                effective_interval(last_cpu, cfg.thresholds.poll_interval_seconds)
            );

            let reading = reader.read();
            let cpu         = if monitor_cfg.cpu         { reading.cpu }         else { 0.0 };
            let gpu         = if monitor_cfg.gpu         { reading.gpu }         else { None };
            let motherboard = if monitor_cfg.motherboard { reading.motherboard } else { None };
            last_cpu = cpu;

            // Record to all-time CSV
            append_history(&app, cpu, gpu, motherboard);

            let (is_warning, state_changed, history) = {
                let mut s = state.lock().unwrap();
                s.monitor.tick(cpu, &cfg.thresholds)
            };

            let _ = app.emit("temp-update", &TempPayload {
                cpu, gpu, motherboard, is_warning, history,
            });

            {
                let s = state.lock().unwrap();
                let just_triggered = s.monitor.just_triggered(state_changed);
                let just_cleared   = s.monitor.just_cleared(state_changed);

                if just_triggered {
                    drop(s);
                    let _ = app.emit("warning-triggered", ());
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
                } else if just_cleared {
                    drop(s);
                    let _ = app.emit("warning-cleared", ());
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
            }));
            app.manage(state.clone());

            // Position window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(cfg.display.always_on_top);
                position_window(&window, &cfg.display.position);
            }

            // System tray
            let quit = MenuItemBuilder::with_id("quit", "Quit CoolView").build(app)?;
            let show = MenuItemBuilder::with_id("show", "Show / Hide").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;
            let icon = app.default_window_icon().cloned()
                .expect("No default icon — ensure icons are configured in tauri.conf.json");

            TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .tooltip("CoolView")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "quit" => app.exit(0),
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(true) {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up, ..
                    } = event {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(true) {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            start_poll_loop(app.handle().clone(), state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config, set_config, get_history, get_history_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running CoolView");
}
