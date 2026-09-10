"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Card, CardBody, CardHeader, Badge, Button, CardRowSkeleton } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

interface InboxItem {
  id: string;
  agentId: string;
  agentName: string;
  channel: string;
  startedAt: string;
  handoffRequested: boolean;
  humanTakeoverActive: boolean;
  takenOverByUserId: string | null;
  lastMessage: { role: string; content: string; createdAt: string } | null;
}
interface ThreadMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

/**
 * Every currently open conversation across all of a tenant's agents, most
 * recently active first — polled rather than pushed since there's no
 * websocket/SSE channel in this platform yet (same constraint the widget's
 * own takeover polling works around).
 */
export default function LiveInboxPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  function refresh() {
    if (!user) return;
    api
      .getLiveInbox(user.tenantId)
      .then((d) => {
        setItems(d);
        setError(null);
      })
      .catch((err) => {
        setItems((prev) => prev ?? []);
        setError(err instanceof ApiError ? err.message : "Could not load the live inbox.");
      });
  }
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 8000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function takeover(conversationId: string) {
    if (!user) return;
    setBusyId(conversationId);
    setError(null);
    try {
      await api.takeoverConversation(user.tenantId, conversationId);
      setOpenId(conversationId);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not take over this conversation.");
    } finally {
      setBusyId(null);
    }
  }

  async function release(conversationId: string) {
    if (!user) return;
    setBusyId(conversationId);
    setError(null);
    try {
      await api.releaseConversation(user.tenantId, conversationId);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not release this conversation back to the AI.");
    } finally {
      setBusyId(null);
    }
  }

  const open = items?.find((i) => i.id === openId) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Live Inbox</h1>
        <p className="mt-1 text-sm text-foreground/50">
          Every conversation happening right now, across all your agents. Take one over to reply as a human — the AI stays paused on that conversation until you release it.
        </p>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}

      <Card>
        <CardHeader title="Open conversations" subtitle={items ? `${items.length} in progress` : undefined} />
        {items === null ? (
          <CardRowSkeleton rows={4} />
        ) : (
          <CardBody className="divide-y divide-surface-border p-0">
            {items.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-foreground/40">No conversations in progress right now.</p>
            ) : (
              items.map((i) => (
                <div key={i.id} className="flex flex-col gap-3 px-5 py-3.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge tone="neutral">{i.agentName}</Badge>
                      <Badge tone="neutral">{i.channel.replace(/_/g, " ").toLowerCase()}</Badge>
                      {i.handoffRequested ? <Badge tone="warning">Handoff requested</Badge> : null}
                      {i.humanTakeoverActive ? <Badge tone="brand">You&apos;re handling this</Badge> : null}
                    </div>
                    {i.lastMessage ? (
                      <p className="mt-1 truncate text-xs text-foreground/50">
                        <span className="font-medium">{i.lastMessage.role}:</span> {i.lastMessage.content}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => setOpenId(i.id)}
                      className="text-xs font-medium text-foreground/40 transition-colors hover:text-foreground/70"
                    >
                      View
                    </button>
                    {i.humanTakeoverActive ? (
                      <Button variant="secondary" onClick={() => release(i.id)} disabled={busyId === i.id}>
                        {busyId === i.id ? "Releasing…" : "Release to AI"}
                      </Button>
                    ) : (
                      <Button onClick={() => takeover(i.id)} disabled={busyId === i.id}>
                        {busyId === i.id ? "Taking over…" : "Take over"}
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </CardBody>
        )}
      </Card>

      {open ? <ThreadPanel item={open} onClose={() => setOpenId(null)} onTakeover={() => takeover(open.id)} onRelease={() => release(open.id)} busy={busyId === open.id} /> : null}
    </div>
  );
}

function ThreadPanel({
  item,
  onClose,
  onTakeover,
  onRelease,
  busy,
}: {
  item: InboxItem;
  onClose: () => void;
  onTakeover: () => void;
  onRelease: () => void;
  busy: boolean;
}) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  function refresh() {
    if (!user) return;
    api
      .getConversationMessages(user.tenantId, item.id)
      .then(setMessages)
      .catch(() => setMessages((prev) => prev ?? []));
  }
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function sendReply(e: FormEvent) {
    e.preventDefault();
    if (!user || !reply.trim()) return;
    setSending(true);
    setError(null);
    try {
      const result = await api.sendStaffReply(user.tenantId, item.id, reply.trim());
      setReply("");
      refresh();
      // The message is always recorded either way — this is specifically
      // about whether it also reached the customer out on Telegram/
      // WhatsApp/Messenger/Instagram (a real API call, which can fail:
      // token revoked, channel disconnected, no delivery address on file).
      if (result.externalDeliveryError) setError(`Recorded, but not delivered: ${result.externalDeliveryError}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send that reply.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={`Conversation — ${item.agentName}`}
        subtitle={`${item.channel.replace(/_/g, " ").toLowerCase()} — ${item.humanTakeoverActive ? "you're replying as a human" : "take over below to reply directly"}`}
        action={
          <div className="flex items-center gap-2">
            {item.humanTakeoverActive ? (
              <Button variant="secondary" onClick={onRelease} disabled={busy}>
                {busy ? "Releasing…" : "Release to AI"}
              </Button>
            ) : (
              <Button onClick={onTakeover} disabled={busy}>
                {busy ? "Taking over…" : "Take over"}
              </Button>
            )}
            <button onClick={onClose} className="text-xs font-medium text-foreground/40 hover:text-foreground/70">
              Close
            </button>
          </div>
        }
      />
      <CardBody className="space-y-3">
        <div className="max-h-96 space-y-2 overflow-y-auto rounded-lg bg-foreground/[0.03] p-3">
          {messages === null ? (
            <p className="text-xs text-foreground/40">Loading…</p>
          ) : messages.length === 0 ? (
            <p className="text-xs text-foreground/40">No messages yet.</p>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === "customer" ? "justify-start" : "justify-end"}`}>
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-xs ${
                    m.role === "customer"
                      ? "bg-foreground/10 text-foreground"
                      : m.role === "staff"
                        ? "bg-brand-500/20 text-foreground"
                        : "bg-brand-gradient text-white"
                  }`}
                >
                  <div className="mb-0.5 text-[10px] uppercase tracking-wide opacity-60">{m.role}</div>
                  {m.content}
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
        {error ? <p className="text-xs text-danger">{error}</p> : null}
        {item.humanTakeoverActive ? (
          <form onSubmit={sendReply} className="flex gap-2">
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Type your reply…"
              className="flex-1 rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
            />
            <Button type="submit" disabled={sending || !reply.trim()}>
              {sending ? "Sending…" : "Send"}
            </Button>
          </form>
        ) : (
          <p className="text-xs text-foreground/40">Take this conversation over to reply directly — while it&apos;s not taken over, the AI keeps answering automatically.</p>
        )}
      </CardBody>
    </Card>
  );
}
