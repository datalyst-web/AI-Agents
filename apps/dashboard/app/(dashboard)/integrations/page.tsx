"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Card, CardBody, CardHeader, Badge, Button, Modal, CardRowSkeleton } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

type ChannelType = "TELEGRAM" | "WHATSAPP" | "FACEBOOK_MESSENGER" | "INSTAGRAM";

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
  const { user } = useAuth();
  const [agent, setAgent] = useState<Agent | null | undefined>(undefined);
  const [channels, setChannels] = useState<ChannelConnection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyChannel, setBusyChannel] = useState<ChannelType | null>(null);
  const [connectModal, setConnectModal] = useState<ChannelType | null>(null);

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

  useEffect(() => {
    if (!user) return;
    api
      .listAgents(user.tenantId)
      .then((data) => {
        const agents = data as Agent[];
        const first = agents[0] ?? null;
        setAgent(first);
        if (first) refreshChannels(first.id);
        else setChannels([]);
      })
      .catch((err) => {
        setAgent(null);
        setChannels([]);
        setError(err instanceof ApiError ? err.message : "Could not load your agent.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

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

  const meta = connectModal ? CHANNEL_META[connectModal] : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Integrations</h1>
        <p className="mt-1 text-sm text-foreground/50">
          Connect the channels your customers already use. Your agent replies on every connected channel the same way it does on your website widget.
        </p>
      </div>
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
