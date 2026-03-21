# CoolView — Development Log

## Project Overview
Cross-platform desktop temperature HUD built with Tauri 2, Rust, React, TypeScript.
Displays CPU/GPU/motherboard temps as a floating transparent overlay.
MIT licensed. Repository: github.com/HyperArkStudios/CoolView

---

## Architecture

### Window Strategy (current: two-window)
- `main` window: HUD only. Transparent, 240×64px, no decorations, always-on-top
- `panel` window: Settings or History. Created on demand via `open_panel` Rust
  command. NOT transparent (avoids all compositor ghosting). Positioned above or
  below HUD depending on screen position. Closed by user explicitly.
- URL hash routing: `index.html` = HUD, `index.html#settings` = Settings,
  `index.html#history` = History

### Why two windows?
Single-window approach suffered from an unresolvable X11/WebKit2GTK compositor
ghost bug. See GHOST_BUG_DEBUG_LOG.md for full history.

---

## Known Bugs & Status

### 1. HUD Ghost (OPEN)
**Symptom:** When temps first arrive, "reading…" text persists ghosted beneath
the actual temperature numbers in the same pixel region.

**Root cause:** Identical mechanism to the panel ghost bug. WebKit2GTK on X11
does partial dirty-rect repaints. When React replaces `reading…` with temp
numbers, only the changed pixels are repainted. The old `reading…` pixels remain
in the ARGB surface outside the dirty rect. X11 compositor surfaces them.

**What won't fix it:**
- CSS isolation, z-index, opacity changes (above WebKit compositor layer)
- Window height reduction (ghost is in SAME region as content, not below)
- flushSync (tried — does not work, React 18 scheduler not the cause)
- set_background_color (causes white or black rectangles)

**What might fix it:**
- Force full window repaint on first temp update (via JS resize event trick or
  Tauri window eval)
- CSS `will-change: transform` on the temp container to promote to own layer
- Replace `reading…` with same-size invisible placeholder so no layout shift
  occurs and dirty rect covers the full text area

**Not yet tried:**
- `window.getComputedStyle(el).opacity` trick to force style recalc
- Animating opacity 0→1 on first render (forces full layer repaint)

### 2. Panel Switching Crash (PARTIALLY FIXED)
**Symptom:** Clicking Settings while History open (or vice versa) crashed app.
**Fix applied:** 150ms delay between close and reopen of panel window.
**Status:** Less frequent but may still occur under load. Needs proper fix —
should wait for close event rather than arbitrary sleep.

### 3. Underline on °C button (OPEN)
**Symptom:** Browser default underline appears on unit toggle button.
**Fix attempted:** `textDecoration: "none"` in inline style — insufficient.
**Proper fix:** Global `button { text-decoration: none }` in index.css.

---

## Architecture Decisions

### Transparent Window
- `transparent: true` in tauri.conf.json
- Required for HUD to float over desktop without visible border
- Source of all compositor ghosting issues on Linux X11

### Panel Window NOT Transparent
- Deliberately set `transparent: false` on panel window
- Eliminates all ghost/compositor issues for Settings and History
- Means panel has solid background — acceptable UX tradeoff

### Sensor Reading (Linux)
- Uses `sysinfo` crate reading from `/sys/class/hwmon/`
- CPU temp: coretemp driver, Intel i7-12700H confirmed working
- GPU temp: NOT available on this hardware. Intel Iris Xe GPU temp requires
  kernel ≥ 6.12 (not yet widely available). AMD/Nvidia discrete GPUs work.
- Motherboard: ACPI thermal zone, confirmed working

### Adaptive Polling
- Base interval: user-configured (default 30s)
- Above 70°C: max 20s
- Above 80°C: max 10s
- Never faster than 5s

---

## File Structure

```
src/
  App.tsx              — Hash routing, window type detection
  types.ts             — Shared TypeScript interfaces
  index.css            — Global styles, transparent background
  components/
    HUD.tsx            — Temperature display, drag, unit toggle
    Settings.tsx       — Config panel (runs in panel window)
    History.tsx        — 24h graph + table (runs in panel window)
    Sparkline.tsx      — SVG mini graph

src-tauri/
  src/
    lib.rs             — Main app, commands, poll loop, tray, panel management
    config.rs          — Config struct (TOML)
    sensors.rs         — Cross-platform temp reading via sysinfo
    monitor.rs         — Sustained warning state machine
    main.rs            — Entry point
  capabilities/
    default.json       — Tauri 2 permissions (MUST include "panel" window)
  tauri.conf.json      — Window config, bundle settings
  Cargo.toml           — Rust dependencies

GHOST_BUG_DEBUG_LOG.md  — Detailed history of compositor ghost bug
DEVELOPMENT_LOG.md      — This file
SPEC.md                 — Original product specification
```

---

## Dependency Notes

### Rust
- `tauri` 2.x with `tray-icon` feature
- `tauri-plugin-autostart` — launch at login
- `tauri-plugin-notification` — OS notifications (disabled on Linux)
- `sysinfo` 0.32 — hardware sensor reading
- `chrono` with `clock` feature (NOT `local-offset` — wrong feature name)
- `toml` 0.8 — config file parsing
- `anyhow` — error handling

### Frontend
- React 18, TypeScript, Vite
- `@tauri-apps/api` v2
- No UI framework — all styling is inline React styles

---

## Platform Notes

### Linux (primary dev platform)
- WebKit2GTK 2.50.4, Ubuntu 22.04, X11
- Requires `lm-sensors` for full hardware coverage
- `WEBKIT_DISABLE_DMABUF_RENDERER=1` needed in .bashrc for dev mode
- Compositor ghosting is a known WebKit2GTK + X11 ARGB surface issue
- Notifications disabled on Linux (tauri-plugin-notification unreliable)

### macOS
- Unsigned — Gatekeeper warning expected, right-click → Open
- Homebrew tap planned: `brew install hyperarkstudios/coolview/coolview`

### Windows
- Unsigned — SmartScreen warning expected
- EV certificate (~$300/yr) needed to suppress — not planned for now

---

## Release History

| Tag | Notes |
|-----|-------|
| v0.1.0-alpha | First build attempt — had icons/Cargo issues |
| v0.1.1-alpha | Fixed TypeScript errors, proper build |
| v0.1.2-alpha | Crash fixes, u32 overflow, tray state |
| v0.1.3 (planned) | Two-window architecture, ghost fix |

---

## Donation / Support Links
- Ko-fi: https://ko-fi.com/hyperarkstudios
- GitHub Sponsors: https://github.com/sponsors/HyperArkStudios (pending approval)

---

## Two-Window Architecture (current branch: two-window)

### Why
Single-window approach had an unresolvable X11/WebKit2GTK compositor ghost bug
where clicking buttons inside panels caused ghost HUD pixels to show through
panel backgrounds. After 3 days and ~15 attempted fixes (CSS, Rust, React),
switched to two-window architecture where panels are separate OS windows.

### How it works
- `main` window: HUD only. Transparent, 240×64px. Always-on-top.
- `panel` window: Created on demand by `open_panel` Rust command.
  NOT transparent. Positioned above/below HUD. No always-on-top, no skip-taskbar
  (these caused X11 BadImplementation crashes).
- URL hash routing: `index.html` = HUD, `index.html#settings` = Settings panel,
  `index.html#history` = History panel

### Current Issues

**1. X11 BadImplementation crash (OPEN)**
Intermittent crash after extended use. Likely caused by `startDragging()` in
panel windows interfering with GTK freeze/thaw cycle. See GHOST_BUG_DEBUG_LOG.md.
**Recommended fix: remove startDragging() from panel windows.**

**2. HUD ghost (PARTIALLY FIXED)**
Old temp values ghost under new ones for 90-120 seconds. `willChange: "transform"`
+ `translateZ(0)` partially helps. Root cause: WebKit2GTK ARGB dirty-rect
partial repaint on transparent window. Full fix not yet found.

**3. Settings showing defaults briefly (FIXED)**
Panel window creates own React instance with DEFAULT_CONFIG. Fixed by adding
`useEffect(() => setDraft(config), [config])` in Settings.tsx so draft
re-syncs when async `get_config` resolves.

**4. Config not reloading in HUD after save (FIXED)**  
`w.emit()` targets only that window's JS. Changed to `app.emit()` in set_config
Rust command so HUD window's `listen("config-updated")` handler fires correctly.

**5. Panel switching crash (PARTIALLY FIXED)**
Close+reopen race condition. Added 600ms cooldown debounce in HUD buttons.
`on_window_event` approach caused immediate crash — do not use.

### Key Rules Learned (DO NOT VIOLATE)
- Do NOT use `on_window_event` — causes immediate X11 crash
- Do NOT use `set_background_color` — causes white rectangle
- Do NOT use `always_on_top(true)` or `skip_taskbar(true)` on panel window
- Do NOT use `decorations(false)` alone if it triggers ChangeWindowAttributes
- `w.emit()` targets one window only — use `app.emit()` for cross-window events
- Panel window MUST be listed in `capabilities/default.json` windows array
- `useState` init from prop only runs once — use `useEffect` to sync with async data

### File Locations
- Config: `~/.config/com.coolview.app/config.toml`
- History CSV: `~/.local/share/com.coolview.app/history.csv`  
- Warning log: `~/.local/share/com.coolview.app/logs/warnings.log` (path may vary)

---

## Session Update — X11 Crash Investigation

### startDragging hypothesis DISPROVED
Removed `startDragging()` from all components. Crash persisted immediately
(serial 2745) on first Settings click. Not the cause.

### Current crash understanding
`gdk_window_thaw_toplevel_updates` warning fires at STARTUP before any user
interaction. Crash follows ~11s later on first panel open. Freeze counter is
corrupted during app initialization, not user interaction.

### What CC fixed successfully this session
- **Panel switching crash:** `existing.eval("window.location.hash = ...")` 
  instead of close+reopen. Navigates in-place, no GTK window lifecycle ops.
- **HUD ghost:** `background: "rgba(0,0,0,0.001)"` on content container forces
  WebKit to execute background paint step, zeroing ARGB surface before text draw.
  Ghost now clears within ~30s instead of 90-120s. Still present on first render.

### Standing rule established
**Always update DEVELOPMENT_LOG.md and GHOST_BUG_DEBUG_LOG.md before any CC session.**
These are the source of truth. CC reads them first.

### Next investigation targets
Startup sequence in `lib.rs setup()` — one of these is corrupting freeze counter:
1. `TrayIconBuilder::build()`
2. `position_window()` → `set_position()`
3. `window.set_always_on_top()`
4. `transparent: true` + `always_on_top: true` combination in tauri.conf.json
