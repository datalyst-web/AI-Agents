import { randomUUID } from "node:crypto";
import type { Prisma } from "@chat-agent/db";

export interface WriteFactParams {
  tenantId: string;
  agentId: string;
  customerIdentityId: string;
  /** Must be something the customer actually stated — never an inference. See CLAUDE.md. */
  fact: string;
  sourceConversationId: string;
  sourceMessageId: string;
  confidence: number;
  retentionDays?: number;
}

export interface AuditSink {
  record(entry: {
    tenantId: string;
    agentId?: string;
    actorUserId: string;
    actorIsStaff: boolean;
    action: "memory_forget_fulfilled" | string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
}

/**
 * Writes a cross-conversation memory fact. This package has no dependency
 * on apps/api's audit module (writeAuditLog), so it cannot call it
 * directly — the caller (apps/api's agent-engine, engine/agentLoop.ts) is
 * responsible for pairing every call to this function with a
 * writeAuditLog(..., { action: "memory:cross_conversation_write" }) call in
 * the SAME transaction, immediately after, so the write still goes through
 * the same audit pipeline as any other agent action (CLAUDE.md Memory
 * Engine section) even though the enforcement lives one level up. Never
 * call this from a code path that skips that pairing, and never as a
 * silent side-write from an unrelated code path.
 */
export async function writeCrossConversationFact(
  tx: Prisma.TransactionClient,
  params: WriteFactParams,
): Promise<{ id: string }> {
  const expiresAt = params.retentionDays
    ? new Date(Date.now() + params.retentionDays * 24 * 60 * 60 * 1000)
    : undefined;

  return tx.crossConversationMemoryFact.create({
    data: {
      id: randomUUID(),
      tenantId: params.tenantId,
      agentId: params.agentId,
      customerIdentityId: params.customerIdentityId,
      fact: params.fact,
      sourceConversationId: params.sourceConversationId,
      sourceMessageId: params.sourceMessageId,
      confidence: params.confidence,
      expiresAt,
    },
    select: { id: true },
  });
}

/** Retrieves durable facts for the Understand/Retrieve stage — never presented as verbatim customer quotes. */
export async function getCrossConversationFacts(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; agentId: string; customerIdentityId: string },
): Promise<{ fact: string; confidence: number; createdAt: Date }[]> {
  const now = new Date();
  return tx.crossConversationMemoryFact.findMany({
    where: {
      tenantId: params.tenantId,
      agentId: params.agentId,
      customerIdentityId: params.customerIdentityId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { fact: true, confidence: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}
