# CoolView 🌡️

A lightweight, cross-platform desktop temperature HUD. Sits quietly in the corner of your screen showing CPU/GPU/motherboard temps. Jumps to your attention if things get dangerously hot.

![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Frosted-glass HUD** — unobtrusive overlay in the corner of your screen
- **Sustained warning system** — alerts you only when temps stay high, not on brief spikes
- **Force-to-top on warning** — you will not miss it
- **Toggleable sparkline** — mini temperature history graph
- **Configurable** — thresholds, intervals, sensors, and display all adjustable
- **Tiny footprint** — ~10MB binary, minimal CPU/RAM usage

## Install

### Linux
Download the `.deb` or `.tar.gz` from [Releases](../../releases).
```bash
sudo dpkg -i coolview_0.1.0_amd64.deb
# or extract the tarball and run the binary
```
**Requires:** `lm-sensors` for full hardware coverage (`sudo apt install lm-sensors && sudo sensors-detect`)

### macOS
Download the `.dmg` from [Releases](../../releases).  
> ⚠️ The app is currently unsigned. macOS will show a Gatekeeper warning. To open: right-click the app → Open → Open anyway.

Or via Homebrew tap:
```bash
brew install growlinghuel/coolview/coolview
```

### Windows
Download the `.exe` installer from [Releases](../../releases).  
> ⚠️ Windows SmartScreen may warn about an unknown publisher. Click "More info" → "Run anyway". This is expected for open-source apps without an EV certificate.

## Usage

CoolView starts as a small frosted-glass panel in the top-right corner of your screen.

- **Hover** the panel to reveal the settings gear icon
- **Click the gear** to open settings
- **Warning state** triggers when your hottest CPU core stays above the threshold for the configured duration — the panel turns red and forces itself to the front of your screen

## Configuration

Settings are stored at:
- **Linux:** `~/.config/coolview/config.toml`
- **macOS:** `~/Library/Application Support/coolview/config.toml`
- **Windows:** `%APPDATA%\coolview\config.toml`

You can edit this file directly:

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

Warning events are logged to:
- **Linux:** `~/.local/share/coolview/logs/warnings.log`
- **macOS:** `~/Library/Logs/coolview/warnings.log`
- **Windows:** `%APPDATA%\coolview\logs\warnings.log`

## Building from Source

**Prerequisites:**
- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) 18+
- Linux only: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`

```bash
git clone https://github.com/growlinghuel/coolview
cd coolview
npm install
npm run tauri dev     # development
npm run tauri build   # production build
```

## Support the Project

CoolView is free, open source, and always will be. If it's useful to you:

- ⭐ Star the repo
- ☕ [Buy me a coffee](https://ko-fi.com/growlinghuel)
- 💖 [GitHub Sponsors](https://github.com/sponsors/growlinghuel)

## License

MIT — see [LICENSE](LICENSE)
