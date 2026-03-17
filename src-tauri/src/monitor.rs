use std::collections::VecDeque;
use crate::config::ThresholdConfig;

/// Maximum number of history points to keep for the sparkline (20 readings).
const HISTORY_CAP: usize = 20;

#[derive(Debug, Clone, PartialEq)]
pub enum WarningState {
    Normal,
    Warning,
}

pub struct Monitor {
    /// Rolling history of the hottest CPU reading at each poll tick.
    history: VecDeque<f32>,
    /// How many consecutive readings have been at or above the threshold.
    consecutive_hot: u32,
    pub state: WarningState,
}

impl Monitor {
    pub fn new() -> Self {
        Monitor {
            history: VecDeque::with_capacity(HISTORY_CAP),
            consecutive_hot: 0,
            state: WarningState::Normal,
        }
    }

    /// Call once per poll tick.
    /// Returns (is_warning, state_changed, history_snapshot).
    pub fn tick(
        &mut self,
        cpu_temp: f32,
        cfg: &ThresholdConfig,
    ) -> (bool, bool, Vec<f32>) {
        // Update history ring buffer
        if self.history.len() >= HISTORY_CAP {
            self.history.pop_front();
        }
        self.history.push_back(cpu_temp);

        // How many consecutive readings are needed to trigger?
        let readings_needed = (cfg.warning_duration_seconds
            / cfg.poll_interval_seconds.max(1))
        .max(1) as u32;

        let was_warning = self.state == WarningState::Warning;

        if cpu_temp >= cfg.warning_temp {
            self.consecutive_hot += 1;
        } else {
            self.consecutive_hot = 0;
        }

        let is_warning = self.consecutive_hot >= readings_needed;
        self.state = if is_warning {
            WarningState::Warning
        } else {
            WarningState::Normal
        };

        let state_changed = was_warning != is_warning;
        let history: Vec<f32> = self.history.iter().copied().collect();

        (is_warning, state_changed, history)
    }

    /// Returns true if warning just triggered (Normal → Warning transition).
    pub fn just_triggered(&self, state_changed: bool) -> bool {
        state_changed && self.state == WarningState::Warning
    }

    /// Returns true if warning just cleared (Warning → Normal transition).
    pub fn just_cleared(&self, state_changed: bool) -> bool {
        state_changed && self.state == WarningState::Normal
    }
}

impl Default for Monitor {
    fn default() -> Self {
        Self::new()
    }
}
