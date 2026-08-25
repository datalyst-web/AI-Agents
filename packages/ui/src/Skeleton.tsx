export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-shimmer rounded-md bg-[linear-gradient(90deg,rgba(255,255,255,0.04)_25%,rgba(255,255,255,0.09)_37%,rgba(255,255,255,0.04)_63%)] bg-[length:400%_100%] ${className}`}
    />
  );
}

export function StatTileSkeleton() {
  return (
    <div className="rounded-xl2 border border-surface-border bg-surface-raised p-5 shadow-card">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>
      <Skeleton className="mt-4 h-8 w-16" />
    </div>
  );
}

export function CardRowSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="divide-y divide-surface-border">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between px-5 py-3.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}
