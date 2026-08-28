/**
 * "The client dashboard should visibly distinguish content added by staff
 * vs. content added by the client themselves" — CLAUDE.md's Managed Setup
 * Service section. Used on every knowledge-source/agent-edit row.
 */
export function ContentSourceTag({ source }: { source: "CLIENT" | "STAFF_MANAGED_SETUP" }) {
  if (source === "CLIENT") return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/10 px-2 py-0.5 text-[11px] font-medium text-brand-link ring-1 ring-inset ring-brand-500/25">
      Added by AI Setup Team
    </span>
  );
}
