import { useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { Config, TempPayload } from "../types";
import { Sparkline } from "./Sparkline";

interface HUDProps {
  temps: TempPayload | null;
  config: Config;
  isWarning: boolean;
  isBottom: boolean;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
}

function toDisplay(celsius: number | null | undefined, unit: "C" | "F"): string {
  if (celsius == null) return "—";
  const val = unit === "F" ? (celsius * 9) / 5 + 32 : celsius;
  return `${Math.round(val)}°`;
}

const textOutline = [
  "-1px -1px 0 #000", " 1px -1px 0 #000",
  "-1px  1px 0 #000", " 1px  1px 0 #000",
  "-2px  0   0 #000", " 2px  0   0 #000",
  " 0   -2px 0 #000", " 0    2px 0 #000",
].join(", ");

const warningOutline = [
  "-1px -1px 0 #800", " 1px -1px 0 #800",
  "-1px  1px 0 #800", " 1px  1px 0 #800",
  "-2px  0   0 #800", " 2px  0   0 #800",
  " 0   -2px 0 #800", " 0    2px 0 #800",
].join(", ");

function tempColor(c: number | null | undefined): string {
  if (c == null) return "#ffffff";
  if (c >= 85) return "#ff6b6b";
  if (c >= 70) return "#ffd93d";
  return "#ffffff";
}

export function HUD({ temps, config, isWarning, isBottom, onOpenSettings, onOpenHistory }: HUDProps) {
  const [hovered, setHovered] = useState(false);
  const [panelCooldown, setPanelCooldown] = useState(false);

  function openPanel(fn: () => void) {
    if (panelCooldown) return;
    setPanelCooldown(true);
    fn();
    setTimeout(() => setPanelCooldown(false), 600);
  }
  const { unit, show_sparkline } = config.display;

  function handleMouseDown(e: React.MouseEvent) {
    // Don't drag when clicking buttons (unit toggle, settings, history icons)
    if ((e.target as HTMLElement).closest("button")) return;
    getCurrentWebviewWindow().startDragging();
  }

  async function handleUnitClick(e: React.MouseEvent) {
    e.stopPropagation();
    const newUnit = unit === "C" ? "F" : "C";
    try {
      await invoke("set_config", { newConfig: { ...config, display: { ...config.display, unit: newUnit } } });
      window.dispatchEvent(new CustomEvent("coolview:config-changed"));
    } catch (err) { console.error(err); }
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700,
    textTransform: "uppercase" as const, letterSpacing: "0.1em",
    color: "rgba(255,255,255,0.7)", textShadow: textOutline,
    lineHeight: 1, marginBottom: 1,
  };

  const valueStyle = (c: number | null | undefined): React.CSSProperties => ({
    fontSize: 22, fontWeight: 800,
    color: tempColor(c),
    textShadow: isWarning ? warningOutline : textOutline,
    lineHeight: 1, letterSpacing: "-0.02em",
  });

  const iconBtn: React.CSSProperties = {
    background: "none", border: "none", cursor: "pointer",
    fontSize: 13, lineHeight: 1,
    color: "rgba(255,255,255,0.85)",
    textShadow: textOutline,
    opacity: hovered ? 1 : 0.6,
    transition: "opacity 0.15s ease",
    padding: 2,
  };

  return (
    <div
      style={{ position: "absolute", inset: 0, background: "transparent", pointerEvents: "none", overflow: "hidden" }}
    >
      {/* Temp content — anchored top-right or bottom-right */}
      <div
        style={{
          position: "absolute",
          ...(isBottom ? { bottom: 8 } : { top: 8 }),
          right: 10,
          display: "flex",
          flexDirection: isBottom ? "column-reverse" : "column",
          alignItems: "flex-end",
          gap: 3,
          pointerEvents: "all",
          cursor: "default",
          userSelect: "none",
          WebkitUserSelect: "none",
          // BUG2 fix: force GPU composite layer for this whole content area so
          // WebKit's dirty-rect partial-repaint can't skip the clear step.
          // The near-zero background (0.001 alpha) makes WebKit paint a background
          // before text, which zeroes out ghost pixels from previous frames.
          // Without it, transparent regions accumulate old text via Porter-Duff
          // "over" without clearing — causing 90-120s ghost artifacts on ARGB surfaces.
          willChange: "transform",
          transform: "translateZ(0)",
          background: "rgb(14,14,20)",
          borderRadius: 10,
          padding: "4px 8px",
        }}
        onMouseDown={handleMouseDown}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Icon row — top of right content */}
        <div style={{ display: "flex", gap: 4, alignItems: "center", alignSelf: "flex-end" }}>
          <button style={iconBtn} onClick={() => openPanel(onOpenHistory)} title="History">≡</button>
          <button style={iconBtn} onClick={() => openPanel(onOpenSettings)} title="Settings">⚙</button>
        </div>

        {/* Warning */}
        {isWarning && (
          <div className="animate-pulse-warning" style={{
            fontSize: 11, fontWeight: 800, color: "#ff4444",
            textShadow: warningOutline,
            textTransform: "uppercase" as const,
            letterSpacing: "0.06em", textAlign: "right" as const,
          }}>⚠ TEMPS TOO HIGH</div>
        )}

        {/* Temp readings */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          {config.monitor.cpu && (
            <div style={{ textAlign: "center" as const }}>
              <div style={labelStyle}>CPU</div>
              <span style={valueStyle(temps?.cpu)}>{toDisplay(temps?.cpu ?? null, unit)}</span>
            </div>
          )}
          {config.monitor.gpu && temps?.gpu != null && (
            <>
              <span style={{ color: "rgba(255,255,255,0.3)", textShadow: textOutline, fontSize: 18 }}>/</span>
              <div style={{ textAlign: "center" as const }}>
                <div style={labelStyle}>GPU</div>
                <span style={valueStyle(temps.gpu)}>{toDisplay(temps.gpu, unit)}</span>
              </div>
            </>
          )}
          {config.monitor.motherboard && temps?.motherboard != null && (
            <>
              <span style={{ color: "rgba(255,255,255,0.3)", textShadow: textOutline, fontSize: 18 }}>/</span>
              <div style={{ textAlign: "center" as const }}>
                <div style={labelStyle}>MB</div>
                <span style={valueStyle(temps.motherboard)}>{toDisplay(temps.motherboard, unit)}</span>
              </div>
            </>
          )}
          {!temps && (
            <span style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", textShadow: textOutline }}>reading…</span>
          )}
          <button onClick={handleUnitClick} title={`Switch to °${unit === "C" ? "F" : "C"}`}
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: "0 0 3px 0", lineHeight: 1, fontSize: 11, fontWeight: 700,
              color: hovered ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.55)",
              textShadow: textOutline, letterSpacing: "0.1em",
              textTransform: "uppercase" as const,
              textDecoration: "none",
              transition: "color 0.15s",
            }}>°{unit}</button>
        </div>

        {show_sparkline && temps && temps.history.length >= 2 && (
          <Sparkline data={temps.history} warningThreshold={config.thresholds.warning_temp} width={130} height={20} />
        )}
      </div>


    </div>
  );
}
