import { useMemo } from "react";

/**
 * Lightweight SVG charts — no external chart library dependency.
 *
 * Trade-off: fewer chart types vs. smaller bundle. For enterprise
 * dashboards that need full-featured charts (scatter, heatmap, etc.),
 * re-add `recharts` — but for now bar + line + donut covers 90% of
 * admin analytics needs at ~3 KB instead of ~400 KB.
 */

type BarChartProps = {
  data: Array<{ label: string; value: number }>;
  height?: number;
  color?: string;
};

export function BarChart({ data, height = 160, color = "var(--primary)" }: BarChartProps) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const barWidth = data.length > 0 ? 100 / data.length : 0;

  return (
    <div className="w-full" role="img" aria-label="Bar chart">
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        {data.map((d, i) => {
          const h = (d.value / max) * (height - 20);
          const x = i * barWidth + barWidth * 0.15;
          const w = barWidth * 0.7;
          const y = height - 10 - h;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                fill={color}
                rx={1}
                opacity={0.85}
              >
                <title>{`${d.label}: ${d.value}`}</title>
              </rect>
              <text
                x={x + w / 2}
                y={height - 2}
                textAnchor="middle"
                fontSize={3}
                fill="var(--muted-foreground)"
              >
                {d.label.length > 6 ? d.label.slice(0, 6) + "…" : d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

type LineChartProps = {
  data: Array<{ label: string; value: number }>;
  height?: number;
  color?: string;
};

export function LineChart({ data, height = 160, color = "var(--primary)" }: LineChartProps) {
  const { points, max, min } = useMemo(() => {
    if (data.length === 0) return { points: "", max: 1, min: 0 };
    const vals = data.map((d) => d.value);
    const max = Math.max(...vals, 1);
    const min = Math.min(...vals, 0);
    const range = max - min || 1;
    const step = data.length > 1 ? 100 / (data.length - 1) : 0;
    const pts = data
      .map((d, i) => {
        const x = i * step;
        const y = height - 10 - ((d.value - min) / range) * (height - 20);
        return `${x},${y}`;
      })
      .join(" ");
    return { points: pts, max, min };
  }, [data, height]);

  return (
    <div className="w-full" role="img" aria-label={`Line chart, range ${min} to ${max}`}>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        {data.length > 0 ? (
          <>
            <polyline
              points={points}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {data.map((d, i) => {
              const step = data.length > 1 ? 100 / (data.length - 1) : 0;
              const range = max - min || 1;
              const x = i * step;
              const y = height - 10 - ((d.value - min) / range) * (height - 20);
              return (
                <circle key={i} cx={x} cy={y} r={1.2} fill={color}>
                  <title>{`${d.label}: ${d.value}`}</title>
                </circle>
              );
            })}
          </>
        ) : null}
      </svg>
      <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
        {data.slice(0, 6).map((d, i) => (
          <span key={i}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}

type DonutChartProps = {
  data: Array<{ label: string; value: number; color?: string }>;
  size?: number;
};

export function DonutChart({ data, size = 140 }: DonutChartProps) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex items-center gap-4" role="img" aria-label="Donut chart">
      <svg width={size} height={size} viewBox="0 0 100 100" className="-rotate-90">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--muted)" strokeWidth={10} opacity={0.2} />
        {total > 0
          ? data.map((d, i) => {
              const fraction = d.value / total;
              const dash = fraction * circumference;
              const segment = (
                <circle
                  key={i}
                  cx="50"
                  cy="50"
                  r={radius}
                  fill="none"
                  stroke={d.color ?? "var(--primary)"}
                  strokeWidth={10}
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                >
                  <title>{`${d.label}: ${d.value} (${Math.round(fraction * 100)}%)`}</title>
                </circle>
              );
              offset += dash;
              return segment;
            })
          : null}
      </svg>
      <ul className="text-xs space-y-1 flex-1">
        {data.map((d, i) => (
          <li key={i} className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-sm"
              style={{ background: d.color ?? "var(--primary)" }}
              aria-hidden="true"
            />
            <span className="flex-1 truncate">{d.label}</span>
            <span className="text-muted-foreground">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
