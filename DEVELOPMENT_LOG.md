
---

## CRITICAL FIX — Double Window & GTK Freeze Counter (v0.1.5)

### The Problem
Every launch produced two HUD windows. The `gdk_window_thaw_toplevel_updates`
warning fired on every startup. After extended use, clicking Settings caused
an X11 `BadImplementation` crash.

### Root Cause (final, confirmed)
`position_window()` was being called from a deferred `thread::spawn` +
`run_on_main_thread` block 200ms after startup. This call chain:
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
- Removing `alwaysOnTop` from tauri.conf.json — reduced corruption but ghost persisted
- Removing `set_always_on_top` from deferred block — still corrupted
- Pre-creating panel window hidden at startup — `visible(false)` ignored by GTK, showed as second HUD
- Setting `transparent: false` — fixed double window but created white rectangle
- Positioning panel off-screen at -1000,-1000 — wrong approach

### The Fix That Worked
**Remove the deferred block entirely. Set initial position statically in tauri.conf.json.**

```json
{
  "x": 1400,
  "y": 12,
  "alwaysOnTop": true,
  "transparent": true
}
```

**Why this works:**
- `tauri.conf.json` window properties are applied by the OS window manager
  BEFORE GTK initializes the window. No GTK calls are made at runtime.
- The freeze counter is never touched during initialization.
- No `position_window()`, no `set_always_on_top()`, no GTK operations at startup.
- The HUD appears at the correct position immediately on launch.
- `alwaysOnTop: true` in tauri.conf.json uses the native X11 `_NET_WM_STATE_ABOVE`
  hint set during window creation — this doesn't go through GTK's freeze/thaw cycle.

**Why the deferred block approach was fundamentally flawed:**
`run_on_main_thread` posts to the GTK event loop, but `position_window` calls
`current_monitor()` and `outer_size()` which read window geometry. On X11,
reading geometry triggers a round-trip to the X server which can cause layout
operations that touch the freeze counter — even on the main thread.

Setting geometry via tauri.conf.json bypasses this entirely because it happens
at the Xlib/X11 level during `XCreateWindow`, before GTK's freeze/thaw machinery
is involved.

### Side Effect — Positive
With no GTK corruption at startup, the transparent window ARGB surface
initializes cleanly. The ghost second window is gone. Users can now position
the HUD anywhere on screen including very close to the top edge.

### Remaining Limitation
Initial position is hardcoded to x=1400, y=12 (top right). Users can drag
the HUD to any position, but on next launch it returns to x=1400, y=12.
Position persistence requires saving/restoring position without calling
`set_position()` at startup — which would reintroduce the GTK corruption.

**Possible solution for position persistence:**
Save position to config on drag-end, then set `x` and `y` in tauri.conf.json
dynamically before launch — but this requires a launcher script or a Tauri
plugin that modifies the config before the window is created.
For now, fixed position is acceptable.

### RULE ESTABLISHED
**Never call position_window(), set_position(), current_monitor(), or
outer_size() during app startup or from any deferred block.**
These calls touch GTK's freeze/thaw cycle and corrupt the counter.
All window geometry must be set via tauri.conf.json at creation time.

---

## CRITICAL FIX — Click-Through Dead Zone via X11 XShape (v0.1.6)

### The Problem
GTK enforces a minimum window size of ~226×228px regardless of tauri.conf.json
settings. The HUD pill content is only ~65px tall, leaving ~163px of transparent
dead space below it. This dead space captured all mouse events, making it
impossible to click on windows, folders, or anything underneath the HUD.

### What Was Tried (all failed)
- CSS `pointer-events: none` — only works within the browser, not at OS level
- Tauri `set_ignore_cursor_events` toggle via JS mouseenter/mouseleave — catch-22:
  once enabled, browser stops receiving mouseenter to re-disable it
- Rust cursor poll loop (100ms) using xdotool to get mouse position — race
  conditions, state getting stuck, oscillation between locked states
- Cached window bounds approach — bounds initialized incorrectly (position
  values used as size values due to tuple order bug)
- `last_over_hud = true` initialization — made window permanently click-through,
  couldn't interact with pill at all
- 300ms setTimeout delay on mouseleave — no effect
- All timing/delay approaches — fundamentally flawed, cannot solve the catch-22

### The Correct Solution: X11 XShape Extension
XShape allows defining the exact pixel region of a window that receives mouse
input. Set ONCE at startup, permanent, no polling, no race conditions.

**Implementation:**
1. Added `x11rb = { version = "0.13", features = ["shape"] }` to Cargo.toml
2. Added `gdkx11 = "0.18"` to Cargo.toml (already in registry cache)
3. Called `configure_x11_input_shape(app)` from setup() via `run_on_main_thread`
4. Used `gdkx11::gdk::Screen::default().toplevel_windows()` to get GDK windows
5. Downcast each to `gdkx11::X11Window` to get the XID
6. Applied `shape_rectangles(Set, Input, xid, rect(0,0,226,65))`

**Critical discovery — wrong window XID:**
Initial attempt applied XShape to XID `115343361` but the actual CoolView
window was `115343363`. GDK's `Screen::toplevel_windows()` returns TWO windows:
- First: WebKit child window (wrong — this is an internal rendering surface)
- Last: Actual GTK toplevel window (correct — this is what receives input)

Fix: use `.last()` instead of `.next()` on the iterator, and log ALL XIDs
to verify. The real window is always last in the list.

**Why XShape works where everything else failed:**
XShape operates at the X11 server level, below GTK and below WebKit. It
defines the input region directly in the X server's window data structure.
No amount of GTK corruption, WebKit compositing, or browser sandbox can
interfere with it. It is the correct and permanent solution for overlay HUDs
on X11.

### Result
- HUD pill (top 65px) receives mouse events: drag, click buttons ✓
- Dead zone below pill (163px): all clicks pass through to windows underneath ✓
- Window still shows as ~226×228px in alt-tab (GTK minimum, cannot change)
- XShape is set once at startup, never needs updating ✓
- No polling, no race conditions, no catch-22 ✓

### Code Location
- `src-tauri/src/lib.rs` — `configure_x11_input_shape(app: AppHandle)` function
- Called from `setup()` via `run_on_main_thread`
- Linux only: `#[cfg(target_os = "linux")]`

### Note on HUD Position Change
When user drags HUD to new position, XShape does NOT need to be reapplied
because XShape coordinates are relative to the window, not the screen.
The input region stays correct after any window move.

---

## FIX — HUD Startup Position (v0.2.0)

### The Problem
HUD always appeared in the centre of the screen on startup, regardless of the
user's saved position preference (top-right, top-left, bottom-right, bottom-left).

### Root Cause
Two independent async effects were racing each other in App.tsx:
1. `get_config` invoke — loaded real config asynchronously
2. `positionHUD` effect — depended on `config.display.position` React state

Since React state initialises from `DEFAULT_CONFIG` (position: "top-right"),
`positionHUD` fired immediately on mount with the default value BEFORE
`get_config` resolved. The window would jump to the default position first,
then potentially jump again when real config loaded — or worse, sit in the
OS default centre position until both effects settled.

### What Was Tried and Failed
- `visible: false` in tauri.conf.json + `win.show()` after setPosition —
  corrupts GTK freeze counter on X11, window never appears at all.
  Same root cause as the double-window bug (v0.1.5). NEVER USE visible:false.
- Single positionHUD effect depending on `config.display.position` —
  still races because config state starts as DEFAULT_CONFIG.

### The Fix
Merged config loading and positioning into one sequential async function
`initHUD()` in App.tsx, called once on mount with empty deps `[]`:

```ts
async function initHUD() {
  const cfg = await invoke<Config>("get_config");  // fetch real config first
  setConfig(cfg);
  // ... calculate position from cfg.display.position ...
  await win.setPosition(new PhysicalPosition(x, y));
  setHudReady(true);
}
```

A separate `reposition()` effect with `[config.display.position, hudReady]`
deps handles re-positioning when the user changes position in Settings.
The `hudReady` flag prevents this effect from firing on first load.

### HUD Fade-in
Added `ready` prop to HUD component. Outermost div has `opacity: ready ? 1 : 0`
with `transition: "opacity 0.15s ease"`. The window is visible from the OS
perspective but renders transparent until `initHUD` completes and sets
`hudReady(true)`. This prevents any flash of content at the wrong position.

### RULE ESTABLISHED
Never use two separate effects for config loading and position calculation.
Always fetch config INSIDE the positioning function, in sequence, so position
is calculated from the real saved config — not from DEFAULT_CONFIG.
