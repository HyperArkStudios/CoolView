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

use chrono::Local;
use config::Config;
use monitor::Monitor;
use sensors::SensorReader;
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, Runtime,
    WebviewWindow,
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

fn config_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("config.toml")
}

fn log_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_log_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("warnings.log")
}

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
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let contents = toml::to_string_pretty(config)?;
    fs::write(path, contents)?;
    Ok(())
}

fn append_log(app: &AppHandle, message: &str) {
    let path = log_path(app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(&path) {
        let ts = Local::now().format("%Y-%m-%d %H:%M:%S");
        let _ = writeln!(file, "[{ts}] {message}");
    }
}

// Position window in the chosen screen corner.
// Window is always 240x500 — transparent outside HUD content.
fn position_window<R: Runtime>(window: &WebviewWindow<R>, position: &str) {
    if let (Ok(Some(monitor)), Ok(win_size)) = (window.current_monitor(), window.outer_size()) {
        let screen  = monitor.size();
        let scale   = monitor.scale_factor();
        let pad     = (12.0 * scale) as u32;
        let w       = win_size.width;
        let h       = win_size.height;

        let (x, y) = match position {
            "top-left"     => (pad as i32, pad as i32),
            "bottom-right" => ((screen.width  - w - pad) as i32, (screen.height - h - pad) as i32),
            "bottom-left"  => (pad as i32,                        (screen.height - h - pad) as i32),
            _              => ((screen.width  - w - pad) as i32,  pad as i32), // top-right default
        };

        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
}

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
    {
        let mut s = state.lock().unwrap();
        s.config = new_config.clone();
    }
    save_config(&app, &new_config).map_err(|e| e.to_string())?;

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_always_on_top(new_config.display.always_on_top);
        position_window(&window, &new_config.display.position);
    }
    Ok(())
}

fn start_poll_loop(app: AppHandle, state: SharedState) {
    std::thread::spawn(move || {
        let mut reader = SensorReader::new();

        loop {
            let (cfg, monitor_cfg) = {
                let s = state.lock().unwrap();
                (s.config.clone(), s.config.monitor.clone())
            };

            let interval = Duration::from_secs(cfg.thresholds.poll_interval_seconds.max(5));
            let reading  = reader.read();

            let cpu        = if monitor_cfg.cpu        { reading.cpu }        else { 0.0 };
            let gpu        = if monitor_cfg.gpu        { reading.gpu }        else { None };
            let motherboard= if monitor_cfg.motherboard{ reading.motherboard }else { None };

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
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.set_always_on_top(true);
                        let _ = window.set_focus();
                    }
                    #[cfg(not(target_os = "linux"))]
                    {
                        use tauri_plugin_notification::NotificationExt;
                        let _ = app.notification().builder()
                            .title("CoolView ⚠ Temperature Warning")
                            .body(format!(
                                "CPU has been above {:.0}°C — check your cooling!",
                                cfg.thresholds.warning_temp
                            ))
                            .show();
                    }
                } else if just_cleared {
                    drop(s);
                    let _ = app.emit("warning-cleared", ());
                    append_log(&app, &format!("Warning cleared — CPU now {cpu:.1}°C"));
                    if let Some(window) = app.get_webview_window("main") {
                        let state2 = state.lock().unwrap();
                        let _ = window.set_always_on_top(state2.config.display.always_on_top);
                    }
                }
            }

            std::thread::sleep(interval);
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let cfg = load_config(app.handle());
            let state: SharedState = Arc::new(Mutex::new(AppState {
                monitor: Monitor::new(),
                config: cfg.clone(),
            }));

            app.manage(state.clone());

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(cfg.display.always_on_top);
                position_window(&window, &cfg.display.position);
                // No resize — window stays at its configured 240x500 always
            }

            start_poll_loop(app.handle().clone(), state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_config, set_config])
        .run(tauri::generate_context!())
        .expect("error while running CoolView");
}
