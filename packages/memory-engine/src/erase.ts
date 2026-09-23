import type { Prisma } from "@chat-agent/db";

/**
 * A full erasure of one customer's data for one agent — what a legal
 * "delete my data" request means, as opposed to fulfillForgetRequest(),
 * which only clears remembered facts so the agent stops recognising them.
 *
 * Removes their conversations (messages cascade), their remembered facts,
 * and the encrypted handle used to message them back. The CustomerIdentity
 * row itself stays: it holds only a one-way hash after this, and deleting
 * it would cascade away the MemoryForgetRequest records that are the proof
 * the erasure happened (CLAUDE.md: a forget must be "a supported,
 * auditable action, not a manual database operation").
 *
 * Used by Meta's data-deletion callback (apps/api/src/routes/channels.routes.ts)
 * and available for the same request arriving any other way.
 */
export async function eraseCustomerData(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; customerIdentityId: string },
): Promise<{ conversationsDeleted: number; factsDeleted: number }> {
  const facts = await tx.crossConversationMemoryFact.deleteMany({
    where: { tenantId: params.tenantId, customerIdentityId: params.customerIdentityId },
  });
  const conversations = await tx.conversation.deleteMany({
    where: { tenantId: params.tenantId, customerIdentityId: params.customerIdentityId },
  });
  await tx.customerIdentity.update({
    where: { id: params.customerIdentityId },
    data: { encryptedExternalHandle: null },
  });
  return { conversationsDeleted: conversations.count, factsDeleted: facts.count };
}
