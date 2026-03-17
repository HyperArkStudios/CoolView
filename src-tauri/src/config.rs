use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub display: DisplayConfig,
    pub thresholds: ThresholdConfig,
    pub monitor: MonitorConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplayConfig {
    pub show_sparkline: bool,
    pub always_on_top: bool,
    pub position: String,
    pub unit: String,
    pub launch_at_login: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThresholdConfig {
    pub warning_temp: f32,      // always stored in °C
    pub warning_duration_seconds: u64,
    pub poll_interval_seconds: u64, // user's chosen base interval
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorConfig {
    pub cpu: bool,
    pub gpu: bool,
    pub motherboard: bool,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            display: DisplayConfig {
                show_sparkline: false,
                always_on_top: true,
                position: "top-right".to_string(),
                unit: "C".to_string(),
                launch_at_login: false,
            },
            thresholds: ThresholdConfig {
                warning_temp: 85.0,
                warning_duration_seconds: 180,
                poll_interval_seconds: 30,
            },
            monitor: MonitorConfig {
                cpu: true,
                gpu: true,
                motherboard: true,
            },
        }
    }
}
