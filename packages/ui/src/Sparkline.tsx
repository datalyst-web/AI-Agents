/** Minimal inline trend line for a stat tile — no axes, no interaction, just shape. */
export function Sparkline({
  values,
  tone = "brand",
  width = 88,
  height = 28,
}: {
  values: number[];
  tone?: "brand" | "success" | "danger";
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 3;
  const step = (width - pad * 2) / (values.length - 1);
  const points = values.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (1 - (v - min) / range) * (height - pad * 2);
    return [x, y] as const;
  });
  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const stroke = tone === "success" ? "#2fbf71" : tone === "danger" ? "#e5484d" : "#9db3ff";
  const last = points[points.length - 1]!;
  const [lastX, lastY] = last;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible" aria-hidden>
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
      <circle cx={lastX} cy={lastY} r={2.25} fill={stroke} />
    </svg>
  );
}
