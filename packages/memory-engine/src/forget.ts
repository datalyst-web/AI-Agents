import { randomUUID } from "node:crypto";
import type { Prisma } from "@chat-agent/db";

/**
 * A customer can request their memory be reset or forgotten — this must be
 * a supported, auditable action, not a manual database operation
 * (CLAUDE.md Memory Engine rules). fulfillForgetRequest() is the only
 * sanctioned way to delete CrossConversationMemoryFact rows.
 */
export async function createForgetRequest(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; agentId: string; customerIdentityId: string },
): Promise<{ id: string }> {
  return tx.memoryForgetRequest.create({
    data: {
      id: randomUUID(),
      tenantId: params.tenantId,
      agentId: params.agentId,
      customerIdentityId: params.customerIdentityId,
    },
    select: { id: true },
  });
}

export async function fulfillForgetRequest(
  tx: Prisma.TransactionClient,
  params: { requestId: string; tenantId: string; fulfilledByUserId?: string },
): Promise<void> {
  const request = await tx.memoryForgetRequest.findFirstOrThrow({
    where: { id: params.requestId, tenantId: params.tenantId },
  });

  await tx.crossConversationMemoryFact.deleteMany({
    where: { tenantId: params.tenantId, customerIdentityId: request.customerIdentityId },
  });

  await tx.memoryForgetRequest.update({
    where: { id: params.requestId },
    data: { fulfilledAt: new Date(), fulfilledByUserId: params.fulfilledByUserId },
  });
}
