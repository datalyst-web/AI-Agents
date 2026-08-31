"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, CardBody, CardHeader, Badge, Button, Modal, CardRowSkeleton } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

type ChannelType = "TELEGRAM" | "WHATSAPP" | "FACEBOOK_MESSENGER" | "INSTAGRAM";
type BizVendor = "hubspot" | "zendesk" | "google_calendar";

interface BizIntegration {
  vendor: BizVendor;
  connected: boolean;
  label?: string;
}

const BIZ_META: Record<BizVendor, { label: string; blurb: string; help: string }> = {
  hubspot: {
    label: "HubSpot",
    blurb: "Create leads, contacts, and deals in your CRM as the agent talks to customers.",
    help: "In HubSpot: Settings → Integrations → Private Apps → Create a private app, grant crm.objects.contacts.write and crm.objects.deals.write scopes, then copy its access token.",
  },
  zendesk: {
    label: "Zendesk",
    blurb: "Creates a support ticket when the agent can't resolve an issue directly.",
    help: "In Zendesk: Admin Center → Apps and integrations → APIs → Zendesk API → enable token access, then generate an API token for your account.",
  },
  google_calendar: {
    label: "Google Calendar",
    blurb: "Book and cancel appointments directly on your calendar, confirmed with the customer first.",
    help: "You'll be sent to Google to sign in and approve calendar access — nothing to paste here.",
  },
};

interface ChannelConnection {
  id: string;
  channel: ChannelType;
  status: "PENDING" | "CONNECTED" | "DISCONNECTED" | "ERROR";
  externalLabel: string | null;
  errorMessage: string | null;
  connectedAt: string | null;
}

interface Agent {
  id: string;
  name: string;
  status: string;
}

const CHANNEL_META: Record<
  ChannelType,
  { label: string; blurb: string; idLabel?: string; idPlaceholder?: string; tokenLabel?: string; help: string }
> = {
  TELEGRAM: {
    label: "Telegram",
    blurb: "A self-serve bot your customers can message directly — no Meta review needed.",
    help: "Message @BotFather on Telegram, run /newbot, and paste the bot token it gives you below.",
  },
  WHATSAPP: {
    label: "WhatsApp Business",
    blurb: "Reply to customers on WhatsApp via the Cloud API.",
    idLabel: "Phone number ID",
    idPlaceholder: "e.g. 109876543210987",
    tokenLabel: "Access token",
    help: "From Meta Business Suite → WhatsApp → API Setup: copy the Phone number ID and a permanent access token.",
  },
  FACEBOOK_MESSENGER: {
    label: "Facebook Messenger",
    blurb: "Reply to customers who message your Facebook Page.",
    idLabel: "Page ID",
    idPlaceholder: "e.g. 102938475610283",
    tokenLabel: "Page access token",
    help: "From your Meta App → Messenger → Settings, generate a Page access token for the Page you want connected.",
  },
  INSTAGRAM: {
    label: "Instagram",
    blurb: "Reply to Instagram DMs sent to your connected business account.",
    idLabel: "Instagram Business Account ID",
    idPlaceholder: "e.g. 178234659012345",
    tokenLabel: "Page access token",
    help: "Instagram messaging uses the same Page access token as Messenger — use the Page linked to this Instagram account.",
  },
};

const STATUS_TONE: Record<ChannelConnection["status"], "success" | "warning" | "danger" | "neutral"> = {
  CONNECTED: "success",
  PENDING: "warning",
  ERROR: "danger",
  DISCONNECTED: "neutral",
};

export default function IntegrationsPage() {
  return (
    <Suspense fallback={null}>
      <IntegrationsPageContent />
    </Suspense>
  );
}

function IntegrationsPageContent() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [agent, setAgent] = useState<Agent | null | undefined>(undefined);
  const [channels, setChannels] = useState<ChannelConnection[] | null>(null);
  const [bizIntegrations, setBizIntegrations] = useState<BizIntegration[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyChannel, setBusyChannel] = useState<ChannelType | null>(null);
  const [connectModal, setConnectModal] = useState<ChannelType | null>(null);

  const [busyVendor, setBusyVendor] = useState<BizVendor | null>(null);
  const [bizConnectModal, setBizConnectModal] = useState<BizVendor | null>(null);
  const [hubspotToken, setHubspotToken] = useState("");
  const [zendeskSubdomain, setZendeskSubdomain] = useState("");
  const [zendeskEmail, setZendeskEmail] = useState("");
  const [zendeskApiToken, setZendeskApiToken] = useState("");
  const [bizSaving, setBizSaving] = useState(false);
  const [bizFormError, setBizFormError] = useState<string | null>(null);

  const [botToken, setBotToken] = useState("");
  const [externalId, setExternalId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function refreshChannels(agentId: string) {
    if (!user) return;
    api
      .listChannels(user.tenantId, agentId)
      .then((data) => setChannels(data))
      .catch((err) => {
        setChannels([]);
        setError(err instanceof ApiError ? err.message : "Could not load integrations.");
      });
  }

  function refreshBizIntegrations(agentId: string) {
    if (!user) return;
    api
      .listBusinessIntegrations(user.tenantId, agentId)
      .then((data) => setBizIntegrations(data))
      .catch((err) => {
        setBizIntegrations([]);
        setError(err instanceof ApiError ? err.message : "Could not load your connected tools.");
      });
  }

  useEffect(() => {
    if (!user) return;
    api
      .listAgents(user.tenantId)
      .then((data) => {
        const agents = data as Agent[];
        const first = agents[0] ?? null;
        setAgent(first);
        if (first) {
          refreshChannels(first.id);
          refreshBizIntegrations(first.id);
        } else {
          setChannels([]);
          setBizIntegrations([]);
        }
      })
      .catch((err) => {
        setAgent(null);
        setChannels([]);
        setBizIntegrations([]);
        setError(err instanceof ApiError ? err.message : "Could not load your agent.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Google Calendar's OAuth callback redirects back here with a plain
  // query param (it's a full-page browser redirect from Google, not an API
  // response) — surface the result once, then strip the params so a page
  // refresh doesn't re-show a stale banner.
  useEffect(() => {
    const connected = searchParams.get("connected");
    const integrationError = searchParams.get("integration_error");
    if (!connected && !integrationError) return;
    if (connected) setNotice(`${BIZ_META[connected as BizVendor]?.label ?? connected} connected.`);
    if (integrationError) setError(`Could not connect Google Calendar: ${integrationError.replace(/_/g, " ")}`);
    router.replace("/integrations");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function connectionFor(channel: ChannelType) {
    return channels?.find((c) => c.channel === channel && c.status === "CONNECTED");
  }

  function openConnectModal(channel: ChannelType) {
    setBotToken("");
    setExternalId("");
    setAccessToken("");
    setFormError(null);
    setConnectModal(channel);
  }

  async function submitConnect(e: FormEvent) {
    e.preventDefault();
    if (!user || !agent || !connectModal) return;
    setSaving(true);
    setFormError(null);
    try {
      if (connectModal === "TELEGRAM") {
        await api.connectTelegram(user.tenantId, agent.id, botToken);
      } else if (connectModal === "WHATSAPP") {
        await api.connectWhatsapp(user.tenantId, agent.id, externalId, accessToken);
      } else if (connectModal === "FACEBOOK_MESSENGER") {
        await api.connectMessenger(user.tenantId, agent.id, externalId, accessToken);
      } else {
        await api.connectInstagram(user.tenantId, agent.id, externalId, accessToken);
      }
      setConnectModal(null);
      refreshChannels(agent.id);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not connect this channel.");
    } finally {
      setSaving(false);
    }
  }

  async function disconnect(channel: ChannelType) {
    if (!user || !agent) return;
    setBusyChannel(channel);
    setError(null);
    try {
      await api.disconnectChannel(user.tenantId, agent.id, channel);
      refreshChannels(agent.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not disconnect this channel.");
    } finally {
      setBusyChannel(null);
    }
  }

  function bizConnectionFor(vendor: BizVendor) {
    return bizIntegrations?.find((b) => b.vendor === vendor && b.connected);
  }

  function openBizConnectModal(vendor: BizVendor) {
    setHubspotToken("");
    setZendeskSubdomain("");
    setZendeskEmail("");
    setZendeskApiToken("");
    setBizFormError(null);
    setBizConnectModal(vendor);
  }

  async function connectGoogleCalendar() {
    if (!user || !agent) return;
    setBusyVendor("google_calendar");
    setError(null);
    try {
      const { authUrl } = await api.startGoogleCalendarConnect(user.tenantId, agent.id);
      window.location.href = authUrl;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start the Google Calendar connection.");
      setBusyVendor(null);
    }
  }

  async function submitBizConnect(e: FormEvent) {
    e.preventDefault();
    if (!user || !agent || !bizConnectModal) return;
    setBizSaving(true);
    setBizFormError(null);
    try {
      if (bizConnectModal === "hubspot") {
        await api.connectHubspot(user.tenantId, agent.id, hubspotToken);
      } else if (bizConnectModal === "zendesk") {
        await api.connectZendesk(user.tenantId, agent.id, zendeskSubdomain, zendeskEmail, zendeskApiToken);
      }
      setBizConnectModal(null);
      refreshBizIntegrations(agent.id);
    } catch (err) {
      setBizFormError(err instanceof ApiError ? err.message : "Could not connect this tool.");
    } finally {
      setBizSaving(false);
    }
  }

  async function disconnectBiz(vendor: BizVendor) {
    if (!user || !agent) return;
    setBusyVendor(vendor);
    setError(null);
    try {
      await api.disconnectBusinessIntegration(user.tenantId, agent.id, vendor);
      refreshBizIntegrations(agent.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not disconnect this tool.");
    } finally {
      setBusyVendor(null);
    }
  }

  const meta = connectModal ? CHANNEL_META[connectModal] : null;
  const bizMeta = bizConnectModal ? BIZ_META[bizConnectModal] : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Integrations</h1>
        <p className="mt-1 text-sm text-foreground/50">
          Connect the channels your customers already use. Your agent replies on every connected channel the same way it does on your website widget.
        </p>
      </div>
      {notice ? <p className="text-xs text-success">{notice}</p> : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}

      {agent === undefined || channels === null ? (
        <Card>
          <CardRowSkeleton />
        </Card>
      ) : agent === null ? (
        <Card>
          <CardBody className="py-10 text-center text-sm text-foreground/50">
            Create your agent first, then come back here to connect channels.
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(Object.keys(CHANNEL_META) as ChannelType[]).map((channel) => {
            const active = connectionFor(channel);
            const cm = CHANNEL_META[channel];
            return (
              <Card key={channel}>
                <CardHeader
                  title={cm.label}
                  subtitle={cm.blurb}
                  action={active ? <Badge tone={STATUS_TONE[active.status]}>Connected</Badge> : <Badge tone="neutral">Not connected</Badge>}
                />
                <CardBody className="flex items-center justify-between gap-3">
                  <div className="text-xs text-foreground/40">
                    {active ? active.externalLabel ?? "Connected" : "—"}
                  </div>
                  {active ? (
                    <button
                      onClick={() => disconnect(channel)}
                      disabled={busyChannel === channel}
                      className="text-xs font-medium text-foreground/40 transition-colors hover:text-danger disabled:opacity-50"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <Button variant="secondary" onClick={() => openConnectModal(channel)}>
                      Connect
                    </Button>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {agent ? (
        <div>
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-foreground">Business tools</h2>
            <p className="mt-0.5 text-xs text-foreground/40">
              CRM, calendar, and support tools your agent can act on directly, gated by the confirmation/approval rules you'd expect for anything it creates or books.
            </p>
          </div>
          {bizIntegrations === null ? (
            <Card>
              <CardRowSkeleton />
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {(Object.keys(BIZ_META) as BizVendor[]).map((vendor) => {
                const active = bizConnectionFor(vendor);
                const bm = BIZ_META[vendor];
                return (
                  <Card key={vendor}>
                    <CardHeader
                      title={bm.label}
                      subtitle={bm.blurb}
                      action={active ? <Badge tone="success">Connected</Badge> : <Badge tone="neutral">Not connected</Badge>}
                    />
                    <CardBody className="flex items-center justify-between gap-3">
                      <div className="text-xs text-foreground/40">{active?.label ?? "—"}</div>
                      {active ? (
                        <button
                          onClick={() => disconnectBiz(vendor)}
                          disabled={busyVendor === vendor}
                          className="text-xs font-medium text-foreground/40 transition-colors hover:text-danger disabled:opacity-50"
                        >
                          Disconnect
                        </button>
                      ) : vendor === "google_calendar" ? (
                        <Button variant="secondary" disabled={busyVendor === vendor} onClick={connectGoogleCalendar}>
                          {busyVendor === vendor ? "Redirecting…" : "Connect with Google"}
                        </Button>
                      ) : (
                        <Button variant="secondary" onClick={() => openBizConnectModal(vendor)}>
                          Connect
                        </Button>
                      )}
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      <Modal
        open={bizConnectModal !== null}
        onClose={() => setBizConnectModal(null)}
        title={bizMeta ? `Connect ${bizMeta.label}` : ""}
        subtitle={bizMeta?.help}
      >
        {bizConnectModal === "hubspot" ? (
          <form onSubmit={submitBizConnect} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground/60">Private app access token</label>
              <input
                required
                type="password"
                value={hubspotToken}
                onChange={(e) => setHubspotToken(e.target.value)}
                placeholder="pat-na1-..."
                className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            {bizFormError ? <p className="text-xs text-danger">{bizFormError}</p> : null}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setBizConnectModal(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={bizSaving}>
                {bizSaving ? "Connecting…" : "Connect"}
              </Button>
            </div>
          </form>
        ) : bizConnectModal === "zendesk" ? (
          <form onSubmit={submitBizConnect} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground/60">Subdomain</label>
              <input
                required
                value={zendeskSubdomain}
                onChange={(e) => setZendeskSubdomain(e.target.value)}
                placeholder="e.g. acme (from acme.zendesk.com)"
                className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground/60">Account email</label>
              <input
                required
                type="email"
                value={zendeskEmail}
                onChange={(e) => setZendeskEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground/60">API token</label>
              <input
                required
                type="password"
                value={zendeskApiToken}
                onChange={(e) => setZendeskApiToken(e.target.value)}
                className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            {bizFormError ? <p className="text-xs text-danger">{bizFormError}</p> : null}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setBizConnectModal(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={bizSaving}>
                {bizSaving ? "Connecting…" : "Connect"}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal open={connectModal !== null} onClose={() => setConnectModal(null)} title={meta ? `Connect ${meta.label}` : ""} subtitle={meta?.help}>
        {meta && (
          <form onSubmit={submitConnect} className="space-y-3">
            {connectModal === "TELEGRAM" ? (
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground/60">Bot token</label>
                <input
                  required
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder="123456789:AAExampleTokenFromBotFather"
                  className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground/60">{meta.idLabel}</label>
                  <input
                    required
                    value={externalId}
                    onChange={(e) => setExternalId(e.target.value)}
                    placeholder={meta.idPlaceholder}
                    className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground/60">{meta.tokenLabel}</label>
                  <input
                    required
                    type="password"
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    placeholder="EAAG..."
                    className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
                  />
                </div>
              </>
            )}
            {formError ? <p className="text-xs text-danger">{formError}</p> : null}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setConnectModal(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Connecting…" : "Connect"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
