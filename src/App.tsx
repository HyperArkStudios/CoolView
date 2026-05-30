import { useEffect, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, currentMonitor } from "@tauri-apps/api/window";
import { HUD } from "./components/HUD";
import { Settings } from "./components/Settings";
import { History } from "./components/History";
import { Config, TempPayload } from "./types";

const DEFAULT_CONFIG: Config = {
  display: { show_sparkline: false, always_on_top: true, position: "top-right", unit: "C", launch_at_login: false },
  thresholds: { warning_temp: 85, warning_duration_seconds: 180, poll_interval_seconds: 30 },
  monitor: { cpu: true, gpu: true, motherboard: true },
};

// Determine which view this window should show from the URL hash
const view = window.location.hash.replace('#', '') || 'hud';

// Mark body so CSS can target panel windows specifically
if (view !== 'hud') {
  document.body.classList.add('panel-window');
}

export default function App() {
  const [temps,    setTemps]    = useState<TempPayload | null>(null);
  const [config,   setConfig]   = useState<Config>(DEFAULT_CONFIG);
  const [isWarning,setIsWarning]= useState(false);
  const [isBottom, setIsBottom] = useState(false);

  // For panel windows, just load config normally.
  useEffect(() => {
    if (view === "hud") return;
    invoke<Config>("get_config").then(setConfig).catch(console.error);
  }, []);

  // For HUD: load config first, then position — sequential, no race condition.
  // A separate effect handles re-positioning when the user changes position in Settings.
  const [hudReady, setHudReady] = useState(false);

  useEffect(() => {
    if (view !== "hud") return;
    async function initHUD() {
      try {
        const { PhysicalPosition } = await import("@tauri-apps/api/dpi");
        // Fetch real config before positioning — avoids jumping to DEFAULT_CONFIG position first
        const cfg = await invoke<Config>("get_config");
        setConfig(cfg);

        const win = getCurrentWindow();
        const monitor = await currentMonitor();
        if (!monitor) return;
        const winSize = await win.outerSize();
        const pad = Math.round(12 * monitor.scaleFactor);
        const sw = monitor.size.width;
        const sh = monitor.size.height;
        const ww = winSize.width;
        const wh = winSize.height;

        let x: number, y: number;
        switch (cfg.display.position) {
          case "top-left":     x = pad;           y = pad;           break;
          case "bottom-right": x = sw - ww - pad; y = sh - wh - pad; break;
          case "bottom-left":  x = pad;           y = sh - wh - pad; break;
          default:             x = sw - ww - pad; y = pad;           break; // top-right
        }
        await win.setPosition(new PhysicalPosition(x, y));
        setHudReady(true);
      } catch (_) {}
    }
    initHUD();
  }, []);

  // Re-position when user changes position in Settings (not on first load — initHUD handles that)
  useEffect(() => {
    if (view !== "hud" || !hudReady) return;
    async function reposition() {
      try {
        const { PhysicalPosition } = await import("@tauri-apps/api/dpi");
        const win = getCurrentWindow();
        const monitor = await currentMonitor();
        if (!monitor) return;
        const winSize = await win.outerSize();
        const pad = Math.round(12 * monitor.scaleFactor);
        const sw = monitor.size.width;
        const sh = monitor.size.height;
        const ww = winSize.width;
        const wh = winSize.height;

        let x: number, y: number;
        switch (config.display.position) {
          case "top-left":     x = pad;           y = pad;           break;
          case "bottom-right": x = sw - ww - pad; y = sh - wh - pad; break;
          case "bottom-left":  x = pad;           y = sh - wh - pad; break;
          default:             x = sw - ww - pad; y = pad;           break;
        }
        await win.setPosition(new PhysicalPosition(x, y));
      } catch (_) {}
    }
    reposition();
  }, [config.display.position, hudReady]);

  useEffect(() => {
    async function checkPos() {
      const [mon, pos] = await Promise.all([currentMonitor(), getCurrentWindow().outerPosition()]);
      if (mon) setIsBottom(pos.y > mon.size.height / 2);
    }
    checkPos().catch(console.error);
  }, []);

  useEffect(() => {
    function onConfigChanged() {
      invoke<Config>("get_config").then(setConfig).catch(console.error);
    }
    window.addEventListener("coolview:config-changed", onConfigChanged);
    // Also listen for Tauri event from panel window saving config
    const unlisten = listen("config-updated", () => {
      invoke<Config>("get_config").then(setConfig).catch(console.error);
    });
    return () => {
      window.removeEventListener("coolview:config-changed", onConfigChanged);
      unlisten.then(f => f());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<TempPayload>("temp-update", (e) => {
      setTemps(e.payload);
      setIsWarning(e.payload.is_warning);
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  const handleSaveConfig = useCallback(async (newConfig: Config) => {
    await invoke("set_config", { newConfig });
    setConfig(newConfig);
    await invoke("hide_panel");
  }, []);

  // ── HUD window ──────────────────────────────────────────────────────────────
  if (view === "hud") {
    return (
      <HUD
        temps={temps}
        config={config}
        isWarning={isWarning}
        isBottom={isBottom}
        ready={hudReady}
        onOpenSettings={() => invoke("open_panel", { label: "settings" })}
        onOpenHistory={() => invoke("open_panel", { label: "history" })}
      />
    );
  }

  // ── Panel window (settings or history) ─────────────────────────────────────
  return (
    <div style={{
      width: "100vw",
      height: "100vh",
      background: "rgb(14,14,20)",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
    }}>
      {view === "settings" && (
        <Settings
          config={config}
          isBottom={false}
          onSave={handleSaveConfig}
          onClose={() => invoke("hide_panel")}
          onOpenHistory={() => {
            window.location.hash = 'history';
            window.location.reload();
          }}
        />
      )}
      {view === "history" && (
        <History
          config={config}
          isBottom={false}
          onClose={() => invoke("hide_panel")}
          onOpenSettings={() => {
            window.location.hash = "settings";
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}
