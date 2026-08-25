import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "bg-white/5 text-white/70 ring-white/10",
  success: "bg-success/10 text-success ring-success/25",
  warning: "bg-warning/10 text-warning ring-warning/25",
  danger: "bg-danger/10 text-danger ring-danger/25",
  info: "bg-info/10 text-info ring-info/25",
  brand: "bg-brand-500/10 text-brand-300 ring-brand-500/25",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${toneClasses[tone]}`}
    >
      {children}
    </span>
  );
}

const AGENT_STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: "neutral",
  CONFIGURING: "info",
  KNOWLEDGE_PROCESSING: "info",
  TESTING: "warning",
  APPROVED: "brand",
  LIVE: "success",
};

/** Maps CLAUDE.md's agent status pipeline (DRAFT -> ... -> LIVE) to a consistent color. */
export function AgentStatusBadge({ status }: { status: string }) {
  return <Badge tone={AGENT_STATUS_TONE[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>;
}

const SUBSCRIPTION_STATE_TONE: Record<string, BadgeTone> = {
  ACTIVE: "success",
  TRIAL: "info",
  PAST_DUE: "warning",
  SUSPENDED: "danger",
  CANCELLED: "neutral",
};

export function SubscriptionStateBadge({ state }: { state: string }) {
  return <Badge tone={SUBSCRIPTION_STATE_TONE[state] ?? "neutral"}>{state.replace(/_/g, " ")}</Badge>;
}
