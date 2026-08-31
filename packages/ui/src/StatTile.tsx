import { useEffect, useRef, useState, type ReactNode } from "react";
import { Sparkline } from "./Sparkline.js";

const NUMERIC_VALUE = /^(-?[\d,]*\.?\d+)(.*)$/;

/**
 * Counts up from 0 to the target on mount/change instead of just appearing —
 * only kicks in for values that parse as a plain number (with an optional
 * prefix/suffix like "%" or "$"); anything else (e.g. "2h 30m", "—") just
 * renders as-is untouched.
 */
function AnimatedNumber({ value }: { value: ReactNode }) {
  const asString = typeof value === "string" || typeof value === "number" ? String(value) : null;
  const match = asString?.match(NUMERIC_VALUE);
  const [display, setDisplay] = useState<string | null>(asString);
  const prevTarget = useRef<number | null>(null);

  useEffect(() => {
    if (!match) {
      setDisplay(asString);
      return;
    }
    const target = Number(match[1]!.replace(/,/g, ""));
    const suffix = match[2] ?? "";
    const decimals = (match[1]!.split(".")[1] ?? "").length;
    if (Number.isNaN(target)) {
      setDisplay(asString);
      return;
    }
    const from = prevTarget.current ?? 0;
    prevTarget.current = target;
    const duration = 700;
    const start = performance.now();
    let raf: number;
    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const current = from + (target - from) * eased;
      setDisplay(`${current.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`);
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asString]);

  return <>{match ? display : value}</>;
}

export function StatTile({
  label,
  value,
  delta,
  deltaTone = "neutral",
  icon,
  trend,
  delayMs = 0,
}: {
  label: string;
  value: ReactNode;
  delta?: string;
  deltaTone?: "positive" | "negative" | "neutral";
  icon?: ReactNode;
  trend?: number[];
  /** Stagger this tile's entrance pop when several sit in a row — pass e.g. `i * 60`. */
  delayMs?: number;
}) {
  const deltaColor =
    deltaTone === "positive" ? "text-success" : deltaTone === "negative" ? "text-danger" : "text-foreground/40";
  return (
    <div
      className="animate-count-in group relative overflow-hidden rounded-xl2 border border-surface-border bg-surface-raised p-5 shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-card-hover"
      style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
    >
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-brand-gradient-soft opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100" />
      <div className="relative flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-foreground/40">{label}</span>
        {icon ? (
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/5 text-foreground/60 ring-1 ring-inset ring-foreground/10">
            {icon}
          </span>
        ) : null}
      </div>
      <div className="relative mt-3 flex items-end justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">
            <AnimatedNumber value={value} />
          </span>
          {delta ? <span className={`text-xs font-medium ${deltaColor}`}>{delta}</span> : null}
        </div>
        {trend && trend.length > 1 ? (
          <Sparkline values={trend} tone={deltaTone === "negative" ? "danger" : deltaTone === "positive" ? "success" : "brand"} />
        ) : null}
      </div>
    </div>
  );
}
