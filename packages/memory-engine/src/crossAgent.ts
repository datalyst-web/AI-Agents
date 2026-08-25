import type { Prisma } from "@chat-agent/db";
import { getCrossConversationFacts } from "./facts.js";

/**
 * Off by default; a tenant must explicitly enable it per pair of agents.
 * Never shared across tenants under any configuration — this is a
 * tenant-isolation boundary per CLAUDE.md, enforced here by always
 * scoping the grant lookup to a single tenantId.
 */
export async function isCrossAgentMemoryEnabled(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; sourceAgentId: string; targetAgentId: string },
): Promise<boolean> {
  if (params.sourceAgentId === params.targetAgentId) return true;
  const grant = await tx.crossAgentMemoryGrant.findUnique({
    where: {
      tenantId_sourceAgentId_targetAgentId: {
        tenantId: params.tenantId,
        sourceAgentId: params.sourceAgentId,
        targetAgentId: params.targetAgentId,
      },
    },
  });
  return grant !== null;
}

/**
 * Reads facts from a peer agent only if a grant exists — throws otherwise
 * rather than silently returning nothing, so callers can't accidentally
 * treat "no grant" the same as "no facts found".
 */
export async function getPeerAgentFacts(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    requestingAgentId: string;
    peerAgentId: string;
    customerIdentityId: string;
  },
): Promise<{ fact: string; confidence: number; createdAt: Date }[]> {
  const enabled = await isCrossAgentMemoryEnabled(tx, {
    tenantId: params.tenantId,
    sourceAgentId: params.peerAgentId,
    targetAgentId: params.requestingAgentId,
  });
  if (!enabled) {
    throw new Error(
      `Cross-agent memory is not enabled from agent ${params.peerAgentId} to ${params.requestingAgentId}.`,
    );
  }
  return getCrossConversationFacts(tx, {
    tenantId: params.tenantId,
    agentId: params.peerAgentId,
    customerIdentityId: params.customerIdentityId,
  });
}
