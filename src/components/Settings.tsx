import { useState, useEffect } from "react";
import { Config } from "../types";

interface SettingsProps {
  config: Config;
  onSave: (config: Config) => void;
  onClose: () => void;
}

const W = 238;
const H = 460;

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

export function Settings({ config, onSave, onClose }: SettingsProps) {
  const [draft, setDraft] = useState<Config>(JSON.parse(JSON.stringify(config)));

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
  function setThreshold(k: keyof Config["thresholds"], v: number) {
    setDraft(d => ({ ...d, thresholds: { ...d.thresholds, [k]: v } }));
  }
  function setMonitor(k: keyof Config["monitor"], v: boolean) {
    setDraft(d => ({ ...d, monitor: { ...d.monitor, [k]: v } }));
  }

  return (
    // Hardcoded pixel dimensions — no viewport, no parent, no surprises
    <div style={{
      position: "absolute",
      top: 0,
      left: 0,
      width: W,
      height: H,
      background: "rgba(14, 14, 20, 0.97)",
      backdropFilter: "blur(20px)",
      WebkitBackdropFilter: "blur(20px)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: 10,
      padding: "12px 14px",
      color: "rgba(220,220,230,0.9)",
      fontSize: 12,
      fontFamily: "var(--font)",
      display: "flex",
      flexDirection: "column" as const,
      boxSizing: "border-box" as const,
    }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
          <input type="number" style={inputStyle} min={50} max={100}
            value={draft.thresholds.warning_temp}
            onChange={e => setThreshold("warning_temp", +e.target.value)} />
          <span style={{ fontSize: 11, opacity: 0.45 }}>°C</span>
        </span>
      </div>
      <div style={rowStyle}>
        <span>Duration</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input type="number" style={inputStyle} min={30} max={3600} step={30}
            value={draft.thresholds.warning_duration_seconds}
            onChange={e => setThreshold("warning_duration_seconds", +e.target.value)} />
          <span style={{ fontSize: 11, opacity: 0.45 }}>sec</span>
        </span>
      </div>
      <div style={rowStyle}>
        <span>Poll interval</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input type="number" style={inputStyle} min={5} max={300} step={5}
            value={draft.thresholds.poll_interval_seconds}
            onChange={e => setThreshold("poll_interval_seconds", +e.target.value)} />
          <span style={{ fontSize: 11, opacity: 0.45 }}>sec</span>
        </span>
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

      {/* ── Actions ── */}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: "auto", paddingTop: 8 }}>
        <span style={{ fontSize: 10, opacity: 0.25, alignSelf: "center", marginRight: "auto" }}>
          Enter to save · Esc to cancel
        </span>
        <button style={btn()} onClick={onClose}>Cancel</button>
        <button style={btn(true)} onClick={() => onSave(draft)}>Save</button>
      </div>

    </div>
  );
}
