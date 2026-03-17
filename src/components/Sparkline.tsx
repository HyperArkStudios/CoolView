interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  warningThreshold: number;
}

export function Sparkline({ data, width = 140, height = 22, warningThreshold }: SparklineProps) {
  if (data.length < 2) return null;

  const min = Math.min(...data, 20);
  const max = Math.max(...data, warningThreshold + 10);
  const range = max - min || 1;

  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((val - min) / range) * height;
    return `${x},${y}`;
  });

  const polyline = points.join(" ");

  // Threshold line y position
  const thresholdY = height - ((warningThreshold - min) / range) * height;

  return (
    <svg
      width={width}
      height={height}
      style={{ display: "block", overflow: "visible" }}
    >
      {/* Threshold reference line */}
      <line
        x1={0}
        y1={thresholdY}
        x2={width}
        y2={thresholdY}
        stroke="rgba(255, 68, 68, 0.4)"
        strokeWidth={1}
        strokeDasharray="3,3"
      />
      {/* Temperature line */}
      <polyline
        points={polyline}
        fill="none"
        stroke="rgba(180, 220, 255, 0.75)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Latest value dot */}
      {data.length > 0 && (() => {
        const lastX = width;
        const lastY = height - ((data[data.length - 1] - min) / range) * height;
        return (
          <circle
            cx={lastX}
            cy={lastY}
            r={2.5}
            fill="rgba(180, 220, 255, 0.9)"
          />
        );
      })()}
    </svg>
  );
}
