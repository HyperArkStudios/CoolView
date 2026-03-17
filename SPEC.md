# CoolView — Product Specification

**Version:** 0.1.0  
**License:** MIT  
**Stack:** Tauri 2 · Rust · React · TypeScript

---

## Overview

CoolView is a lightweight, cross-platform desktop HUD that monitors CPU, GPU, and motherboard temperatures in real time. It sits in the corner of your screen as a frosted-glass overlay showing current temps. If temperatures remain critically high for a sustained period, it escalates to a full-screen-priority warning that cannot be missed.

---

## Core Features

### 1. Temperature Monitoring
- Polls CPU cores, GPU, and motherboard/ambient sensors every 30 seconds (configurable)
- Uses `sysinfo` Rust crate for cross-platform sensor access:
  - **Linux:** reads from `/sys/class/hwmon/` via sysinfo
  - **macOS:** IOKit / SMC via sysinfo
  - **Windows:** WMI via sysinfo
- Displays highest reading per sensor group (e.g. hottest CPU core)

### 2. The HUD
- Semi-transparent frosted-glass panel, no window decorations
- Positioned top-right by default (configurable)
- Displays: `CPU 62°C  GPU 55°C  MB 41°C`
- Temperature colour coding:
  - **Cool (< 70°C):** white/grey text
  - **Warm (70–84°C):** amber text
  - **Hot (≥ 85°C):** red text
- Always-on-top: user-configurable (default: on)
- Toggleable sparkline showing last 20 readings

### 3. Sustained Warning System
- Tracks a rolling window of readings equal to `warning_duration / poll_interval`
- **Default:** warn if CPU stays ≥ 85°C for 3 minutes (6 consecutive 30s readings)
- Warning trigger:
  - HUD background turns vivid red with pulsing animation
  - Warning text: "⚠ Temps consistently too high — cool your machine!"
  - Window is **force-set to always-on-top** regardless of user preference
  - OS notification fired via Tauri notification plugin
- Warning clears automatically when temps drop below threshold
- Every warning trigger and clear is written to a log file

### 4. Settings
- Accessible by hovering the HUD (gear icon appears) then clicking
- HUD window expands to show settings panel in-place
- Settings:
  - Warning temperature threshold (°C)
  - Warning duration (minutes)
  - Poll interval (seconds)
  - Always on top (toggle)
  - Show sparkline (toggle)
  - Temperature unit (°C / °F)
  - Which sensors to display (CPU / GPU / Motherboard)
- All settings persisted to `config.toml` in platform app config dir
- Config file is also hand-editable (TOML format, well-commented)

---

## Temperature Reference

| Zone | Range | Meaning |
|------|-------|---------|
| Safe | < 70°C | Normal under light load |
| Warm | 70–84°C | Normal under heavy load |
| Warning | 85–89°C | Concerning if sustained |
| Throttle risk | 90–94°C | CPU may throttle |
| Danger | ≥ 95°C | Long-term degradation risk |

**Default warning threshold: 85°C sustained for 3 minutes.**  
This catches real thermal problems without false-alarming on compile spikes.

---

## Default Config (`config.toml`)

```toml
[display]
show_sparkline = false
always_on_top = true
position = "top-right"   # top-right | top-left | bottom-right | bottom-left
unit = "C"               # C | F

[thresholds]
warning_temp = 85
warning_duration_seconds = 180
poll_interval_seconds = 30

[monitor]
cpu = true
gpu = true
motherboard = true
```

---

## Window Behaviour

| State | Always On Top | Appearance |
|-------|--------------|------------|
| Normal | User preference | Frosted glass, small pill |
| Warning | **Forced ON** (overrides user pref) | Red background, pulsing |
| Warning cleared | Restored to user preference | Returns to normal |

---

## Platform Notes

### Linux
- Requires `lm-sensors` installed for full hardware sensor coverage
- Transparent windows work on compositing WMs (KDE, GNOME with compositor, i3+picom)
- Frosted glass is CSS `backdrop-filter` (compositor required)

### macOS
- Transparent window + CSS backdrop-filter works natively
- Unsigned `.dmg` will show Gatekeeper warning until notarized ($99/yr Apple dev account)

### Windows
- Unsigned `.exe` will show SmartScreen warning (acceptable for open-source, document in README)
- CSS backdrop-filter works on Windows 10/11 with hardware acceleration

---

## Distribution

| Channel | Platform | Notes |
|---------|----------|-------|
| GitHub Releases | All | Primary channel. Auto-built by CI. |
| Personal Homebrew tap | macOS | `brew install username/coolview/coolview` |
| `.deb` in Releases | Linux | `sudo dpkg -i coolview.deb` |
| `.exe` installer in Releases | Windows | SmartScreen warning expected |

---

## Repo Structure

```
coolview/
├── src/                        # React/TS frontend
│   ├── components/
│   │   ├── HUD.tsx             # Main overlay component
│   │   ├── Settings.tsx        # Settings panel
│   │   └── Sparkline.tsx       # SVG temperature graph
│   ├── App.tsx
│   ├── types.ts
│   ├── main.tsx
│   └── index.css
├── src-tauri/                  # Rust backend
│   ├── src/
│   │   ├── lib.rs              # App setup, commands, event loop
│   │   ├── main.rs             # Entry point
│   │   ├── sensors.rs          # Cross-platform temp reading
│   │   ├── monitor.rs          # Sustained warning logic
│   │   └── config.rs           # Config struct + load/save
│   ├── Cargo.toml
│   ├── build.rs
│   └── tauri.conf.json
├── .github/workflows/
│   └── release.yml             # CI: build all 3 platforms on tag push
├── SPEC.md
├── README.md
├── LICENSE
├── package.json
└── vite.config.ts
```

---

## Future Roadmap (post v0.1)

- Fan speed display
- Per-sensor custom thresholds
- macOS notarization (when there's community demand)
- Tray icon with quick-dismiss
- System startup / autolaunch option
- Temperature history export (CSV)
