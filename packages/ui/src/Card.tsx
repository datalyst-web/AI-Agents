import type { HTMLAttributes, ReactNode } from "react";

export function Card({
  children,
  className = "",
  hover = false,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { hover?: boolean }) {
  return (
    <div
      className={`group relative overflow-hidden rounded-xl2 border border-surface-border bg-surface-raised shadow-card transition-all duration-300 ${
        hover ? "hover:-translate-y-0.5 hover:border-white/15 hover:shadow-card-hover" : ""
      } ${className}`}
      {...rest}
    >
      <div className="pointer-events-none absolute inset-0 bg-card-sheen opacity-60" />
      <div className="relative">{children}</div>
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-surface-border px-5 py-4">
      <div>
        <h3 className="text-sm font-semibold tracking-tight text-white">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-xs text-white/50">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`px-5 py-4 ${className}`}>{children}</div>;
}
