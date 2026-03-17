import { useEffect, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor } from "@tauri-apps/api/window";
import { HUD } from "./components/HUD";
import { Settings } from "./components/Settings";
import { History } from "./components/History";
import { Config, TempPayload } from "./types";

type View = "hud" | "settings" | "history";

const DEFAULT_CONFIG: Config = {
  display: { show_sparkline: false, always_on_top: true, position: "top-right", unit: "C", launch_at_login: false },
  thresholds: { warning_temp: 85, warning_duration_seconds: 180, poll_interval_seconds: 30 },
  monitor: { cpu: true, gpu: true, motherboard: true },
};

async function fetchConfig(): Promise<Config> {
  return await invoke<Config>("get_config");
}

export default function App() {
  const [temps,        setTemps]        = useState<TempPayload | null>(null);
  const [config,       setConfig]       = useState<Config>(DEFAULT_CONFIG);
  const [view,         setView]         = useState<View>("hud");
  const [isWarning,    setIsWarning]    = useState(false);
  const [isBottom,     setIsBottom]     = useState(false);

  // Single source of truth for isBottom — driven by actual window position via onMoved
  useEffect(() => {
    const win = getCurrentWebviewWindow();

    async function checkPosition() {
      const [monitor, pos] = await Promise.all([
        currentMonitor(),
        win.outerPosition(),
      ]);
      if (monitor) {
        setIsBottom(pos.y > monitor.size.height / 2);
      }
    }

    // Check on mount
    checkPosition().catch(console.error);

    // Re-check every time the window is moved — this is the official Tauri API for this
    let unlisten: (() => void) | undefined;
    win.onMoved(async ({ payload: pos }) => {
      const monitor = await currentMonitor();
      if (monitor) {
        setIsBottom(pos.y > monitor.size.height / 2);
      }
    }).then(fn => { unlisten = fn; }).catch(console.error);

    return () => { unlisten?.(); };
  }, []);

  useEffect(() => { fetchConfig().then(setConfig).catch(console.error); }, []);

  useEffect(() => {
    function onConfigChanged() { fetchConfig().then(setConfig).catch(console.error); }
    window.addEventListener("coolview:config-changed", onConfigChanged);
    return () => window.removeEventListener("coolview:config-changed", onConfigChanged);
  }, []);

  useEffect(() => {
    const unlisten = listen<TempPayload>("temp-update", (e) => {
      setTemps(e.payload);
      setIsWarning(e.payload.is_warning);
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  useEffect(() => {
    const on  = listen("warning-triggered", () => setIsWarning(true));
    const off = listen("warning-cleared",   () => setIsWarning(false));
    return () => { on.then(f => f()); off.then(f => f()); };
  }, []);

  const handleSaveConfig = useCallback(async (newConfig: Config) => {
    try {
      await invoke("set_config", { newConfig });
      setConfig(newConfig);
      setView("hud");
    } catch (err) { console.error(err); }
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <HUD
        temps={temps}
        config={config}
        isWarning={isWarning}
        isBottom={isBottom}
        onOpenSettings={() => setView("settings")}
        onOpenHistory={() => setView("history")}
      />
      {view === "settings" && (
        <Settings
          config={config}
          isBottom={isBottom}
          onSave={handleSaveConfig}
          onClose={() => setView("hud")}
          onOpenHistory={() => setView("history")}
        />
      )}
      {view === "history" && (
        <History
          config={config}
          isBottom={isBottom}
          onClose={() => setView("hud")}
        />
      )}
    </div>
  );
}
