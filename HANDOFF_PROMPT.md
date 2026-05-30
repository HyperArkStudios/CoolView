# CoolView — New Session Handoff

## What This Project Is
CoolView is a cross-platform desktop temperature HUD built with **Tauri 2 + Rust + React + TypeScript**.
It displays CPU/GPU/motherboard temps as a floating dark pill overlay on the desktop.
MIT licensed. Repo: github.com/HyperArkStudios/CoolView
Ko-fi: ko-fi.com/hyperarkstudios

## Files To Upload For Reference
Upload these files from ~/Projects/coolview/coolview/ at the start of the session:
1. `TLDR.md` — quick project overview and critical rules
2. `DEVELOPMENT_LOG.md` — full history of what was built and why
3. `GHOST_BUG_DEBUG_LOG.md` — history of compositor/rendering bugs
4. `src-tauri/src/lib.rs` — Rust backend
5. `src/App.tsx` — React frontend entry point
6. `src/components/HUD.tsx` — HUD component
7. `src-tauri/tauri.conf.json` — window configuration

## Current Architecture
- **Two windows:** `main` (HUD, transparent) and `panel` (Settings/History, created on demand)
- **URL hash routing:** `index.html` = HUD, `index.html#settings` = Settings, `index.html#history` = History
- **Panel:** created via `open_panel` Rust command, hidden via `hide_panel` command
- **X11 XShape:** input region set to top 65px only — dead zone below pill is click-through
- **Dark pill background:** `rgb(14,14,20)` on content container eliminates ghost rendering

## Current Version
v0.2.0 — just tagged, build may still be running on GitHub Actions

## CRITICAL RULES — NEVER VIOLATE
1. Never call `position_window()`, `set_position()`, `current_monitor()`, or `outer_size()` 
   during app startup or from any deferred block — corrupts GTK freeze counter → double window
2. All GTK window operations from background threads MUST use `app.run_on_main_thread()`
3. Do NOT use `on_window_event` — causes immediate X11 crash
4. Do NOT use `set_background_color` — causes white or black rectangles  
5. Do NOT use `always_on_top(true)` or `skip_taskbar(true)` on panel window at runtime
6. `w.emit()` targets one window only — use `app.emit()` for cross-window events
7. Panel window MUST be listed in `capabilities/default.json` windows array
8. `useState` init from prop only runs once — use `useEffect` to sync with async data
9. `XInitThreads()` must be called in main.rs before anything else on Linux
10. Initial window position/alwaysOnTop MUST be set via tauri.conf.json, not at runtime
11. `currentMonitor()` is a STANDALONE function from `@tauri-apps/api/window`, 
    NOT a method on WebviewWindow
12. Always update DEVELOPMENT_LOG.md before any Claude Code session

## FIRST TASK FOR THIS SESSION
**Fix HUD startup position.**

The HUD currently starts in the centre of the screen regardless of the user's 
saved position preference. It should start in the position the user has configured 
in Settings (top-right, top-left, bottom-right, bottom-left).

Current situation:
- `tauri.conf.json` no longer has hardcoded `x`/`y` values (removed to fix 
  off-screen positioning on small screens)
- `App.tsx` has a `positionHUD()` useEffect that tries to position top-right 
  using `currentMonitor()` — but this ignores the user's saved position preference
- The user's position is saved in `~/.config/com.coolview.app/config.toml` 
  under `[display] position = "top-right"` etc.
- `position_window()` function exists in `lib.rs` and correctly handles all 
  four positions — but CANNOT be called at startup from Rust (causes GTK freeze 
  corruption and double window bug)

**The fix should:**
1. Read the user's saved position from config
2. Call `position_window()` equivalent logic from the FRONTEND (JS/TS) after 
   the window is realized — NOT from Rust startup code
3. Use `currentMonitor()` (standalone from `@tauri-apps/api/window`) and 
   `getCurrentWindow()` to calculate the correct x,y for each of the four 
   position options (top-right, top-left, bottom-right, bottom-left)
4. Apply via `getCurrentWindow().setPosition(new PhysicalPosition(x, y))`
5. Re-apply when the user changes position in Settings

The frontend `positionHUD()` function in App.tsx already has the right structure 
— it just needs to read `config.display.position` and implement the four-corner 
logic instead of always positioning top-right.

Config is already loaded into the `config` state variable in App.tsx.
The position values are: "top-right", "top-left", "bottom-right", "bottom-left"

Also add `core:window:allow-set-position` to `capabilities/default.json` if 
not already present — the frontend needs permission to call setPosition.
