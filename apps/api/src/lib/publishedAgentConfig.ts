import type { Prisma } from "@chat-agent/db";

/**
 * A LIVE agent has two copies of its configuration:
 *
 * - the working copy, on the Agent row — what staff edit and what the
 *   dashboard's test chat uses;
 * - the published copy, the AgentVersionSnapshot for agent.version — what
 *   customers are actually served.
 *
 * Editing a LIVE agent changes only the working copy. It reaches customers
 * when the client approves it and it's published again (a new version and
 * snapshot), or when staff publish under delegated authority. This is
 * CLAUDE.md's "staff should not be able to unilaterally publish a client's
 * agent without client sign-off" applied to changes after go-live, not just
 * the first launch.
 *
 * A LIVE agent with no snapshot for its version (only possible for agents
 * published before snapshots existed) falls back to the working copy.
 */
export interface AgentConfig {
  personality: unknown;
  modelRouting: unknown;
  enabledToolIds: string[];
}

type AgentRow = AgentConfig & { id: string; tenantId: string; status: string; version: string };

export async function findPublishedSnapshot(tx: Prisma.TransactionClient, agent: AgentRow) {
  if (agent.status !== "LIVE") return null;
  return tx.agentVersionSnapshot.findFirst({
    where: { agentId: agent.id, tenantId: agent.tenantId, version: agent.version },
    orderBy: { createdAt: "desc" },
  });
}

/** The configuration customers are served. */
export async function servedAgentConfig(tx: Prisma.TransactionClient, agent: AgentRow): Promise<AgentConfig> {
  const snapshot = await findPublishedSnapshot(tx, agent);
  if (!snapshot) return { personality: agent.personality, modelRouting: agent.modelRouting, enabledToolIds: agent.enabledToolIds };
  return { personality: snapshot.personality, modelRouting: snapshot.modelRouting, enabledToolIds: snapshot.enabledToolIds };
}

/** True when a LIVE agent's working copy differs from what customers are served. */
export async function hasUnpublishedChanges(tx: Prisma.TransactionClient, agent: AgentRow): Promise<boolean> {
  const snapshot = await findPublishedSnapshot(tx, agent);
  if (!snapshot) return false;
  return !sameConfig(agent, snapshot);
}

export function sameConfig(a: AgentConfig, b: AgentConfig): boolean {
  return (
    stableStringify(a.personality) === stableStringify(b.personality) &&
    stableStringify(a.modelRouting) === stableStringify(b.modelRouting) &&
    stableStringify([...a.enabledToolIds].sort()) === stableStringify([...b.enabledToolIds].sort())
  );
}

/** JSON with object keys sorted, so a merge that reorders keys isn't a "change". */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
