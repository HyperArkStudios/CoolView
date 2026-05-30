# CoolView — Project TLDR

## What It Is
A cross-platform desktop temperature HUD built with **Tauri 2 + Rust + React + TypeScript**.
Displays CPU/GPU/motherboard temps as a floating transparent overlay on the desktop.
MIT licensed. Repo: github.com/HyperArkStudios/CoolView
Ko-fi: ko-fi.com/hyperarkstudios

## Current Architecture (branch: two-window)
- **main window**: HUD only. Transparent, ~240×64px, no decorations, always-on-top.
  Shows temp readings floating over desktop. Draggable.
- **panel window**: Pre-created hidden at startup. Shown for Settings or History.
  NOT transparent. Positioned above/below HUD based on screen position.
  Uses URL hash routing: `index.html#settings` or `index.html#history`
- Panel navigates in-place via `eval("window.location.hash = ...")` — avoids
  GTK window lifecycle operations which cause crashes

## Key Files
- `src-tauri/src/lib.rs` — Rust backend (commands, poll loop, tray, window management)
- `src-tauri/src/main.rs` — Entry point, calls XInitThreads() on Linux
- `src/App.tsx` — Hash routing, HUD vs panel window detection
- `src/components/HUD.tsx` — Temp display, drag, unit toggle
- `src/components/Settings.tsx` — Config panel
- `src/components/History.tsx` — 24h graph + table
- `src-tauri/capabilities/default.json` — MUST include "panel" in windows array
- `src-tauri/tauri.conf.json` — Window config
- `GHOST_BUG_DEBUG_LOG.md` — Full history of compositor ghost bug
- `DEVELOPMENT_LOG.md` — Architecture decisions and rules

## Features Working ✓
- Frosted-glass HUD with CPU/GPU/MB temps, colour-coded by threshold
- Adaptive polling (base → 20s above 70°C → 10s above 80°C)
- Sustained warning system with configurable threshold + duration
- °C/°F toggle, sparkline, always-on-top option
- Settings panel: all thresholds, display, sensor toggles, position, autolaunch
- History panel: 24h graph + table, CSV export path shown
- System tray (show/hide, quit)
- HUD drag via startDragging()
- Config persists to ~/.config/com.coolview.app/config.toml
- HUD starts hidden (opacity 0) until position is calculated, then fades in — no centre-flash on startup
- HUD position on startup respects user's saved position preference (top-right/left, bottom-right/left)

## CRITICAL RULES — DO NOT VIOLATE
1. ALL GTK window operations from background threads MUST use app.run_on_main_thread()
   This includes: set_always_on_top, set_focus, set_position, WebviewWindowBuilder::build()
   Violating this causes incremental GDK state corruption → X11 BadImplementation crash
2. Do NOT use on_window_event — causes immediate X11 crash
3. Do NOT use set_background_color — causes white or black rectangles
4. Do NOT use always_on_top(true) or skip_taskbar(true) on panel window — causes crash
5. w.emit() targets one window only — use app.emit() for cross-window events
6. Panel window MUST be listed in capabilities/default.json windows array
7. useState init from prop only runs once — use useEffect to sync with async data
8. XInitThreads() must be called in main.rs before anything else on Linux
9. Panel uses hide()/show() NOT close()/build() — pre-created at startup, never destroyed
10. Always update DEVELOPMENT_LOG.md and GHOST_BUG_DEBUG_LOG.md before any CC session
11. Do NOT use visible:false in tauri.conf.json — corrupts GTK freeze counter on X11, window never appears
12. Do NOT call position_window(), set_position(), current_monitor(), or outer_size() from Rust at startup
    All HUD positioning must be done from the frontend (App.tsx initHUD) after window is realized
13. HUD startup positioning: fetch config first via invoke("get_config"), THEN calculate position and
    call setPosition — never depend on React config state which starts as DEFAULT_CONFIG

## Current Open Bugs

### 1. HUD ghost (partially fixed)
background: rgb(14,14,20) + will-change:transform + translateZ(0)
on content container helps. Clears within ~30s. Still on first render.

### 2. Excessive whitespace in panel window (cosmetic)
Panel window is too large for content. Needs size tuning.

## What Was Just Tried (don't repeat these)
- visible:false in tauri.conf.json — corrupts GTK freeze counter, window never appears
- win.show() after setPosition with visible:false — same GTK corruption
- Two separate effects for get_config and positionHUD — race condition, wrong position on startup
- Hardcoding x/y in tauri.conf.json — breaks on non-1920x1080 screens

## Immediate Next Steps
- Monitor stability of v0.2.0 in daily use
- Address panel whitespace (cosmetic)
- Address HUD ghost on first render
