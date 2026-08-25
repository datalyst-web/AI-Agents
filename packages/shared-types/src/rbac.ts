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
  "agent:publish",
  "agent:rollback",
  // Knowledge base
  "knowledge:read",
  "knowledge:write",
  "knowledge:delete",
  // Conversations
  "conversation:read",
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
  // Managed setup / staff
  "managed_setup:act_as_tenant",
  "managed_setup:publish_without_approval",
  // Platform admin
  "platform:manage_tenants",
  "platform:manage_billing_plans",
  "platform:view_audit_log",
]);
export type Permission = z.infer<typeof PermissionSchema>;

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
    "knowledge:read",
    "knowledge:write",
    "knowledge:delete",
    "tool:configure",
    "workflow:read",
    "workflow:write",
    "conversation:read",
    // publish/agent:publish is intentionally excluded by default — see
    // "managed_setup:publish_without_approval" which is granted per-tenant
    // only when delegatesAutoPublish is true.
  ],
  tenant_owner: [
    "agent:read",
    "agent:write",
    "agent:publish",
    "agent:rollback",
    "knowledge:read",
    "knowledge:write",
    "knowledge:delete",
    "conversation:read",
    "conversation:export",
    "tool:configure",
    "tool:execute_high_risk",
    "workflow:read",
    "workflow:write",
    "billing:read",
    "billing:write",
    "team:invite",
    "team:remove",
    "analytics:read",
  ],
  tenant_admin: [
    "agent:read",
    "agent:write",
    "agent:publish",
    "knowledge:read",
    "knowledge:write",
    "knowledge:delete",
    "conversation:read",
    "conversation:export",
    "tool:configure",
    "workflow:read",
    "workflow:write",
    "billing:read",
    "team:invite",
    "analytics:read",
  ],
  tenant_agent_editor: [
    "agent:read",
    "agent:write",
    "knowledge:read",
    "knowledge:write",
    "conversation:read",
    "workflow:read",
    "workflow:write",
    "analytics:read",
  ],
  tenant_viewer: ["agent:read", "knowledge:read", "conversation:read", "analytics:read"],
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
