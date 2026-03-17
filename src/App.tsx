import { useEffect, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { HUD } from "./components/HUD";
import { Settings } from "./components/Settings";
import { Config, TempPayload } from "./types";

const DEFAULT_CONFIG: Config = {
  display: {
    show_sparkline: false,
    always_on_top: true,
    position: "top-right",
    unit: "C",
  },
  thresholds: {
    warning_temp: 85,
    warning_duration_seconds: 180,
    poll_interval_seconds: 30,
  },
  monitor: { cpu: true, gpu: true, motherboard: true },
};

async function fetchConfig(): Promise<Config> {
  return await invoke<Config>("get_config");
}

export default function App() {
  const [temps,        setTemps]        = useState<TempPayload | null>(null);
  const [config,       setConfig]       = useState<Config>(DEFAULT_CONFIG);
  const [showSettings, setShowSettings] = useState(false);
  const [isWarning,    setIsWarning]    = useState(false);

  useEffect(() => { fetchConfig().then(setConfig).catch(console.error); }, []);

  useEffect(() => {
    function onConfigChanged() { fetchConfig().then(setConfig).catch(console.error); }
    window.addEventListener("coolview:config-changed", onConfigChanged);
    return () => window.removeEventListener("coolview:config-changed", onConfigChanged);
  }, []);

  useEffect(() => {
    const unlisten = listen<TempPayload>("temp-update", (event) => {
      setTemps(event.payload);
      setIsWarning(event.payload.is_warning);
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
      setShowSettings(false);
    } catch (err) {
      console.error("Failed to save config:", err);
    }
  }, []);

  return (
    // Full transparent 240x500 window. HUD fills it all so drag/hover work everywhere.
    // Settings overlays the same space when open.
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <HUD
        temps={temps}
        config={config}
        isWarning={isWarning}
        onOpenSettings={() => setShowSettings(true)}
        hidden={showSettings}
      />
      {showSettings && (
        <Settings
          config={config}
          onSave={handleSaveConfig}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
