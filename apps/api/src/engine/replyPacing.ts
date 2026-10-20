import { createHash, randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import type { FastifyBaseLogger } from "fastify";
import { withPlatformContext, withTenant } from "@chat-agent/db";
import { hashIdentifier } from "@chat-agent/memory-engine";
import { QUEUE_NAMES } from "@chat-agent/queue";
import { AgentPersonalitySchema, type ReplyPacing } from "@chat-agent/shared-types";
import type { AppContext } from "../lib/context.js";
import { decryptChannelCredential, encryptChannelCredential } from "../lib/channelCrypto.js";
import { graphApiSend, telegramCall } from "../lib/channelSend.js";
import { servedAgentConfig } from "../lib/publishedAgentConfig.js";
import { checkUsageAllowance } from "../lib/usageEnforcement.js";
import { processCustomerMessage, type AgentTurnResult } from "./agentLoop.js";
import { isAffirmative, isNegative, notice } from "./language.js";
import type { PreparedMessage } from "../lib/channelMedia.js";
import { env } from "../env.js";

/**
 * Reply pacing for messaging channels (ReplyPacingSchema in shared-types):
 * an agent can answer instantly, after a fixed delay, or at a human-like
 * pace, optionally merging a burst of quick messages into one reply.
 *
 * A delayed reply can't wait inside the webhook request — Meta and
 * Telegram retry webhooks that don't answer quickly — so the inbound
 * message is queued with the queue's durable `delaySeconds` and answered
 * by this process's consumer (startChannelReplyConsumer, started by
 * server.ts). Customer text and handles are encrypted in the queued job
 * and in Redis, the same way CustomerIdentity stores handles.
 *
 * Never delayed: a conversation a person has taken over (staff must see the
 * message straight away), confirmations from Telegram buttons, and — with
 * urgentBypass — a customer who says it's urgent.
 */

export type PaceableChannel = "WHATSAPP" | "TELEGRAM" | "FACEBOOK_MESSENGER" | "INSTAGRAM";
type IdentifierType = "telegram_chat_id" | "whatsapp_phone_number" | "facebook_psid" | "instagram_igsid";

export interface ChannelInbound {
  connectionId: string;
  tenantId: string;
  agentId: string;
  channel: PaceableChannel;
  /** WhatsApp phone-number id; null for Telegram/Messenger/Instagram sends. */
  externalId: string | null;
  identifierType: IdentifierType;
  sender: string;
  text: string;
  /** WhatsApp's message id — lets us mark it read and show typing. */
  inboundMessageId?: string;
  /** A voice note's transcript or a photo/file placeholder (lib/channelMedia.ts); `text` is what the agent reads. */
  prepared?: Omit<PreparedMessage, "text">;
}

interface ChannelReplyJob {
  connectionId: string;
  tenantId: string;
  agentId: string;
  channel: PaceableChannel;
  externalId: string | null;
  identifierType: IdentifierType;
  encSender: string;
  /** Present when messages aren't merged: this job answers exactly this one. */
  encText?: string;
  /** Present when merged: only the job holding the latest token answers. */
  burstToken?: string;
  inboundMessageId?: string;
  pacing: ReplyPacing;
  /** Voice/media details; `encStored` is encrypted like the text. Never merged into a burst. */
  inputKind?: PreparedMessage["inputKind"];
  encStored?: string;
  transcriptionUsage?: PreparedMessage["transcriptionUsage"];
}

const MAX_DELAY_SECONDS = 900;
const URGENT = /\b(urgent|urgently|emergency|asap|immediately|right now|straight away|help me now)\b|!{3,}/i;

export function isUrgent(text: string): boolean {
  return URGENT.test(text);
}

/** The served pacing for this channel, or null when it should answer instantly. */
export function pacingFor(personality: unknown, channel: PaceableChannel): ReplyPacing | null {
  const parsed = AgentPersonalitySchema.safeParse(personality);
  const pacing = parsed.success ? parsed.data.replyPacing : undefined;
  if (!pacing || pacing.mode === "instant" || !pacing.channels.includes(channel)) return null;
  return pacing;
}

/**
 * How long to hold the reply back. Human-like: a short pause to "notice"
 * the message, reading time for what they wrote (~20 characters a second)
 * and time to compose, varied by ±15% so it never feels mechanical.
 */
export function computeDelayMs(pacing: ReplyPacing, inboundText: string, random: () => number = Math.random): number {
  if (pacing.mode === "instant") return 0;
  if (pacing.mode === "fixed") return Math.min(pacing.delaySeconds, MAX_DELAY_SECONDS) * 1000;
  const lo = Math.min(pacing.minSeconds, pacing.maxSeconds);
  const hi = Math.min(Math.max(pacing.minSeconds, pacing.maxSeconds), MAX_DELAY_SECONDS);
  const base = 2 + inboundText.length / 20 + 4;
  const varied = base * (0.85 + random() * 0.3);
  return Math.round(Math.min(hi, Math.max(lo, varied)) * 1000);
}

/** How long "typing…" shows before the reply lands: about 18 characters a second, 1.5–8s. */
export function typingMs(pacing: ReplyPacing, reply: string): number {
  if (!pacing.typingIndicator) return 0;
  if (pacing.mode === "fixed") return 2000;
  return Math.round(Math.min(8, Math.max(1.5, reply.length / 18)) * 1000);
}

let redis: Redis | null = null;
function burstStore(): Redis {
  redis ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
  return redis;
}
function burstKey(connectionId: string, sender: string): string {
  return `${env.REDIS_KEY_PREFIX ?? "chat:"}pace:${connectionId}:${createHash("sha256").update(sender).digest("hex").slice(0, 32)}`;
}
const BURST_TTL_SECONDS = 24 * 60 * 60;
/** Takes the burst only if `token` is still the latest one — atomically, so a message arriving now is never lost. */
const TAKE_BURST_SCRIPT = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return nil end
local msgs = redis.call('LRANGE', KEYS[1], 0, -1)
redis.call('DEL', KEYS[1], KEYS[2])
return msgs
`;
/** Takes whatever is waiting regardless of token — used when answering immediately. */
const FLUSH_BURST_SCRIPT = `
local msgs = redis.call('LRANGE', KEYS[1], 0, -1)
redis.call('DEL', KEYS[1], KEYS[2])
return msgs
`;

function queueTarget(): string {
  return QUEUE_NAMES.channelReply;
}

/** True when a person is handling this customer's chat right now. */
async function humanIsHandling(ctx: AppContext, inbound: ChannelInbound): Promise<boolean> {
  return withTenant(ctx.prisma, { tenantId: inbound.tenantId, agentId: inbound.agentId }, async (tx) => {
    const identity = await tx.customerIdentity.findUnique({
      where: {
        tenantId_agentId_identifierType_identifierHash: {
          tenantId: inbound.tenantId,
          agentId: inbound.agentId,
          identifierType: inbound.identifierType,
          identifierHash: hashIdentifier(inbound.sender),
        },
      },
      select: { id: true },
    });
    if (!identity) return false;
    const latest = await tx.conversation.findFirst({
      where: { tenantId: inbound.tenantId, agentId: inbound.agentId, channel: inbound.channel, customerIdentityId: identity.id },
      orderBy: { startedAt: "desc" },
      select: { humanTakeoverActive: true },
    });
    return Boolean(latest?.humanTakeoverActive);
  });
}

/**
 * The action waiting for this customer's yes, if any. WhatsApp, Messenger
 * and Instagram have no confirm button, so the customer types their answer;
 * a yes in any language (engine/language.ts) confirms exactly this pending
 * call. Anything else goes to the model as usual, which drops the pending
 * action — the same as tapping Cancel.
 */
async function pendingToolCallId(ctx: AppContext, inbound: ChannelInbound): Promise<string | null> {
  return withTenant(ctx.prisma, { tenantId: inbound.tenantId, agentId: inbound.agentId }, async (tx) => {
    const identity = await tx.customerIdentity.findUnique({
      where: {
        tenantId_agentId_identifierType_identifierHash: {
          tenantId: inbound.tenantId,
          agentId: inbound.agentId,
          identifierType: inbound.identifierType,
          identifierHash: hashIdentifier(inbound.sender),
        },
      },
      select: { id: true },
    });
    if (!identity) return null;
    const open = await tx.conversation.findFirst({
      where: { tenantId: inbound.tenantId, agentId: inbound.agentId, channel: inbound.channel, customerIdentityId: identity.id, outcome: "IN_PROGRESS" },
      orderBy: { startedAt: "desc" },
      select: { pendingToolCall: true },
    });
    const pending = open?.pendingToolCall as { id?: unknown } | null | undefined;
    return typeof pending?.id === "string" ? pending.id : null;
  });
}

async function servedPacing(ctx: AppContext, inbound: ChannelInbound): Promise<ReplyPacing | null> {
  return withTenant(ctx.prisma, { tenantId: inbound.tenantId, agentId: inbound.agentId }, async (tx) => {
    const agent = await tx.agent.findFirst({ where: { id: inbound.agentId, tenantId: inbound.tenantId } });
    if (!agent) return null;
    const config = await servedAgentConfig(tx, agent);
    return pacingFor(config.personality, inbound.channel);
  });
}

/**
 * Entry point for every inbound text on a messaging channel. Answers now,
 * or queues the answer according to the agent's reply pacing.
 */
export async function handleChannelInbound(ctx: AppContext, inbound: ChannelInbound, credential: string): Promise<void> {
  const pacing = await servedPacing(ctx, inbound).catch(() => null);
  const immediate =
    !pacing ||
    (pacing.urgentBypass && isUrgent(inbound.text)) ||
    ((isAffirmative(inbound.text) || isNegative(inbound.text)) && Boolean(await pendingToolCallId(ctx, inbound).catch(() => null))) ||
    (await humanIsHandling(ctx, inbound).catch(() => false));
  if (immediate) {
    // Anything still waiting in a burst goes out with this answer, and the
    // waiting job then finds nothing to do.
    let text = inbound.text;
    if (pacing?.mergeBurst && !inbound.prepared) {
      const key = burstKey(inbound.connectionId, inbound.sender);
      const waiting = ((await burstStore().eval(FLUSH_BURST_SCRIPT, 2, `${key}:msgs`, `${key}:token`).catch(() => null)) as string[] | null) ?? [];
      if (waiting.length) text = [...waiting.map((m) => decryptChannelCredential(m)), inbound.text].join("\n");
    }
    await answer(ctx, { ...inbound, text, credential, pacing: pacing ?? null });
    return;
  }

  const delaySeconds = Math.max(1, Math.round(computeDelayMs(pacing, inbound.text) / 1000));
  const base: Omit<ChannelReplyJob, "encText" | "burstToken"> = {
    connectionId: inbound.connectionId,
    tenantId: inbound.tenantId,
    agentId: inbound.agentId,
    channel: inbound.channel,
    externalId: inbound.externalId,
    identifierType: inbound.identifierType,
    encSender: encryptChannelCredential(inbound.sender),
    inboundMessageId: inbound.inboundMessageId,
    pacing,
    ...(inbound.prepared
      ? {
          inputKind: inbound.prepared.inputKind,
          encStored: encryptChannelCredential(inbound.prepared.storedContent),
          transcriptionUsage: inbound.prepared.transcriptionUsage,
        }
      : {}),
  };
  if (pacing.mergeBurst && !inbound.prepared) {
    // Each new message restarts the wait: only the newest job's token answers.
    const key = burstKey(inbound.connectionId, inbound.sender);
    const token = randomUUID();
    await burstStore()
      .multi()
      .rpush(`${key}:msgs`, encryptChannelCredential(inbound.text))
      .set(`${key}:token`, token, "EX", BURST_TTL_SECONDS)
      .expire(`${key}:msgs`, BURST_TTL_SECONDS)
      .exec();
    await ctx.queue.enqueue<ChannelReplyJob>(queueTarget(), { ...base, burstToken: token }, { delaySeconds });
    return;
  }
  await ctx.queue.enqueue<ChannelReplyJob>(queueTarget(), { ...base, encText: encryptChannelCredential(inbound.text) }, { delaySeconds });
}

/** One delayed reply coming due. */
export async function runChannelReplyJob(ctx: AppContext, job: ChannelReplyJob): Promise<void> {
  const sender = decryptChannelCredential(job.encSender);
  let text: string;
  if (job.burstToken) {
    const key = burstKey(job.connectionId, sender);
    const taken = (await burstStore().eval(TAKE_BURST_SCRIPT, 2, `${key}:msgs`, `${key}:token`, job.burstToken)) as string[] | null;
    // A newer message took over this burst; its own job answers everything.
    if (!taken?.length) return;
    text = taken.map((m) => decryptChannelCredential(m)).join("\n");
  } else {
    text = decryptChannelCredential(job.encText ?? "");
  }
  if (!text.trim()) return;

  const connection = await withPlatformContext(ctx.prisma, (tx) => tx.channelConnection.findUnique({ where: { id: job.connectionId } }));
  if (!connection || connection.status !== "CONNECTED" || !connection.encryptedCredential) return;
  const allowance = await checkUsageAllowance(ctx.prisma, connection.tenantId);
  if (allowance.overHardCap) return;
  const credential = decryptChannelCredential(connection.encryptedCredential);

  const run = () => answer(ctx, {
    connectionId: job.connectionId,
    tenantId: job.tenantId,
    agentId: job.agentId,
    channel: job.channel,
    externalId: job.externalId,
    identifierType: job.identifierType,
    sender,
    text,
    inboundMessageId: job.inboundMessageId,
    credential,
    pacing: job.pacing,
    prepared:
      job.inputKind && job.encStored
        ? { inputKind: job.inputKind, storedContent: decryptChannelCredential(job.encStored), transcriptionUsage: job.transcriptionUsage }
        : undefined,
  });
  if (!job.burstToken) {
    await run(); // a throw lets the queue retry this same job
    return;
  }
  try {
    await run();
  } catch (err) {
    // The burst has already left Redis, so a plain retry would find
    // nothing: hand the merged text to a fresh job that carries it.
    const { burstToken: _taken, ...rest } = job;
    await ctx.queue.enqueue<ChannelReplyJob>(queueTarget(), { ...rest, encText: encryptChannelCredential(text) }, { delaySeconds: 30 });
    console.error("[reply-pacing] merged reply failed, retrying in 30s", err);
  }
}

async function answer(ctx: AppContext, a: ChannelInbound & { credential: string; pacing: ReplyPacing | null }): Promise<void> {
  if (a.pacing?.typingIndicator) await markSeen(a).catch(() => undefined);
  // Telegram confirms with its buttons; a typed yes works on every channel.
  const confirmToolCallId =
    a.prepared?.inputKind !== "media" && isAffirmative(a.text) ? ((await pendingToolCallId(ctx, a).catch(() => null)) ?? undefined) : undefined;
  const result = await processCustomerMessage(ctx, {
    tenantId: a.tenantId,
    agentId: a.agentId,
    channel: a.channel,
    customerMessage: a.text,
    customerIdentifier: { type: a.identifierType, value: a.sender },
    confirmToolCallId,
    inputKind: a.prepared?.inputKind,
    storedContent: a.prepared?.storedContent,
    transcriptionUsage: a.prepared?.transcriptionUsage,
  });
  // A person is handling this chat — stay silent, no placeholder.
  if (result.humanTakeoverActive) return;
  const replyText = result.pendingConfirmation?.confirmationPrompt ?? result.reply;
  if (!replyText) return;
  if (a.pacing) {
    const ms = typingMs(a.pacing, replyText);
    if (ms > 0) {
      await showTyping(a).catch(() => undefined);
      await new Promise((r) => setTimeout(r, ms));
    }
  }
  // Best-effort: a blocked chat or expired token has nowhere useful to
  // surface here; the connection's own status shows it on the next action.
  await deliver(a, result).catch(() => undefined);
}

async function deliver(a: ChannelInbound & { credential: string }, result: AgentTurnResult): Promise<void> {
  if (a.channel === "TELEGRAM") {
    if (result.pendingConfirmation) {
      await telegramCall(a.credential, "sendMessage", {
        chat_id: a.sender,
        text: result.pendingConfirmation.confirmationPrompt,
        reply_markup: {
          inline_keyboard: [
            [
              { text: notice("confirmButton", result.replyLanguage), callback_data: `confirm:${result.pendingConfirmation.toolCallId}` },
              { text: notice("cancelButton", result.replyLanguage), callback_data: `cancel:${result.pendingConfirmation.toolCallId}` },
            ],
          ],
        },
      });
    } else if (result.reply) {
      await telegramCall(a.credential, "sendMessage", { chat_id: a.sender, text: result.reply });
    }
    return;
  }
  const text = result.pendingConfirmation
    ? `${result.pendingConfirmation.confirmationPrompt}\n\n${notice("confirmHint", result.replyLanguage)}`
    : result.reply;
  if (!text) return;
  if (a.channel === "WHATSAPP") {
    await graphApiSend(a.credential, `${a.externalId}/messages`, { messaging_product: "whatsapp", to: a.sender, type: "text", text: { body: text } });
  } else {
    await graphApiSend(a.credential, "me/messages", { recipient: { id: a.sender }, message: { text } });
  }
}

/** Read receipt where the channel has one we can send. */
async function markSeen(a: ChannelInbound & { credential: string }): Promise<void> {
  if (a.channel === "FACEBOOK_MESSENGER" || a.channel === "INSTAGRAM") {
    await graphApiSend(a.credential, "me/messages", { recipient: { id: a.sender }, sender_action: "mark_seen" });
  }
  // WhatsApp's read receipt is sent together with its typing indicator below.
}

async function showTyping(a: ChannelInbound & { credential: string }): Promise<void> {
  switch (a.channel) {
    case "TELEGRAM":
      await telegramCall(a.credential, "sendChatAction", { chat_id: a.sender, action: "typing" });
      return;
    case "WHATSAPP":
      if (!a.inboundMessageId) return;
      await graphApiSend(a.credential, `${a.externalId}/messages`, {
        messaging_product: "whatsapp",
        status: "read",
        message_id: a.inboundMessageId,
        typing_indicator: { type: "text" },
      });
      return;
    case "FACEBOOK_MESSENGER":
    case "INSTAGRAM":
      await graphApiSend(a.credential, "me/messages", { recipient: { id: a.sender }, sender_action: "typing_on" });
  }
}

/** Started once by server.ts — never by buildApp, so tests don't consume. */
export function startChannelReplyConsumer(ctx: AppContext, log: FastifyBaseLogger): void {
  void ctx.queue
    .consume<ChannelReplyJob>(queueTarget(), async (msg) => {
      await runChannelReplyJob(ctx, msg.body);
    })
    .catch((err) => log.error(err, "channel reply consumer stopped"));
}
