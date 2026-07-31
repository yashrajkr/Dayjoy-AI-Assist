/**
 * Lightweight chart components for admin dashboards.
 * Pure SVG — no external chart library dependency.
 *
 * Designed to be small, fast, and accessible. Each chart accepts an array
 * of data points and renders an SVG that scales to its container width.
 */

import { useMemo } from "react";

// ---------------------------------------------------------------------------
// LineChart — for trends over time
// ---------------------------------------------------------------------------

export type LineChartPoint = {
  label: string;
  value: number;
};

export function LineChart({
  data,
  height = 200,
  color = "var(--primary)",
  fillColor = "var(--primary)",
  fillOpacity = 0.12,
  showDots = true,
  showGrid = true,
  yMax,
}: {
  data: LineChartPoint[];
  height?: number;
  color?: string;
  fillColor?: string;
  fillOpacity?: number;
  showDots?: boolean;
  showGrid?: boolean;
  yMax?: number;
}) {
  const width = 600; // viewBox width — scales responsively
  const padding = { top: 16, right: 16, bottom: 28, left: 36 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const { points, max, min, gridLines } = useMemo(() => {
    if (data.length === 0) {
      return { points: [], max: 1, min: 0, gridLines: [0, 0.25, 0.5, 0.75, 1] };
    }
    const vals = data.map((d) => d.value);
    const dataMax = Math.max(...vals, 1);
    const dataMin = Math.min(...vals, 0);
    const range = dataMax - dataMin || 1;
    const pad = range * 0.1;
    const effectiveMax = yMax ?? dataMax + pad;
    const effectiveMin = Math.max(0, dataMin - pad);
    const stepX = data.length > 1 ? chartW / (data.length - 1) : chartW;

    const pts = data.map((d, i) => ({
      x: padding.left + i * stepX,
      y: padding.top + chartH - ((d.value - effectiveMin) / (effectiveMax - effectiveMin)) * chartH,
      label: d.label,
      value: d.value,
    }));
    const lines = [0, 0.25, 0.5, 0.75, 1].map((t) => effectiveMin + t * (effectiveMax - effectiveMin));
    return { points: pts, max: effectiveMax, min: effectiveMin, gridLines: lines };
  }, [data, chartW, chartH, padding.left, padding.top, yMax]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height }}>
        No data
      </div>
    );
  }

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const fillD = `${pathD} L${points[points.length - 1].x},${padding.top + chartH} L${points[0].x},${padding.top + chartH} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none" role="img">
      {/* Grid lines */}
      {showGrid ? (
        <g stroke="var(--border)" strokeWidth={0.5} strokeDasharray="2,2">
          {gridLines.map((v, i) => {
            const y = padding.top + chartH - ((v - min) / (max - min || 1)) * chartH;
            return <line key={i} x1={padding.left} x2={width - padding.right} y1={y} y2={y} />;
          })}
        </g>
      ) : null}

      {/* Y axis labels */}
      <g fill="var(--muted-foreground)" fontSize={9} textAnchor="end">
        {gridLines.map((v, i) => {
          const y = padding.top + chartH - ((v - min) / (max - min || 1)) * chartH;
          return <text key={i} x={padding.left - 4} y={y + 3}>{Math.round(v)}</text>;
        })}
      </g>

      {/* Area fill */}
      <path d={fillD} fill={fillColor} fillOpacity={fillOpacity} stroke="none" />

      {/* Line */}
      <path d={pathD} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

      {/* Dots */}
      {showDots ? (
        points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill={color} stroke="var(--card)" strokeWidth={1.5} />
        ))
      ) : null}

      {/* X axis labels (every Nth) */}
      <g fill="var(--muted-foreground)" fontSize={9} textAnchor="middle">
        {points.map((p, i) => {
          const step = Math.max(1, Math.floor(points.length / 6));
          if (i % step !== 0 && i !== points.length - 1) return null;
          return (
            <text key={i} x={p.x} y={height - 8}>
              {p.label.length > 8 ? p.label.slice(5) : p.label}
            </text>
          );
        })}
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// BarChart — for category comparisons
// ---------------------------------------------------------------------------

export type BarChartItem = {
  label: string;
  value: number;
  color?: string;
};

export function BarChart({
  data,
  height = 220,
  defaultColor = "var(--primary)",
  horizontal = false,
}: {
  data: BarChartItem[];
  height?: number;
  defaultColor?: string;
  horizontal?: boolean;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height }}>
        No data
      </div>
    );
  }

  if (horizontal) {
    return (
      <div className="space-y-2" style={{ minHeight: height }}>
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-24 text-xs text-muted-foreground truncate text-right">{d.label}</div>
            <div className="flex-1 h-6 rounded bg-accent/40 overflow-hidden relative">
              <div
                className="h-full rounded transition-all"
                style={{
                  width: `${(d.value / max) * 100}%`,
                  backgroundColor: d.color || defaultColor,
                }}
              />
              <span className="absolute inset-y-0 right-2 flex items-center text-[10px] font-medium text-muted-foreground">
                {d.value}
              </span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Vertical bars
  return (
    <div className="flex items-end gap-2" style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
          <div className="w-full flex-1 flex items-end">
            <div
              className="w-full rounded-t transition-all hover:opacity-80"
              style={{
                height: `${(d.value / max) * 100}%`,
                backgroundColor: d.color || defaultColor,
                minHeight: 4,
              }}
              title={`${d.label}: ${d.value}`}
            />
          </div>
          <div className="text-[10px] text-muted-foreground truncate w-full text-center">{d.label}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DonutChart — for proportions / status breakdowns
// ---------------------------------------------------------------------------

export type DonutSlice = {
  label: string;
  value: number;
  color: string;
};

export function DonutChart({
  data,
  size = 160,
  thickness = 24,
  centerLabel,
  centerValue,
}: {
  data: DonutSlice[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string | number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx = size / 2;
  const cy = size / 2;

  if (total === 0) {
    return (
      <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height: size }}>
        No data
      </div>
    );
  }

  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="var(--accent)" strokeWidth={thickness} />
        {data.map((slice, i) => {
          const fraction = slice.value / total;
          const dash = fraction * circumference;
          const seg = (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={slice.color}
              strokeWidth={thickness}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          );
          offset += dash;
          return seg;
        })}
        {centerValue != null ? (
          <text x={cx} y={cy - 2} textAnchor="middle" fontSize={20} fontWeight={600} fill="var(--foreground)">
            {centerValue}
          </text>
        ) : null}
        {centerLabel ? (
          <text x={cx} y={cy + 16} textAnchor="middle" fontSize={10} fill="var(--muted-foreground)">
            {centerLabel}
          </text>
        ) : null}
      </svg>
      <ul className="space-y-1 text-xs">
        {data.map((slice, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: slice.color }} />
            <span className="text-muted-foreground">{slice.label}</span>
            <span className="font-medium ml-auto">{slice.value}</span>
            <span className="text-muted-foreground text-[10px]">
              ({Math.round((slice.value / total) * 100)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkline — tiny inline trend indicator for KPI cards
// ---------------------------------------------------------------------------

export function Sparkline({
  data,
  width = 80,
  height = 24,
  color = "var(--primary)",
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (data.length === 0) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = data.length > 1 ? width / (data.length - 1) : width;
  const points = data.map((v, i) => `${i * step},${height - ((v - min) / range) * height}`);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="inline-block">
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// ProgressBar — for completion stats
// ---------------------------------------------------------------------------

export function ProgressBar({
  value,
  max = 100,
  color = "var(--primary)",
  height = 8,
  showLabel = false,
}: {
  value: number;
  max?: number;
  color?: string;
  height?: number;
  showLabel?: boolean;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 rounded-full bg-accent overflow-hidden" style={{ height }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      {showLabel ? (
        <span className="text-[10px] text-muted-foreground tabular-nums w-8 text-right">
          {Math.round(pct)}%
        </span>
      ) : null}
    </div>
  );
}
