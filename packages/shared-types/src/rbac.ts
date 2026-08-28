import { z } from "zod";

/**
 * Platform-level roles are never tenant-scoped. Tenant-level roles are
 * always scoped to exactly one tenant via TenantContext. Staff roles
 * (setup_specialist) are distinct from both, per CLAUDE.md's "Internal
 * roles & access" — they gain tenant access only through a logged,
 * time-boxed impersonation session, never standing access.
 */
export const RoleSchema = z.enum([
  // Platform layer — internal, never assigned to clients
  "platform_admin",
  "setup_specialist",
  // Tenant layer — client-side users
  "tenant_owner",
  "tenant_admin",
  "tenant_agent_editor",
  "tenant_viewer",
]);
export type Role = z.infer<typeof RoleSchema>;

export const PermissionSchema = z.enum([
  // Agent config
  "agent:read",
  "agent:write",
  // Send a message to an agent (test console) without full config-edit
  // rights — split out so clients can test their own agent under the
  // "staff configures, client only tests/approves" model without also
  // getting write access to its config. See CLAUDE.md Managed Setup.
  "agent:test",
  "agent:publish",
  "agent:rollback",
  // Knowledge base
  "knowledge:read",
  "knowledge:write",
  "knowledge:delete",
  // Conversations
  "conversation:read",
  "conversation:write",
  "conversation:export",
  // Tools & integrations
  "tool:configure",
  "tool:execute_high_risk",
  // Workflows
  "workflow:read",
  "workflow:write",
  // Billing
  "billing:read",
  "billing:write",
  // Team management
  "team:invite",
  "team:remove",
  // Analytics
  "analytics:read",
  // Cosmetic, per-tenant self-service preferences that aren't agent
  // config (currently: dashboard/widget theme) — deliberately its own
  // permission so it survives even when a tenant's agent:write is
  // revoked under the fully-managed model.
  "tenant:customize",
  // Managed setup / staff
  "managed_setup:act_as_tenant",
  "managed_setup:publish_without_approval",
  // Platform admin
  "platform:manage_tenants",
  "platform:manage_billing_plans",
  "platform:view_audit_log",
]);
export type Permission = z.infer<typeof PermissionSchema>;

/**
 * Fully-managed-by-default model: staff (setup_specialist, via a logged
 * impersonation session) own all agent/knowledge/tool/workflow
 * configuration. Client roles keep only what they need to test their
 * already-configured agent, approve it for launch, handle live
 * conversations/approvals, and manage their own billing/team/theme —
 * never config-write. See CLAUDE.md "Managed Setup Service".
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  platform_admin: [
    "platform:manage_tenants",
    "platform:manage_billing_plans",
    "platform:view_audit_log",
    "analytics:read",
  ],
  setup_specialist: [
    // Granted ONLY while an active impersonation session exists — the
    // permission check must additionally verify TenantContext.impersonation
    // is present and unexpired. See packages/db StaffImpersonationSession.
    "agent:read",
    "agent:write",
    "agent:test",
    "knowledge:read",
    "knowledge:write",
    "knowledge:delete",
    "tool:configure",
    "workflow:read",
    "workflow:write",
    "conversation:read",
    "conversation:write",
    "tenant:customize",
    // Staff use the client's own Overview/Billing pages while
    // impersonating (CLAUDE.md: "exact same tenant-scoped tools a client
    // would use") — without this, those pages 403 on every usage call
    // for every impersonation session, not just as a display glitch.
    "analytics:read",
    "billing:read",
    // publish/agent:publish is intentionally excluded by default — see
    // "managed_setup:publish_without_approval" which is granted per-tenant
    // only when delegatesAutoPublish is true.
  ],
  tenant_owner: [
    "agent:read",
    "agent:test",
    "agent:publish",
    "knowledge:read",
    "conversation:read",
    "conversation:write",
    "conversation:export",
    "tool:execute_high_risk",
    "billing:read",
    "billing:write",
    "team:invite",
    "team:remove",
    "analytics:read",
    "tenant:customize",
  ],
  tenant_admin: [
    "agent:read",
    "agent:test",
    "agent:publish",
    "knowledge:read",
    "conversation:read",
    "conversation:write",
    "conversation:export",
    "billing:read",
    "team:invite",
    "analytics:read",
    "tenant:customize",
  ],
  tenant_agent_editor: [
    "agent:read",
    "agent:test",
    "knowledge:read",
    "conversation:read",
    "conversation:write",
    "analytics:read",
  ],
  tenant_viewer: ["agent:read", "knowledge:read", "conversation:read", "analytics:read"],
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
