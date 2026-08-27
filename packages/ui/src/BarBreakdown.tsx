export interface BarBreakdownItem {
  label: string;
  value: number;
  tone?: "brand" | "success" | "warning" | "danger" | "info" | "neutral";
}

const TONE_COLOR: Record<NonNullable<BarBreakdownItem["tone"]>, string> = {
  brand: "#7288ff",
  success: "#2fbf71",
  warning: "#e8a53d",
  danger: "#e5484d",
  info: "#4a9eff",
  // Ties to the theme token (not a fixed white) so a neutral bar stays
  // visible against its track in light mode too — a literal white-based
  // rgba here nearly vanished on a light (near-white) track.
  neutral: "rgb(var(--color-foreground) / 0.3)",
};

/** Horizontal magnitude comparison across a fixed, small set of categories — always direct-labeled, never color-alone. */
export function BarBreakdown({ items }: { items: BarBreakdownItem[] }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="space-y-3">
      {items.map((item) => {
        const color = TONE_COLOR[item.tone ?? "neutral"];
        const pct = Math.max((item.value / max) * 100, item.value > 0 ? 2 : 0);
        return (
          <div key={item.label}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium text-foreground/70">{item.label}</span>
              <span className="tabular-nums text-foreground/50">{item.value.toLocaleString()}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-foreground/5">
              <div
                className="h-full rounded-full transition-[width] duration-500 ease-out"
                style={{ width: `${pct}%`, backgroundColor: color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
