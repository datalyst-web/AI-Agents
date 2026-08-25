"use client";

import { useMemo, useState } from "react";

export interface LineChartPoint {
  label: string;
  value: number;
}

/**
 * Single-series trend line with a hover crosshair + tooltip. One axis, one
 * hue — per the dataviz mark spec: thin 2px line, rounded data-ends, a soft
 * area fill anchored to the baseline, recessive gridlines, selective direct
 * labels (first/last only, not every point).
 */
export function LineChart({
  data,
  tone = "brand",
  height = 180,
  valueFormatter = (v: number) => v.toLocaleString(),
  zeroLine = false,
}: {
  data: LineChartPoint[];
  tone?: "brand" | "accent";
  height?: number;
  valueFormatter?: (v: number) => string;
  zeroLine?: boolean;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 640;
  const padX = 8;
  const padTop = 16;
  const padBottom = 24;

  const stroke = tone === "accent" ? "#e879f9" : "#9db3ff";
  const fillId = tone === "accent" ? "chart-fill-accent" : "chart-fill-brand";

  const { points, min, max } = useMemo(() => {
    const values = data.map((d) => d.value);
    const min = zeroLine ? Math.min(0, ...values) : Math.min(...values);
    const max = Math.max(...values, min + 1);
    const range = max - min || 1;
    const innerH = height - padTop - padBottom;
    const step = data.length > 1 ? (width - padX * 2) / (data.length - 1) : 0;
    const points = data.map((d, i) => {
      const x = padX + i * step;
      const y = padTop + (1 - (d.value - min) / range) * innerH;
      return { x, y, ...d };
    });
    return { points, min, max };
  }, [data, height, zeroLine]);

  if (points.length === 0) return null;

  const firstPoint = points[0]!;
  const lastPoint = points[points.length - 1]!;
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${lastPoint.x.toFixed(1)},${height - padBottom} L${firstPoint.x.toFixed(1)},${height - padBottom} Z`;
  const zeroY = padTop + (1 - (0 - min) / (max - min || 1)) * (height - padTop - padBottom);
  const hovered = hoverIndex !== null ? points[hoverIndex] : null;
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  function handleMove(e: React.MouseEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    let nearest = 0;
    let nearestDist = Infinity;
    points.forEach((p, i) => {
      const dist = Math.abs(p.x - relX);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    });
    setHoverIndex(nearest);
  }

  return (
    <div className="relative">
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible" preserveAspectRatio="none">
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* recessive gridlines */}
        {[0, 0.5, 1].map((t) => (
          <line
            key={t}
            x1={padX}
            x2={width - padX}
            y1={padTop + t * (height - padTop - padBottom)}
            y2={padTop + t * (height - padTop - padBottom)}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={1}
          />
        ))}
        {zeroLine && min < 0 ? (
          <line x1={padX} x2={width - padX} y1={zeroY} y2={zeroY} stroke="rgba(255,255,255,0.14)" strokeDasharray="3 3" strokeWidth={1} />
        ) : null}

        <path d={areaPath} fill={`url(#${fillId})`} />
        <path d={linePath} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {/* x-axis labels, selective */}
        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={i} x={p.x} y={height - 6} textAnchor="middle" fontSize={10} fill="rgba(255,255,255,0.35)">
              {p.label}
            </text>
          ) : null,
        )}

        {hovered ? (
          <>
            <line x1={hovered.x} x2={hovered.x} y1={padTop} y2={height - padBottom} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
            <circle cx={hovered.x} cy={hovered.y} r={4} fill={stroke} stroke="#08090f" strokeWidth={2} />
          </>
        ) : (
          <circle cx={lastPoint.x} cy={lastPoint.y} r={3} fill={stroke} />
        )}

        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="transparent"
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIndex(null)}
        />
      </svg>

      {hovered ? (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 -translate-y-full rounded-lg border border-white/10 bg-surface-overlay px-2.5 py-1.5 text-xs shadow-card"
          style={{ left: `${(hovered.x / width) * 100}%` }}
        >
          <div className="font-medium text-white">{valueFormatter(hovered.value)}</div>
          <div className="text-[10px] text-white/40">{hovered.label}</div>
        </div>
      ) : null}
    </div>
  );
}
