import { z } from "zod";

/**
 * Every request, query, cache key, and log line in this codebase must be
 * able to produce a TenantContext. Code paths that cannot derive one are
 * not allowed to touch tenant data — see CLAUDE.md principle 1.
 */
export const SubscriptionStateSchema = z.enum([
  "ACTIVE",
  "TRIAL",
  "PAST_DUE",
  "SUSPENDED",
  "CANCELLED",
]);
export type SubscriptionState = z.infer<typeof SubscriptionStateSchema>;

export const ManagedSetupTierSchema = z.enum([
  "SELF_SERVE",
  "ASSISTED_SETUP",
  "FULLY_MANAGED",
]);
export type ManagedSetupTier = z.infer<typeof ManagedSetupTierSchema>;

export const SubscriptionTierSchema = z.enum([
  "STARTER",
  "GROWTH",
  "SCALE",
  "ENTERPRISE",
]);
export type SubscriptionTier = z.infer<typeof SubscriptionTierSchema>;

/** Drives both the dashboard's own chrome and every one of the tenant's widgets — see widgetConfig.routes.ts and apps/widget/src/widget.ts. */
export const DashboardThemeSchema = z.enum([
  "DARK",
  "LIGHT",
]);
export type DashboardTheme = z.infer<typeof DashboardThemeSchema>;

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  subscriptionState: SubscriptionState;
  subscriptionTier: SubscriptionTier;
  managedSetupTier: ManagedSetupTier;
  /** Whether this tenant has contractually delegated staff auto-publish authority. */
  delegatesAutoPublish: boolean;
  dataRetentionDays: number;
  theme: DashboardTheme;
  /** Staff-set white-label console name; falls back to `name` in the UI when unset. */
  brandName: string | null;
  /** Servable API path for the tenant's logo (null when none uploaded) — never the raw storage key. */
  logoUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Carried on every authenticated request/job. Never optional past the auth
 * boundary — request handlers, query builders, cache keys, and vector
 * search calls all take this as a required first argument.
 */
export interface TenantContext {
  tenantId: string;
  agentId?: string;
  /** Present only during a staff "act as tenant" session (Managed Setup). */
  impersonation?: {
    staffUserId: string;
    sessionId: string;
    expiresAt: string;
  };
}

export function assertTenantScoped(ctx: Partial<TenantContext>): asserts ctx is TenantContext {
  if (!ctx.tenantId) {
    throw new Error(
      "Missing tenantId on an operation that requires tenant scoping. " +
        "This is treated as a security bug, not a functional bug — see CLAUDE.md principle 1.",
    );
  }
}
