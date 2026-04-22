import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useState, useEffect } from "react";
import { Config } from "../types";

interface SettingsProps {
  config: Config;
  isBottom: boolean;
  onSave: (config: Config) => void;
  onClose: () => void;
  onOpenHistory: () => void;
}

// Convert °C to °F for display
function cToF(c: number) { return Math.round(c * 9 / 5 + 32); }
// Convert °F to °C for storage
function fToC(f: number) { return (f - 32) * 5 / 9; }

const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.07)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 5,
  color: "rgba(220,220,230,0.9)",
  fontSize: 12,
  padding: "3px 7px",
  fontFamily: "var(--font)",
  outline: "none",
  width: 64,
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 7,
};

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  color: "rgba(255,255,255,0.35)",
  marginTop: 12,
  marginBottom: 7,
  display: "block",
};

const checkRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  fontSize: 12,
  color: "rgba(220,220,230,0.85)",
  cursor: "pointer",
  marginBottom: 7,
};

const btn = (primary?: boolean): React.CSSProperties => ({
  padding: "5px 14px",
  borderRadius: 5,
  border: primary ? "none" : "1px solid rgba(255,255,255,0.15)",
  background: primary ? "rgba(80,140,255,0.8)" : "rgba(255,255,255,0.05)",
  color: "rgba(220,220,230,0.9)",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "var(--font)",
});

export function Settings({ config, isBottom, onSave, onClose, onOpenHistory }: SettingsProps) {

  const [draft, setDraft] = useState<Config>(JSON.parse(JSON.stringify(config)));

  // Re-sync draft when config loads from backend (panel window async fetch)
  useEffect(() => {
    setDraft(JSON.parse(JSON.stringify(config)));
  }, [config]);
  const unit = draft.display.unit;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter")  { e.preventDefault(); onSave(draft); }
      if (e.key === "Escape") { onClose(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, onSave, onClose]);

  function setDisplay<K extends keyof Config["display"]>(k: K, v: Config["display"][K]) {
    setDraft(d => ({ ...d, display: { ...d.display, [k]: v } }));
  }
  function setThresholdC(k: keyof Config["thresholds"], v: number) {
    setDraft(d => ({ ...d, thresholds: { ...d.thresholds, [k]: v } }));
  }
  function setMonitor(k: keyof Config["monitor"], v: boolean) {
    setDraft(d => ({ ...d, monitor: { ...d.monitor, [k]: v } }));
  }

  // Threshold display value — convert to °F if needed
  const thresholdDisplay = unit === "F"
    ? cToF(draft.thresholds.warning_temp)
    : Math.round(draft.thresholds.warning_temp);

  function handleThresholdChange(displayVal: number) {
    const inC = unit === "F" ? fToC(displayVal) : displayVal;
    setThresholdC("warning_temp", inC);
  }

  const panelStyle: React.CSSProperties = {
    position: "relative",
    ...(isBottom ? { bottom: 0 } : { top: 0 }),
    left: 0,
    width: "100%",
    background: "rgba(14, 14, 20, 0.97)",
    backdropFilter: undefined,
    WebkitBackdropFilter: undefined,
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 10,
    padding: "12px 14px",
    color: "rgba(220,220,230,0.9)",
    fontSize: 12,
    fontFamily: "var(--font)",
    display: "flex",
    flexDirection: "column" as const,
    boxSizing: "border-box" as const,
  };

  return (
    <div style={panelStyle}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "grab", userSelect: "none" as const }}
        onMouseDown={(e) => { if ((e.target as HTMLElement).closest("button")) return; e.preventDefault(); getCurrentWebviewWindow().startDragging(); }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.45)" }}>
          ⚙ Settings
        </span>
        <button style={{ ...btn(), padding: "2px 8px", fontSize: 13 }} onClick={onClose}>✕</button>
      </div>

      {/* ── Warning ── */}
      <span style={sectionLabel}>Warning</span>
      <div style={rowStyle}>
        <span>Temp threshold</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input type="number" style={inputStyle}
            min={unit === "F" ? 122 : 50}
            max={unit === "F" ? 212 : 100}
            value={thresholdDisplay}
            onChange={e => handleThresholdChange(+e.target.value)} />
          <span style={{ fontSize: 11, opacity: 0.45, width: 28, display: "inline-block" }}>°{unit}</span>
        </span>
      </div>
      <div style={rowStyle}>
        <span>Duration</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input type="number" style={inputStyle} min={30} max={3600} step={30}
            value={draft.thresholds.warning_duration_seconds}
            onChange={e => setThresholdC("warning_duration_seconds", +e.target.value)} />
          <span style={{ fontSize: 11, opacity: 0.45, width: 28, display: "inline-block" }}>sec</span>
        </span>
      </div>
      <div style={rowStyle}>
        <span>Base poll interval</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input type="number" style={inputStyle} min={10} max={300} step={5}
            value={draft.thresholds.poll_interval_seconds}
            onChange={e => setThresholdC("poll_interval_seconds", +e.target.value)} />
          <span style={{ fontSize: 11, opacity: 0.45, width: 28, display: "inline-block" }}>sec</span>
        </span>
      </div>
      <div style={{ fontSize: 10, opacity: 0.35, marginBottom: 4, marginTop: -4 }}>
        Auto-tightens to 20s above 70°, 10s above 80°
      </div>

      {/* ── Display ── */}
      <span style={sectionLabel}>Display</span>
      <label style={checkRow}>
        <input type="checkbox" checked={draft.display.always_on_top}
          onChange={e => setDisplay("always_on_top", e.target.checked)} />
        Always on top
      </label>
      <label style={checkRow}>
        <input type="checkbox" checked={draft.display.show_sparkline}
          onChange={e => setDisplay("show_sparkline", e.target.checked)} />
        Show sparkline
      </label>
      <label style={checkRow}>
        <input type="checkbox" checked={draft.display.launch_at_login}
          onChange={e => setDisplay("launch_at_login", e.target.checked)} />
        Launch at login
      </label>
      <div style={rowStyle}>
        <span>Position</span>
        <select style={{ ...inputStyle, width: 112 }}
          value={draft.display.position}
          onChange={e => setDisplay("position", e.target.value as Config["display"]["position"])}>
          <option value="top-right">Top right</option>
          <option value="top-left">Top left</option>
          <option value="bottom-right">Bottom right</option>
          <option value="bottom-left">Bottom left</option>
        </select>
      </div>

      {/* ── Sensors ── */}
      <span style={sectionLabel}>Sensors</span>
      {(["cpu", "gpu", "motherboard"] as const).map(s => (
        <label key={s} style={checkRow}>
          <input type="checkbox" checked={draft.monitor[s]}
            onChange={e => setMonitor(s, e.target.checked)} />
          {s === "motherboard" ? "Motherboard" : s.toUpperCase()}
        </label>
      ))}
      <div style={{ fontSize: 10, opacity: 0.3, marginTop: -4, marginBottom: 4 }}>
        GPU temp requires kernel ≥ 6.12 or discrete GPU drivers
      </div>

      {/* ── Actions ── */}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: "auto", paddingTop: 10, alignItems: "center" }}>
        <button
          style={{ ...btn(), marginRight: "auto" }}
          onClick={onOpenHistory}
        >History</button>
        <button style={btn()} onClick={onClose}>Cancel</button>
        <button style={btn(true)} onClick={() => onSave(draft)}>Save</button>
      </div>
      <div style={{ fontSize: 10, opacity: 0.2, textAlign: "center" as const, marginTop: 6 }}>
        Enter to save · Esc to cancel
      </div>

    </div>
  );
}
