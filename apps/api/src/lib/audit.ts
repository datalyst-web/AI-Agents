import { randomUUID } from "node:crypto";
import type { Prisma } from "@chat-agent/db";
import type { AuditAction, TenantContext } from "@chat-agent/shared-types";

/**
 * Locally-added audit action names that haven't been promoted to the
 * shared `AuditAction` enum yet (packages/shared-types is out of scope for
 * this change set). `audit_log_entries.action` is a plain string column
 * (see schema.prisma), not a DB enum, so widening accepted values here is
 * additive and non-breaking — promote these to shared-types AuditAction
 * later if/when other packages need to reference them too.
 */
type ExtendedAuditAction =
  | AuditAction
  | "human_approval_approved"
  | "human_approval_rejected"
  | "memory:cross_conversation_write"
  | "conversation_marked_resolved"
  | "tenant_theme_updated"
  | "tenant_branding_updated"
  | "tenant_created_by_staff"
  | "tenant_cancelled_by_staff"
  | "tenant_reactivated_by_staff"
  | "channel_connected"
  | "channel_disconnected"
  | "integration_connected"
  | "integration_disconnected"
  | "billing_checkout_initiated"
  | "billing_payment_confirmed"
  | "password_reset_requested"
  | "password_reset_completed";

/**
 * The only sanctioned way to write an AuditLogEntry. Every staff action on
 * a client's behalf — and every security-relevant platform event — must
 * produce one of these (CLAUDE.md "Required audit trail"). Called inside
 * the same withTenant() transaction as the action it's logging so the two
 * are atomic: an agent-publish and its audit row either both commit or
 * neither does.
 */
export async function writeAuditLog(
  tx: Prisma.TransactionClient,
  ctx: TenantContext,
  entry: {
    actorUserId: string;
    agentId?: string;
    action: ExtendedAuditAction;
    contentSource?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.auditLogEntry.create({
    data: {
      id: randomUUID(),
      tenantId: ctx.tenantId,
      agentId: entry.agentId,
      actorUserId: entry.actorUserId,
      actorIsStaff: Boolean(ctx.impersonation),
      action: entry.action,
      contentSource: entry.contentSource,
      metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
      impersonationSessionId: ctx.impersonation?.sessionId,
    },
  });
}
