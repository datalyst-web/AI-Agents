/**
 * The single definition of "this client's subscription has ended", shared
 * by the dashboard lock (plugins/auth.ts), /v1/auth/me, and the customer-
 * facing chat and widget-config routes, so they can never disagree.
 *
 * Lapsed = SUSPENDED or CANCELLED, or a TRIAL whose end date has passed.
 * The last case matters because trialExpirySweep only flips TRIAL to
 * SUSPENDED when it next runs; the date is the truth in between.
 *
 * PAST_DUE is deliberately NOT lapsed: it's the grace period while a
 * renewal is sorted out, and cutting off a paying client's agent then is
 * worse than a short delay in collecting (CLAUDE.md, Usage & Cost Tracking).
 */
export function isSubscriptionLapsed(
  tenant: { subscriptionState: string; trialEndsAt: Date | string | null },
  now: Date = new Date(),
): boolean {
  if (tenant.subscriptionState === "SUSPENDED" || tenant.subscriptionState === "CANCELLED") return true;
  if (tenant.subscriptionState === "TRIAL" && tenant.trialEndsAt) {
    return new Date(tenant.trialEndsAt).getTime() <= now.getTime();
  }
  return false;
}

/**
 * What a lapsed client can still reach: signing in and out, paying
 * (billing), seeing why (usage), and asking for help (support tickets).
 * Matched against the route's registered pattern, not the raw URL, so a
 * crafted path can't slip through.
 */
const OPEN_WHILE_LAPSED = [
  "/v1/auth/",
  "/v1/tenants/:tenantId/billing/",
  "/v1/tenants/:tenantId/usage/",
  "/v1/tenants/:tenantId/support-tickets",
];

export function isRouteOpenWhileLapsed(routePattern: string | undefined): boolean {
  if (!routePattern) return false;
  return OPEN_WHILE_LAPSED.some((prefix) => routePattern.startsWith(prefix));
}

export const SUBSCRIPTION_REQUIRED_MESSAGE =
  "Your subscription has ended. Choose a plan on the Billing page to reactivate your account — everything you set up is still here.";
