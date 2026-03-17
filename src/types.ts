export interface TempPayload {
  cpu: number;
  gpu: number | null;
  motherboard: number | null;
  is_warning: boolean;
  history: number[];
}

export interface Config {
  display: DisplayConfig;
  thresholds: ThresholdConfig;
  monitor: MonitorConfig;
}

export interface DisplayConfig {
  show_sparkline: boolean;
  always_on_top: boolean;
  position: "top-right" | "top-left" | "bottom-right" | "bottom-left";
  unit: "C" | "F";
  launch_at_login: boolean;
}

export interface ThresholdConfig {
  warning_temp: number;   // always °C internally
  warning_duration_seconds: number;
  poll_interval_seconds: number;
}

export interface MonitorConfig {
  cpu: boolean;
  gpu: boolean;
  motherboard: boolean;
}

export interface HistoryEntry {
  timestamp: string;      // "2026-03-17T14:23:45"
  cpu: number;
  gpu: number | null;
  motherboard: number | null;
}
