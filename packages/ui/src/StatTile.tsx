import type { ReactNode } from "react";
import { Sparkline } from "./Sparkline.js";

export function StatTile({
  label,
  value,
  delta,
  deltaTone = "neutral",
  icon,
  trend,
}: {
  label: string;
  value: ReactNode;
  delta?: string;
  deltaTone?: "positive" | "negative" | "neutral";
  icon?: ReactNode;
  trend?: number[];
}) {
  const deltaColor =
    deltaTone === "positive" ? "text-success" : deltaTone === "negative" ? "text-danger" : "text-white/40";
  return (
    <div className="group relative overflow-hidden rounded-xl2 border border-surface-border bg-surface-raised p-5 shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:border-white/15 hover:shadow-card-hover">
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-brand-gradient-soft opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100" />
      <div className="relative flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-white/40">{label}</span>
        {icon ? (
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-white/60 ring-1 ring-inset ring-white/10">
            {icon}
          </span>
        ) : null}
      </div>
      <div className="relative mt-3 flex items-end justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tracking-tight text-white">{value}</span>
          {delta ? <span className={`text-xs font-medium ${deltaColor}`}>{delta}</span> : null}
        </div>
        {trend && trend.length > 1 ? (
          <Sparkline values={trend} tone={deltaTone === "negative" ? "danger" : deltaTone === "positive" ? "success" : "brand"} />
        ) : null}
      </div>
    </div>
  );
}
