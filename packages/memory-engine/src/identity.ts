import { createHash } from "node:crypto";
import type { Prisma } from "@chat-agent/db";

export type IdentifierType =
  | "authenticated_account"
  | "email"
  | "widget_session_cookie"
  | "telegram_chat_id"
  | "whatsapp_phone_number"
  | "facebook_psid"
  | "instagram_igsid";

function hashIdentifier(value: string): string {
  // Identifiers (emails, cookies) are hashed at rest — never stored raw —
  // per the CustomerIdentity.identifierHash column comment in schema.prisma.
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

/**
 * Resolves (or creates) the durable per-customer identity a returning
 * customer is recognized by, keyed per tenant+agent per CLAUDE.md's
 * Memory Engine section — never shared across tenants, and cross-agent
 * only via an explicit CrossAgentMemoryGrant (see crossAgent.ts).
 */
export async function resolveCustomerIdentity(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; agentId: string; identifierType: IdentifierType; identifierValue: string },
): Promise<{ id: string }> {
  const identifierHash = hashIdentifier(params.identifierValue);
  return tx.customerIdentity.upsert({
    where: {
      tenantId_agentId_identifierType_identifierHash: {
        tenantId: params.tenantId,
        agentId: params.agentId,
        identifierType: params.identifierType,
        identifierHash,
      },
    },
    update: {},
    create: {
      tenantId: params.tenantId,
      agentId: params.agentId,
      identifierType: params.identifierType,
      identifierHash,
    },
    select: { id: true },
  });
}
