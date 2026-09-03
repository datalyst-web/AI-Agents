"use client";

import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { StatTile, StatTileSkeleton, Card, CardHeader, CardBody, Badge, Button, Modal, LineChart, BarBreakdown } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  overageTokens: number;
  estimatedOverageUsd: number;
  byProvider: Record<string, { inputTokens: number; outputTokens: number; requests: number }>;
  limits: { includedTokensPerMonth: number; hardCapTokensPerMonth: number | null } | null;
}
interface DailyUsage {
  date: string;
  totalTokens: number;
}
type Tier = "STARTER" | "GROWTH" | "SCALE";
interface Plans {
  currentTier: Tier | "ENTERPRISE";
  currentState: "ACTIVE" | "TRIAL" | "PAST_DUE" | "SUSPENDED" | "CANCELLED";
  plans: { tier: Tier; priceUsd: string }[];
  paynowConfigured: boolean;
}
interface PaynowPaymentRow {
  id: string;
  reference: string;
  description: string;
  amountUsd: string;
  status: "PENDING" | "PAID" | "CANCELLED" | "FAILED";
  createdAt: string;
}

const PROVIDER_TONE = { anthropic: "brand", openai: "success", gemini: "info" } as const;
const STATE_TONE = { ACTIVE: "success", TRIAL: "info", PAST_DUE: "warning", SUSPENDED: "danger", CANCELLED: "neutral" } as const;
const PAYMENT_TONE = { PAID: "success", PENDING: "warning", CANCELLED: "neutral", FAILED: "danger" } as const;

export default function BillingPage() {
  return (
    <Suspense fallback={null}>
      <BillingPageContent />
    </Suspense>
  );
}

function BillingPageContent() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const isOwner = user?.role === "tenant_owner";

  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [daily, setDaily] = useState<DailyUsage[] | null>(null);
  const [plans, setPlans] = useState<Plans | null>(null);
  const [payments, setPayments] = useState<PaynowPaymentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [returnNotice, setReturnNotice] = useState<{ tone: "success" | "warning" | "danger"; text: string } | null>(null);

  const [checkoutTier, setCheckoutTier] = useState<Tier | null>(null);
  const [method, setMethod] = useState<"card" | "mobile">("card");
  const [phone, setPhone] = useState("");
  const [mobileMethod, setMobileMethod] = useState<"ecocash" | "onemoney">("ecocash");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [mobileInstructions, setMobileInstructions] = useState<string | null>(null);
  const pollAttempts = useRef(0);

  function refreshBilling() {
    if (!user) return;
    api
      .getBillingPlans(user.tenantId)
      .then(setPlans)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load plan info."));
    api
      .listPaynowPayments(user.tenantId)
      .then(setPayments)
      .catch(() => setPayments([]));
  }

  useEffect(() => {
    if (!user) return;
    api
      .getUsageSummary(user.tenantId)
      .then((d) => setUsage(d as UsageSummary))
      .catch((err) => {
        setUsage({ totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0, overageTokens: 0, estimatedOverageUsd: 0, byProvider: {}, limits: null });
        setError(err instanceof ApiError ? err.message : "Could not load usage.");
      });
    api
      .getUsageDaily(user.tenantId, 30)
      .then((d) => setDaily(d))
      .catch(() => setDaily([]));
    refreshBilling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Paynow redirects the customer's browser back here after the hosted
  // checkout page — that redirect is NOT proof of payment (never verified,
  // just a UX courtesy), so instead of trusting it, poll our own backend
  // (which only ever changes status once Paynow's hash-verified webhook
  // confirms it) until it resolves or we give up.
  useEffect(() => {
    const reference = searchParams.get("paynowReference");
    if (!reference || !user) return;
    router.replace("/billing");
    pollAttempts.current = 0;

    const poll = () => {
      api
        .getPaynowPayment(user.tenantId, reference)
        .then((payment) => {
          if (payment.status === "PAID") {
            setReturnNotice({ tone: "success", text: `Payment confirmed — ${payment.description} is now active.` });
            refreshBilling();
            return;
          }
          if (payment.status === "CANCELLED" || payment.status === "FAILED") {
            setReturnNotice({ tone: "danger", text: `Payment ${payment.status.toLowerCase()} — nothing was charged.` });
            return;
          }
          pollAttempts.current += 1;
          if (pollAttempts.current < 10) {
            setTimeout(poll, 2000);
          } else {
            setReturnNotice({
              tone: "warning",
              text: "Still waiting on confirmation from Paynow — this can take a minute. Refresh shortly, or check Recent payments below.",
            });
          }
        })
        .catch(() => undefined);
    };
    poll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, user]);

  function openCheckout(tier: Tier) {
    setCheckoutTier(tier);
    setMethod("card");
    setPhone("");
    setMobileMethod("ecocash");
    setFormError(null);
    setMobileInstructions(null);
  }

  async function submitCheckout(e: FormEvent) {
    e.preventDefault();
    if (!user || !checkoutTier) return;
    setSaving(true);
    setFormError(null);
    try {
      if (method === "card") {
        const { redirectUrl } = await api.startPaynowCheckout(user.tenantId, checkoutTier);
        window.location.href = redirectUrl;
      } else {
        const { instructions } = await api.startPaynowMobileCheckout(user.tenantId, checkoutTier, phone, mobileMethod);
        setMobileInstructions(instructions);
      }
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not start checkout.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Billing & Usage</h1>
        <p className="mt-1 text-sm text-foreground/50">Your plan, recent payments, and month-to-date usage against your plan&apos;s included limits.</p>
      </div>
      {returnNotice ? <p className={`text-xs text-${returnNotice.tone}`}>{returnNotice.text}</p> : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}

      {usage?.limits ? <UsageLimitAlert usage={usage} limits={usage.limits} /> : null}

      <Card>
        <CardHeader
          title="Plan"
          subtitle={plans ? `Currently on ${plans.currentTier}` : undefined}
          action={plans ? <Badge tone={STATE_TONE[plans.currentState]}>{plans.currentState}</Badge> : undefined}
        />
        <CardBody>
          {!plans ? (
            <div className="h-16 animate-pulse rounded-lg bg-foreground/[0.03]" />
          ) : !plans.paynowConfigured ? (
            <p className="text-sm text-foreground/50">Payments aren&apos;t set up yet on this platform — contact us to upgrade your plan.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {plans.plans.map((plan) => {
                const isCurrent = plan.tier === plans.currentTier;
                return (
                  <div key={plan.tier} className={`rounded-lg border p-4 ${isCurrent ? "border-brand-400/50 bg-brand-500/5" : "border-foreground/10"}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-foreground">{plan.tier}</span>
                      {isCurrent ? <Badge tone="brand">Current</Badge> : null}
                    </div>
                    <div className="mt-1 text-2xl font-semibold text-foreground">
                      ${plan.priceUsd}
                      <span className="text-xs font-normal text-foreground/40">/mo</span>
                    </div>
                    {isOwner ? (
                      <Button
                        variant={isCurrent ? "secondary" : "primary"}
                        className="mt-3 w-full"
                        disabled={isCurrent}
                        onClick={() => openCheckout(plan.tier)}
                      >
                        {isCurrent ? "Current plan" : "Switch to this plan"}
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          {!isOwner ? <p className="mt-3 text-xs text-foreground/35">Only the account owner can change plans or make payments.</p> : null}
        </CardBody>
      </Card>

      {usage ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatTile label="Input tokens" value={usage.totalInputTokens.toLocaleString()} />
          <StatTile label="Output tokens" value={usage.totalOutputTokens.toLocaleString()} />
          <StatTile label="Overage tokens" value={usage.overageTokens.toLocaleString()} deltaTone={usage.overageTokens > 0 ? "negative" : "neutral"} />
          <StatTile label="Est. overage cost" value={`$${usage.estimatedOverageUsd.toFixed(2)}`} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatTileSkeleton />
          <StatTileSkeleton />
          <StatTileSkeleton />
          <StatTileSkeleton />
        </div>
      )}

      <Card>
        <CardHeader title="Usage over time" subtitle="Last 30 days, total input + output tokens per day." />
        <CardBody>
          {daily ? (
            daily.some((d) => d.totalTokens > 0) ? (
              <LineChart data={daily.map((d) => ({ label: new Date(d.date).getDate().toString(), value: d.totalTokens }))} tone="brand" />
            ) : (
              <p className="py-6 text-center text-sm text-foreground/40">No usage recorded yet.</p>
            )
          ) : (
            <div className="h-[180px] animate-pulse rounded-lg bg-foreground/[0.03]" />
          )}
        </CardBody>
      </Card>

      {usage ? (
        <Card>
          <CardHeader title="By provider" subtitle="Provider identity is never shown to your customers — this view is for your own cost visibility." />
          <CardBody>
            {Object.keys(usage.byProvider).length === 0 ? (
              <p className="py-4 text-center text-sm text-foreground/40">No requests yet this month.</p>
            ) : (
              <BarBreakdown
                items={Object.entries(usage.byProvider).map(([provider, stats]) => ({
                  label: `${provider} · ${stats.requests} req`,
                  value: stats.inputTokens + stats.outputTokens,
                  tone: PROVIDER_TONE[provider as keyof typeof PROVIDER_TONE] ?? "neutral",
                }))}
              />
            )}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Recent payments" />
        <CardBody className="divide-y divide-surface-border p-0">
          {!payments ? (
            <div className="p-5">
              <div className="h-10 animate-pulse rounded-lg bg-foreground/[0.03]" />
            </div>
          ) : payments.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-foreground/40">No payments yet.</p>
          ) : (
            payments.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-y-2 px-5 py-3.5 text-sm">
                <div>
                  <div className="text-foreground">{p.description}</div>
                  <div className="text-xs text-foreground/40">{new Date(p.createdAt).toLocaleString()}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums text-foreground/70">${p.amountUsd}</span>
                  <Badge tone={PAYMENT_TONE[p.status]}>{p.status}</Badge>
                </div>
              </div>
            ))
          )}
        </CardBody>
      </Card>

      <Modal open={checkoutTier !== null} onClose={() => setCheckoutTier(null)} title={checkoutTier ? `Switch to ${checkoutTier}` : ""}>
        {checkoutTier && (
          <form onSubmit={submitCheckout} className="space-y-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMethod("card")}
                className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium ${method === "card" ? "border-brand-400 bg-brand-500/10 text-foreground" : "border-foreground/10 text-foreground/60"}`}
              >
                Card / Paynow page
              </button>
              <button
                type="button"
                onClick={() => setMethod("mobile")}
                className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium ${method === "mobile" ? "border-brand-400 bg-brand-500/10 text-foreground" : "border-foreground/10 text-foreground/60"}`}
              >
                EcoCash / OneMoney
              </button>
            </div>

            {method === "mobile" ? (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground/60">Mobile money</label>
                  <select
                    value={mobileMethod}
                    onChange={(e) => setMobileMethod(e.target.value as "ecocash" | "onemoney")}
                    className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
                  >
                    <option value="ecocash" className="bg-surface-overlay text-foreground">EcoCash</option>
                    <option value="onemoney" className="bg-surface-overlay text-foreground">OneMoney</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground/60">Phone number</label>
                  <input
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0777000000"
                    className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
                  />
                </div>
              </>
            ) : (
              <p className="text-xs text-foreground/40">You&apos;ll be taken to Paynow&apos;s secure page to complete payment, then brought back here.</p>
            )}

            {mobileInstructions ? (
              <p className="rounded-lg bg-success/10 px-3 py-2.5 text-xs text-success ring-1 ring-inset ring-success/25">{mobileInstructions}</p>
            ) : null}
            {formError ? <p className="text-xs text-danger">{formError}</p> : null}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setCheckoutTier(null)}>
                {mobileInstructions ? "Close" : "Cancel"}
              </Button>
              {!mobileInstructions ? (
                <Button type="submit" disabled={saving}>
                  {saving ? "Starting…" : method === "card" ? "Continue to Paynow" : "Send payment prompt"}
                </Button>
              ) : null}
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

/**
 * Proactive warning before overage charges actually land, not just the
 * after-the-fact "Overage tokens" stat tile further down this page — a
 * tenant should see this coming with enough runway to upgrade, not
 * discover it on next month's bill.
 */
function UsageLimitAlert({
  usage,
  limits,
}: {
  usage: UsageSummary;
  limits: { includedTokensPerMonth: number; hardCapTokensPerMonth: number | null };
}) {
  if (limits.includedTokensPerMonth <= 0) return null;
  const pct = usage.totalTokens / limits.includedTokensPerMonth;
  if (pct < 0.8) return null;

  const overCap = limits.hardCapTokensPerMonth !== null && usage.totalTokens >= limits.hardCapTokensPerMonth;
  const overIncluded = pct >= 1;
  const message = overCap
    ? "You've hit your plan's hard usage cap this month — new requests may be blocked until next month or you upgrade."
    : overIncluded
      ? `You're ${Math.round((pct - 1) * 100)}% over your plan's included usage this month — overage charges are accruing.`
      : `You've used ${Math.round(pct * 100)}% of your plan's included usage this month.`;

  // Full literal class strings, not string-interpolated (`bg-${tone}/10`)
  // — Tailwind's build-time scanner can't see through a template literal,
  // so a dynamic class name here would silently render unstyled in
  // production even though it looks correct in source.
  const TONE_CLASSES = {
    danger: "bg-danger/10 text-danger ring-danger/25",
    warning: "bg-warning/10 text-warning ring-warning/25",
    info: "bg-info/10 text-info ring-info/25",
  } as const;
  const toneClasses = TONE_CLASSES[overCap ? "danger" : overIncluded ? "warning" : "info"];

  return <div className={`rounded-xl3 px-5 py-3.5 text-sm font-medium ring-1 ring-inset ${toneClasses}`}>{message}</div>;
}
