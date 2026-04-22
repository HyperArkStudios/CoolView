import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { HistoryEntry, Config } from "../types";

interface HistoryProps {
  config: Config;
  isBottom: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

const W = 210;  // graph width
const H = 130;  // graph height

function tempToY(t: number): number {
  return H - Math.max(0, Math.min(1, t / 110)) * H;
}

function buildPath(entries: HistoryEntry[], key: "cpu" | "gpu" | "motherboard", now: number, start: number): string {
  const pts = entries
    .map(e => {
      const val = e[key];
      if (val == null) return null;
      const t = new Date(e.timestamp).getTime();
      const x = ((t - start) / (now - start)) * W;
      const y = tempToY(val);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter(Boolean);
  if (pts.length < 2) return "";
  return "M " + pts.join(" L ");
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatTemp(t: number | null, unit: "C" | "F"): string {
  if (t == null) return "—";
  return unit === "F" ? `${Math.round(t * 9 / 5 + 32)}°F` : `${Math.round(t)}°C`;
}

export function History({ config, isBottom, onClose, onOpenSettings }: HistoryProps) {
  const [entries, setEntries]     = useState<HistoryEntry[]>([]);
  const [filePath, setFilePath]   = useState("");
  const [loading, setLoading]     = useState(true);
  const unit                      = config.display.unit;
  const warningC                  = config.thresholds.warning_temp;


  useEffect(() => {
    Promise.all([
      invoke<HistoryEntry[]>("get_history"),
      invoke<string>("get_history_path"),
    ]).then(([h, p]) => {
      setEntries(h);
      setFilePath(p);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const now   = Date.now();
  const start = now - 24 * 60 * 60 * 1000;

  const cpuPath = buildPath(entries, "cpu", now, start);
  const gpuPath = buildPath(entries, "gpu", now, start);
  const mbPath  = buildPath(entries, "motherboard", now, start);
  const warnY   = tempToY(warningC);

  // Table: last 30 entries, newest first
  const tableRows = [...entries].reverse().slice(0, 30);

  const btn = (primary?: boolean): React.CSSProperties => ({
    padding: "4px 12px",
    borderRadius: 5,
    border: primary ? "none" : "1px solid rgba(255,255,255,0.15)",
    background: primary ? "rgba(80,140,255,0.8)" : "rgba(255,255,255,0.05)",
    color: "rgba(220,220,230,0.9)",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "var(--font)",
  });

  return (
    <div style={{
      position: "relative",
      ...(isBottom ? { bottom: 0 } : { top: 0 }),
      left: 0,
      width: "100%",
      background: "rgba(14,14,20,0.97)",
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
      gap: 8,
      boxSizing: "border-box" as const,
    }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "grab", userSelect: "none" as const }}
        onMouseDown={(e) => { if ((e.target as HTMLElement).closest("button")) return; e.preventDefault(); getCurrentWebviewWindow().startDragging(); }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.45)" }}>
          📊 Last 24 Hours
        </span>
        <button style={{ ...btn(), padding: "2px 8px", fontSize: 13 }} onClick={onClose}>✕</button>
      </div>

      {loading && (
        <div style={{ textAlign: "center" as const, opacity: 0.4, padding: "20px 0" }}>Loading…</div>
      )}

      {!loading && entries.length === 0 && (
        <div style={{ textAlign: "center" as const, opacity: 0.4, padding: "20px 0" }}>
          No data yet — check back after a few readings.
        </div>
      )}

      {!loading && entries.length > 0 && (
        <>
          {/* Graph */}
          <svg width={W} height={H} style={{ display: "block", borderRadius: 6, background: "rgba(255,255,255,0.03)" }}>
            {/* Grid lines */}
            {[30, 50, 70, 90].map(t => {
              const y = tempToY(t);
              return (
                <g key={t}>
                  <line x1={0} y1={y} x2={W} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
                  <text x={3} y={y - 2} fill="rgba(255,255,255,0.25)" fontSize={8}>{t}°</text>
                </g>
              );
            })}

            {/* Warning threshold */}
            <line x1={0} y1={warnY} x2={W} y2={warnY}
              stroke="rgba(255,80,80,0.5)" strokeWidth={1} strokeDasharray="4,3" />

            {/* Data lines */}
            {mbPath  && <path d={mbPath}  fill="none" stroke="rgba(80,160,255,0.7)"  strokeWidth={1.5} strokeLinejoin="round" />}
            {gpuPath && <path d={gpuPath} fill="none" stroke="rgba(80,255,140,0.7)"  strokeWidth={1.5} strokeLinejoin="round" />}
            {cpuPath && <path d={cpuPath} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth={1.5} strokeLinejoin="round" />}
          </svg>

          {/* Legend */}
          <div style={{ display: "flex", gap: 10, fontSize: 10 }}>
            <span style={{ color: "rgba(255,255,255,0.7)" }}>— CPU</span>
            {gpuPath && <span style={{ color: "rgba(80,255,140,0.8)" }}>— GPU</span>}
            {mbPath  && <span style={{ color: "rgba(80,160,255,0.8)" }}>— MB</span>}
            <span style={{ color: "rgba(255,80,80,0.7)", marginLeft: "auto" }}>– – warn</span>
          </div>

          {/* Table */}
          <div style={{ overflowY: "auto" as const, maxHeight: 200, borderRadius: 5, border: "1px solid rgba(255,255,255,0.07)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" as const, fontSize: 11 }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.05)" }}>
                  <th style={{ padding: "4px 6px", textAlign: "left" as const, opacity: 0.5, fontWeight: 600 }}>Time</th>
                  <th style={{ padding: "4px 6px", textAlign: "right" as const, opacity: 0.5, fontWeight: 600 }}>CPU</th>
                  {entries.some(e => e.gpu != null)         && <th style={{ padding: "4px 6px", textAlign: "right" as const, opacity: 0.5, fontWeight: 600 }}>GPU</th>}
                  {entries.some(e => e.motherboard != null) && <th style={{ padding: "4px 6px", textAlign: "right" as const, opacity: 0.5, fontWeight: 600 }}>MB</th>}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((e, i) => (
                  <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                    <td style={{ padding: "3px 6px", opacity: 0.6 }}>{formatTime(e.timestamp)}</td>
                    <td style={{ padding: "3px 6px", textAlign: "right" as const,
                      color: e.cpu >= warningC ? "#ff6b6b" : e.cpu >= 70 ? "#ffd93d" : "inherit" }}>
                      {formatTemp(e.cpu, unit)}
                    </td>
                    {entries.some(e => e.gpu != null)         && <td style={{ padding: "3px 6px", textAlign: "right" as const, opacity: 0.8 }}>{formatTemp(e.gpu, unit)}</td>}
                    {entries.some(e => e.motherboard != null) && <td style={{ padding: "3px 6px", textAlign: "right" as const, opacity: 0.8 }}>{formatTemp(e.motherboard, unit)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* File path */}
          <div style={{ fontSize: 9, opacity: 0.25, wordBreak: "break-all" as const }}>
            All-time data: {filePath}
          </div>
        </>
      )}

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button style={btn()} onClick={() => { onClose(); }}>← Back</button>
        <button style={btn(true)} onClick={onOpenSettings}>⚙ Settings</button>
      </div>
    </div>
  );
}
