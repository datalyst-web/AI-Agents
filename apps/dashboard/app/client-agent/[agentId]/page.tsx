"use client";

/**
 * Standalone agent URL (CLAUDE.md Deployment Surfaces:
 * `https://ai.yourplatform.com/client-agent`, optional custom domain per
 * client). Public, unauthenticated — same trust model as the embeddable
 * widget (a signed per-agent widget token, never the dashboard's JWT), just
 * rendered as a dedicated full page instead of a floating bubble.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

interface WidgetConfig {
  agentId: string;
  name: string;
  greeting: string;
  avatarUrl?: string;
  tone: string;
  widgetToken: string;
}
interface PendingConfirmation {
  toolCallId: string;
  toolName: string;
  confirmationPrompt: string;
}
interface Message {
  id: string;
  role: "customer" | "agent";
  text: string;
}

export default function ClientAgentPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sessionCookieRef = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    fetch(`${API_BASE}/v1/widget-config/${agentId}`)
      .then((r) => {
        if (!r.ok) throw new Error("This assistant isn't available right now.");
        return r.json();
      })
      .then((data: WidgetConfig) => {
        setConfig(data);
        setMessages([{ id: crypto.randomUUID(), role: "agent", text: data.greeting }]);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "This assistant isn't available right now."));
  }, [agentId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function sendMessage(text: string, confirmToolCallId?: string) {
    if (!config) return;
    setSendError(null);
    if (text) setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "customer", text }]);
    setPendingConfirmation(null);
    setSending(true);
    try {
      const resp = await fetch(`${API_BASE}/v1/chat/${agentId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.widgetToken}` },
        body: JSON.stringify({
          conversationId,
          message: text || "(customer confirmed the pending action)",
          customerIdentifier: { type: "widget_session_cookie", value: sessionCookieRef.current },
          confirmToolCallId,
        }),
      });
      if (!resp.ok) throw new Error("Sorry, I'm having trouble responding right now. Please try again shortly.");
      const data = (await resp.json()) as { conversationId: string; reply: string; pendingConfirmation?: PendingConfirmation };
      setConversationId(data.conversationId);
      if (data.reply) setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "agent", text: data.reply }]);
      if (data.pendingConfirmation) setPendingConfirmation(data.pendingConfirmation);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    void sendMessage(text);
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-white/50">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[48rem] -translate-x-1/2 rounded-full bg-brand-gradient opacity-[0.12] blur-3xl" />

      <header className="relative flex items-center gap-3 border-b border-surface-border px-5 py-4 sm:px-8">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-gradient shadow-glow">
          {config?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={config.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
          ) : (
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path d="M2 8a6 6 0 1 1 6 6" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="12" cy="12" r="1.4" fill="white" />
            </svg>
          )}
        </div>
        <div>
          <div className="text-sm font-semibold text-white">{config?.name ?? "Loading…"}</div>
          <div className="flex items-center gap-1.5 text-xs text-white/40">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
            Online now
          </div>
        </div>
      </header>

      <main ref={scrollRef} className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 overflow-y-auto px-5 py-6 sm:px-8">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "customer" ? "justify-end" : "justify-start"} animate-fade-up`}>
            <span
              className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                m.role === "customer"
                  ? "rounded-br-md bg-brand-gradient text-white shadow-glow"
                  : "rounded-bl-md bg-white/[0.06] text-white/90 ring-1 ring-inset ring-white/10"
              }`}
            >
              {m.text}
            </span>
          </div>
        ))}
        {sending ? (
          <div className="flex justify-start">
            <span className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-white/[0.06] px-4 py-3 ring-1 ring-inset ring-white/10">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/50" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/50 [animation-delay:0.15s]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/50 [animation-delay:0.3s]" />
            </span>
          </div>
        ) : null}
        {!config && !loadError ? <p className="text-center text-sm text-white/30">Connecting…</p> : null}
      </main>

      {pendingConfirmation ? (
        <div className="relative mx-auto w-full max-w-2xl border-t border-warning/25 bg-warning/[0.06] px-5 py-3 sm:px-8">
          <p className="mb-2 text-xs text-white/80">{pendingConfirmation.confirmationPrompt}</p>
          <div className="flex gap-2">
            <button
              onClick={() => void sendMessage("", pendingConfirmation.toolCallId)}
              className="rounded-lg bg-success/15 px-3.5 py-2 text-sm font-medium text-success transition-colors hover:bg-success/25"
            >
              Confirm
            </button>
            <button
              onClick={() => {
                setPendingConfirmation(null);
                setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "agent", text: "No problem, I won't go ahead with that." }]);
              }}
              className="rounded-lg px-3.5 py-2 text-sm font-medium text-white/60 transition-colors hover:bg-white/5 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {sendError ? <p className="relative mx-auto w-full max-w-2xl px-5 pt-2 text-xs text-danger sm:px-8">{sendError}</p> : null}

      <form onSubmit={onSubmit} className="relative mx-auto flex w-full max-w-2xl gap-2 border-t border-surface-border p-4 sm:px-8">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          disabled={!config || sending}
          className="flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
        />
        <button
          type="submit"
          disabled={!config || sending || !input.trim()}
          className="inline-flex items-center justify-center rounded-lg bg-brand-gradient px-5 text-sm font-medium text-white shadow-glow transition-all duration-300 hover:shadow-glow-lg disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
