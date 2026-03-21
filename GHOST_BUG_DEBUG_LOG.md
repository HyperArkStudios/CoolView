# CoolView — Ghost Rendering Bug Debug Log

## Environment
- OS: Ubuntu 22.04, X11 (not Wayland)
- WebKit2GTK: 2.50.4
- Tauri: 2.x
- Window: 280×500px, `transparent: true`, `decorations: false`
- Display server: X11, GTK compositor

## The Bug
When Settings or History panel is open, clicking the ✕ close button (or Cancel,
Back, Save, Escape) causes BOTH the panel AND the HUD temperature text to be
visible simultaneously. The panel should disappear and only the transparent HUD
should remain.

The ghost text appears in the TOP-RIGHT area of the window — exactly where the
HUD temperature readings are positioned.

## Architecture
- Window is always 280×500px transparent
- `App.tsx` uses a `view` state: `"hud" | "settings" | "history"`
- HUD renders ONLY when `{view === "hud" && <HUD/>}`
- Settings/History render ONLY when their respective view is active
- React state is confirmed correct — HUD is NOT mounted when panels are open

## What We Know For Certain
1. The ghost is X11 compositor retaining previous frame pixels
2. The ghost appears specifically on BUTTON CLICK inside the panel
3. The ghost text is from BEFORE the panel opened (old HUD frame)
4. React state is correct — this is a rendering/compositor timing issue
5. The ghost appears in the top-right corner where HUD text lives

---

## Attempted Fixes & Results

### CSS Fixes (all failed)

**1. `isolation: "isolate"` on panel containers**
- Rationale: Create new stacking/compositing context
- Result: No change

**2. `borderRadius: 0` on panels (removed border-radius)**
- Rationale: border-radius corners were alpha=0 pixels leaking through
- Result: Partially helped but ghost persisted

**3. `inset: 0` on panels with fully opaque background**
- Rationale: Cover entire window with opaque pixels
- Result: No change — ghost still appears on button click

**4. `will-change: transform` on panels**
- Rationale: Promote to own compositor layer
- Result: No change

**5. `zIndex` layering**
- Rationale: Ensure panels render above HUD
- Result: No change — HUD is unmounted anyway

**6. `background: view !== "hud" ? "rgb(14,14,20)" : "transparent"` on root div**
- Rationale: Force opaque background when panels open
- Result: No change — ghost still appears

**7. Removing `background-color` from `html, body, #root`**
- Result: No change

---

### Rust/Tauri Fixes (caused new problems)

**8. `set_background_color(Some(Color(0,0,0,255)))` on panel open**
- Rationale: Make WebKit's ARGB surface opaque, prevent alpha=0 retention
- Result: FIXED the ghost BUT caused solid BLACK rectangle when closing panel

**9. `set_background_color(None)` on panel close (to restore transparency)**
- Rationale: Restore transparent state after fix #8
- Result: Caused solid WHITE rectangle instead of transparent
- Root cause: `None` in wry means "skip the call entirely" → WebKit falls back
  to browser default white, not transparency

**10. Removed `set_background_color` entirely**
- Rationale: Return to original working state, fix CSS instead
- Result: White rectangle gone, but ghost returned

---

### React Fixes

**11. `flushSync` on all close/cancel handlers**
- Rationale: React 18 uses MessageChannel (macrotask) for render commits.
  WebKit's rendering cycle fires BEFORE the macrotask, so it sees the OLD DOM
  (panel still mounted) and does a dirty-rect paint. `flushSync` forces
  synchronous DOM commit before WebKit's render cycle.
- CC diagnosis: "Click → setView queued (macrotask) → JS returns → WebKit
  renders OLD DOM → dirty-rect paint → macrotask fires → React re-renders"
- Result: **NO CHANGE** — ghost still appears despite flushSync

---

## CC Diagnoses (in order)

### CC Attempt 1
"borderRadius corners create alpha=0 pixels. WebKit partial repaint on button
click doesn't redraw those corners. X11 compositor shows stale HUD pixels
through them."
→ Fix: Remove borderRadius. Partially helped, not sufficient.

### CC Attempt 2  
"`set_background_color(None)` doesn't mean transparent — it means skip the call.
Use `None` to restore = WebKit defaults to white."
→ Fix: Remove set_background_color entirely, fix at CSS level instead.

### CC Attempt 3
"React 18 macrotask scheduler gap: WebKit renders before React commits new DOM.
flushSync forces synchronous commit."
→ Fix: flushSync on all handlers. Did NOT work despite being logically sound.

---

## Current State of Files

### App.tsx
```tsx
// HUD only renders when view === "hud"
{view === "hud" && <HUD ... />}
{view === "settings" && <Settings ... />}
{view === "history" && <History ... />}
// Root div:
<div style={{ width: "100%", height: "100%", position: "relative", 
  background: view !== "hud" ? "rgb(14,14,20)" : "transparent" }}>
```

### Settings.tsx / History.tsx panel style
```tsx
position: "absolute",
inset: 0,
background: "rgb(14, 14, 20)",  // fully opaque
// NO borderRadius on outer container
// will-change: "transform"  (added by CC, may or may not be present)
```

### index.css
```css
html, body, #root {
  background: transparent;
  overflow: hidden;
}
```

### tauri.conf.json
```json
"transparent": true,
"decorations": false,
"width": 280,
"height": 500
```

### lib.rs
- NO `set_background_color` calls anywhere
- Window positioned via `position_window()` using `saturating_add/sub`

---

## Key Observations
1. The ghost is triggered specifically by BUTTON CLICKS inside the panel
2. Mouse moves and other interactions do NOT trigger the ghost
3. The ghost shows up in top-right corner (where HUD text is)
4. flushSync did not help — the timing theory may be wrong
5. The app worked perfectly BEFORE any compositor fixes were attempted
6. Original working state: no set_background_color, had borderRadius on panels

## Hypothesis for Next Attempt
The dirty-rect issue may not be React scheduling at all. GTK button press events
cause an immediate GDK_BUTTON_PRESS expose event that redraws the button widget
BEFORE any JS runs. This native GTK repaint may be happening at a lower level
than React/JS can intercept. The fix may need to be at the GTK/native level —
either suppressing the native button repaint or forcing a full window invalidation
at the GTK level before the button press is processed.

---

## What Actually Needs To Happen
Force a **full window invalidation** at the GTK/X11 level when a button inside
a panel is clicked. This must happen BEFORE or SYNCHRONOUSLY WITH the GTK button
press expose event — not after JS runs. CSS and React timing cannot achieve this.

---

## Update — Two-Window Architecture (latest)

### Approach
Moved Settings and History into a separate panel window created on demand.
Panel window is `transparent: false` — eliminates panel ghost entirely.
HUD remains in main transparent window.

### HUD Ghost — Current State
Ghost persists on the HUD window (transparent: true, 240×64px).
Shows old temp values under new ones on every update.
Persists for 90-120 seconds.

**What helped partially:**
- `willChange: "transform"` + `transform: "translateZ(0)"` on temp container div
- Ghost still appears but may clear faster in some cases

**What did NOT help:**
- flushSync on state updates
- borderRadius removal
- set_background_color (causes white rectangle — see earlier entries)
- Window height reduction
- overflow: hidden on container

**Current hypothesis:**
`startDragging()` in Settings/History header may be interfering with GTK's
window freeze/thaw cycle, causing `gdk_window_thaw_toplevel_updates` assertion
failure. This in turn may be causing the X11 BadImplementation crash AND
disrupting the compositor repaint cycle that causes ghosts.

**Not yet tried:**
- Removing startDragging() from panel windows entirely
- Making HUD window non-transparent with CSS background matching desktop colour
- Full window invalidation via JS on every temp update

---

## X11 BadImplementation Crash (NEW BUG)

**Error:** `BadImplementation (server does not implement operation)`
**request_code:** 20 = `ChangeWindowAttributes`
**Preceding warning:** `gdk_window_thaw_toplevel_updates: assertion 'window->update_and_descendants_freeze_count > 0' failed`

**Trigger:** Clicking Settings button after extended use. Serial number grows
over time (1545 → 7040 → 21545) indicating accumulation of state.

**What was tried:**
- Removed `decorations(false)` from panel — crash persisted
- Removed `always_on_top(true)` from panel — crash persisted  
- Removed `skip_taskbar(true)` from panel — crash persisted
- Used `on_window_event` + `sync_channel` for panel close — caused immediate crash
- 150ms and 300ms sleep between close and reopen — insufficient

**Strong hypothesis:**
`startDragging()` called from panel window header calls `XGrabPointer`.
This interferes with GTK's internal window freeze/thaw reference counting.
After enough open/close cycles the counter goes negative, causing the
assertion failure on the next `ChangeWindowAttributes` call.

**Recommended fix to try:**
Remove `startDragging()` from Settings.tsx and History.tsx entirely.
Panel windows should not be draggable — they spawn adjacent to HUD.

---

## Update — startDragging hypothesis DISPROVED

**Date:** Latest session

**What was tried:** Removed `startDragging()` from HUD.tsx entirely.
**Result:** Crash still happened on first Settings click, serial 2745.
**Conclusion:** `startDragging()` is NOT the cause of the crash.

## Revised Understanding of Crash

**Key observation:** `gdk_window_thaw_toplevel_updates` warning fires at
APP STARTUP, before any user interaction. Crash follows ~11 seconds later
on first Settings click.

**This means:** The freeze counter is corrupted DURING STARTUP, not during
user interaction. Something in Tauri's `setup()` or initial window creation
is calling freeze without a matching thaw.

**Suspects (not yet investigated):**
- `TrayIconBuilder::build()` during setup
- `position_window()` calling `set_position()` on startup
- `set_always_on_top()` on main window during setup
- Interaction between `transparent: true` main window and non-transparent
  panel window creation
- The `always_on_top: true` config in tauri.conf.json itself

**Not yet tried:**
- Removing tray icon build from setup
- Removing set_always_on_top call from setup
- Removing position_window call from setup
- Setting always_on_top: false in tauri.conf.json
