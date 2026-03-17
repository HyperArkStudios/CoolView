use serde::{Deserialize, Serialize};
use sysinfo::Components;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TempReading {
    pub cpu: f32,
    pub gpu: Option<f32>,
    pub motherboard: Option<f32>,
}

/// Labels that indicate CPU core temperature sensors.
/// sysinfo returns platform-specific strings — we cast a wide net.
const CPU_LABELS: &[&str] = &[
    "cpu",
    "core",
    "package",
    "tctl",   // AMD Tctl (Linux)
    "tdie",   // AMD Tdie
    "k10temp",
    "coretemp",
    "cpu thermal",  // macOS
    "cpu die",
];

/// Labels that indicate GPU sensors.
const GPU_LABELS: &[&str] = &[
    "gpu",
    "amdgpu",
    "nvidia",
    "edge",     // AMD GPU edge temp
    "junction", // AMD GPU junction temp
];

/// Labels that indicate motherboard / ambient sensors.
const MB_LABELS: &[&str] = &[
    "acpitz",   // Linux ACPI thermal zone
    "systin",   // ITE chipset system temp
    "cputin",   // some boards label MB this way
    "ambient",
    "motherboard",
    "system",
    "board",
    "nct",      // Nuvoton chipset prefix
];

fn label_matches(label: &str, keywords: &[&str]) -> bool {
    let lower = label.to_lowercase();
    keywords.iter().any(|kw| lower.contains(kw))
}

/// Return the highest reading from a set of matching components.
fn max_temp_for<'a>(
    components: &'a Components,
    keywords: &[&str],
    exclude: &[&str],
) -> Option<f32> {
    components
        .iter()
        .filter(|c| {
            label_matches(c.label(), keywords)
                && !exclude.iter().any(|ex| c.label().to_lowercase().contains(ex))
        })
        .filter_map(|c| {
            let t = c.temperature();
            if t > 0.0 && t < 120.0 { Some(t) } else { None }
        })
        .reduce(f32::max)
}

pub struct SensorReader {
    components: Components,
}

impl SensorReader {
    pub fn new() -> Self {
        let mut components = Components::new_with_refreshed_list();
        components.refresh();
        SensorReader { components }
    }

    pub fn read(&mut self) -> TempReading {
        self.components.refresh();

        // CPU: highest core or package temp, excluding GPU/MB matches
        let cpu = max_temp_for(&self.components, CPU_LABELS, &["gpu", "acpitz"])
            .unwrap_or(0.0);

        // GPU: exclude CPU labels
        let gpu = max_temp_for(&self.components, GPU_LABELS, &["cpu", "core", "package"]);

        // Motherboard: ACPI or chipset, exclude CPU cores
        let motherboard = max_temp_for(&self.components, MB_LABELS, &["core", "gpu"]);

        TempReading { cpu, gpu, motherboard }
    }
}

impl Default for SensorReader {
    fn default() -> Self {
        Self::new()
    }
}
