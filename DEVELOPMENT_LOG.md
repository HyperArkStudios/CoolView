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

### 1. HUD Ghost (RESOLVED v0.1.5)
**Symptom:** When temps first arrive, "reading…" text persists ghosted beneath
the actual temperature numbers in the same pixel region.

**Fix applied:** Added `background: "rgb(14,14,20)"` (fully opaque) to the HUD
content pill container. This forces WebKit to paint a background before text,
zeroing out ghost pixels from previous frames. The pill now has a solid dark
background — no transparent ARGB surface in the content area.

**Why it works:** WebKit2GTK's ARGB surface uses Porter-Duff "over" compositing.
Transparent pixels accumulate old content. An opaque background forces a clear
step before each paint, eliminating accumulation.

### 2. Panel Switching (FIXED)
Panel navigates in-place via `eval("window.location.hash = '...'; reload()")`.
No GTK window lifecycle operations. No race condition.

### 3. Settings showing defaults briefly (FIXED)
`useEffect(() => setDraft(config), [config])` in Settings.tsx re-syncs draft
when async `get_config` resolves.

### 4. Config not reloading in HUD after save (FIXED)
`app.emit()` instead of `w.emit()` in set_config Rust command.

### 5. Double HUD on startup (FIXED v0.1.5)
See critical fix section below.

---

## Architecture Decisions

### Transparent Window
- `transparent: true` in tauri.conf.json
- Required for HUD to float over desktop without visible border
- Source of all compositor ghosting issues on Linux X11

### HUD Content Pill
- Dark opaque background `rgb(14,14,20)` on content container only
- Window remains transparent — desktop shows through around the pill
- Eliminates ghost rendering without losing the floating aesthetic
- Works identically on all three platforms

### Panel Window NOT Transparent
- `transparent: false` on panel window
- Eliminates all ghost/compositor issues for Settings and History

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

### Initial Window Position
- Set statically in tauri.conf.json (`x: 1400, y: 12`)
- Do NOT call position_window() at startup — causes GTK freeze corruption
- Users can drag HUD to any position; returns to default on next launch
- Position persistence is a known limitation (see below)

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
    main.rs            — Entry point (calls XInitThreads() on Linux)
  capabilities/
    default.json       — Tauri 2 permissions (MUST include "panel" window)
  tauri.conf.json      — Window config, bundle settings
  Cargo.toml           — Rust dependencies

GHOST_BUG_DEBUG_LOG.md  — Detailed history of compositor ghost bug
DEVELOPMENT_LOG.md      — This file
SPEC.md                 — Original product specification
TLDR.md                 — Quick context summary for new AI sessions
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

### Windows
- Unsigned — SmartScreen warning expected

---

## Release History

| Tag | Notes |
|-----|-------|
| v0.1.0-alpha | First build attempt — had icons/Cargo issues |
| v0.1.1-alpha | Fixed TypeScript errors, proper build |
| v0.1.2-alpha | Crash fixes, u32 overflow, tray state |
| v0.1.3-alpha | Two-window architecture, hide_panel command |
| v0.1.4-alpha | Button layout, getCurrentWebviewWindow import fix |
| v0.1.5-alpha | CRITICAL: double HUD fix, position via tauri.conf.json |

---

## Donation / Support Links
- Ko-fi: https://ko-fi.com/hyperarkstudios
- GitHub Sponsors: https://github.com/sponsors/HyperArkStudios (pending approval)

---

## CRITICAL RULES — DO NOT VIOLATE

1. **Never call position_window(), set_position(), current_monitor(), or
   outer_size() during app startup or from any deferred block.**
   These touch GTK's freeze/thaw cycle and corrupt the counter → double window.
   All window geometry MUST be set via tauri.conf.json at creation time.

2. **All GTK window operations from background threads or command handlers
   MUST use `app.run_on_main_thread()`.**
   This includes: set_always_on_top, set_focus, WebviewWindowBuilder::build().

3. **Do NOT use `on_window_event`** — causes immediate X11 crash.

4. **Do NOT use `set_background_color`** — causes white or black rectangles.

5. **Do NOT use `always_on_top(true)` or `skip_taskbar(true)` on panel window**
   at runtime — causes X11 BadImplementation crash.

6. **`w.emit()` targets one window only** — use `app.emit()` for cross-window events.

7. **Panel window MUST be listed in `capabilities/default.json` windows array.**

8. **`useState` init from prop only runs once** — use `useEffect` to sync with
   async data.

9. **`XInitThreads()` must be called in main.rs before anything else on Linux.**
   Use `#[link(name = "X11")]` to link against libX11.

10. **Panel uses hide()/show() NOT close()/build()** — panel created on demand,
    hidden via hide_panel command, never destroyed until app exits.

11. **Always update DEVELOPMENT_LOG.md and GHOST_BUG_DEBUG_LOG.md before any
    CC session.** These are the source of truth.

---

## CRITICAL FIX — Double Window & GTK Freeze Counter (v0.1.5)

### The Problem
Every launch produced two HUD windows. The `gdk_window_thaw_toplevel_updates`
warning fired on every startup. After extended use, clicking Settings caused
an X11 `BadImplementation` crash.

### Root Cause (final, confirmed)
`position_window()` was being called from a deferred `thread::spawn` +
`run_on_main_thread` block after startup. This call chain:
`position_window()` → `current_monitor()` + `outer_size()` + `set_position()`
touches GTK's internal resize/layout machinery. Even with `run_on_main_thread`,
this was still triggering `gdk_window_thaw_toplevel_updates` — corrupting the
GDK freeze counter to -1.

The corrupted counter caused Tauri/GTK to create a ghost second window as a
side effect. This ghost window loaded `index.html` without a hash, defaulted
to HUD view, and appeared as a second HUD on screen for 30-120 seconds.

### What Was Tried (all failed)
- Wrapping `set_always_on_top` in `run_on_main_thread` — still corrupted
- Wrapping `position_window` in `run_on_main_thread` — still corrupted
- Increasing delay from 100ms → 200ms → 500ms — still corrupted
- Removing `alwaysOnTop` from tauri.conf.json — reduced but ghost persisted
- Removing `set_always_on_top` from deferred block — still corrupted
- Pre-creating panel window hidden at startup — `visible(false)` ignored by GTK
- Setting `transparent: false` — fixed double window but created white rectangle
- Positioning panel off-screen at -1000,-1000 — wrong approach

### The Fix That Worked
**Remove the deferred block entirely. Set initial position statically in
tauri.conf.json.**

```json
{
  "x": 1400,
  "y": 12,
  "alwaysOnTop": true,
  "transparent": true
}
```

### Why This Works
- `tauri.conf.json` window properties are applied by the OS window manager
  BEFORE GTK initializes the window. No GTK calls are made at runtime.
- The freeze counter is never touched during initialization.
- No `position_window()`, no `set_always_on_top()`, no GTK operations at startup.
- `alwaysOnTop: true` in tauri.conf.json uses the native X11 `_NET_WM_STATE_ABOVE`
  hint set during `XCreateWindow` — this doesn't go through GTK's freeze/thaw cycle.

### Why the Deferred Block Was Fundamentally Flawed
`run_on_main_thread` posts to the GTK event loop, but `position_window` calls
`current_monitor()` and `outer_size()` which read window geometry. On X11,
reading geometry triggers a round-trip to the X server which causes layout
operations that touch the freeze counter — even on the main thread.

Setting geometry via tauri.conf.json bypasses this entirely because it happens
at the Xlib/X11 level during `XCreateWindow`, before GTK's freeze/thaw machinery
is involved.

### Side Effects — Positive
- No `gdk_window_thaw_toplevel_updates` warning at startup
- No ghost second window
- HUD can be positioned much closer to screen edges
- Clean transparent window initialization

### Known Limitation
Initial position is hardcoded to x=1400, y=12 (top right). Users can drag the
HUD anywhere, but on next launch it returns to x=1400, y=12. Position persistence
would require modifying tauri.conf.json before launch — not currently implemented.

---

## GTK Thread Safety Rule

**Any Tauri window operation called from a background thread or command handler
MUST be wrapped in `app.run_on_main_thread(|| { ... })`.**

This includes: `set_always_on_top`, `set_focus`, `set_position`,
`WebviewWindowBuilder::build()`, and any other GTK-touching operation.

Violating this causes incremental GDK state corruption → `BadImplementation`
X11 crash after ~2 minutes of use.

**EXCEPTION: Do not call position_window() or geometry-reading functions
(current_monitor, outer_size) even from run_on_main_thread at startup.
Use tauri.conf.json instead.**
