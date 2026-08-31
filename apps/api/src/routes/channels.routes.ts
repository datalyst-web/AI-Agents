import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { withTenant, withPlatformContext } from "@chat-agent/db";
import type { AppContext } from "../lib/context.js";
import { requireTenantMatch, requirePermission } from "../lib/rbac.js";
import { verifyActiveImpersonation } from "../lib/impersonation.js";
import { writeAuditLog } from "../lib/audit.js";
import { encryptChannelCredential, decryptChannelCredential } from "../lib/channelCrypto.js";
import { processCustomerMessage } from "../engine/agentLoop.js";
import { env } from "../env.js";

const ConnectTelegramSchema = z.object({ botToken: z.string().min(20) });

const TELEGRAM_API = "https://api.telegram.org";

async function telegramCall(botToken: string, method: string, body?: Record<string, unknown>) {
  const resp = await fetch(`${TELEGRAM_API}/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await resp.json()) as { ok: boolean; result?: unknown; description?: string };
  if (!data.ok) throw new Error(data.description ?? `Telegram API call to ${method} failed.`);
  return data.result;
}

// WhatsApp/Messenger/Instagram all run through one Meta App and one Graph
// API surface (see META_APP_SECRET's comment in packages/config) — a single
// pinned API version keeps every call in this file consistent.
const GRAPH_API = "https://graph.facebook.com/v19.0";

async function graphApiGet(accessToken: string, path: string, fields: string) {
  const resp = await fetch(`${GRAPH_API}/${path}?fields=${encodeURIComponent(fields)}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const data = (await resp.json()) as Record<string, unknown> & { error?: { message?: string } };
  if (!resp.ok || data.error) throw new Error(data.error?.message ?? `Meta Graph API rejected this credential.`);
  return data;
}

async function graphApiSend(accessToken: string, path: string, body: Record<string, unknown>) {
  const resp = await fetch(`${GRAPH_API}/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await resp.json()) as Record<string, unknown> & { error?: { message?: string } };
  if (!resp.ok || data.error) throw new Error(data.error?.message ?? "Meta Graph API send failed.");
  return data;
}

const ConnectMetaChannelSchema = z.object({
  // WhatsApp: the Cloud API phone_number_id. Messenger: the Page id.
  // Instagram: the IG Business Account id. These are what Meta's webhook
  // payload identifies the recipient by, so this is also what gets stored
  // as ChannelConnection.externalId for shared-webhook routing.
  externalId: z.string().min(1),
  accessToken: z.string().min(10),
});

type MetaChannel = "WHATSAPP" | "FACEBOOK_MESSENGER" | "INSTAGRAM";

const META_CHANNEL_VALIDATION: Record<MetaChannel, { path: (id: string) => string; fields: string; labelField: string }> = {
  WHATSAPP: { path: (id) => id, fields: "verified_name,display_phone_number", labelField: "display_phone_number" },
  FACEBOOK_MESSENGER: { path: (id) => id, fields: "name", labelField: "name" },
  INSTAGRAM: { path: (id) => id, fields: "username", labelField: "username" },
};

/**
 * Deployment channels beyond the website widget/standalone URL (CLAUDE.md
 * Deployment Surfaces). Deliberately client-actioned, never staff — see
 * shared-types/rbac.ts channel:connect. Telegram is fully wired end to
 * end; WhatsApp is schema/UI-ready but has no live webhook handler yet —
 * it needs a real Meta Business/WhatsApp Cloud API account behind it
 * first (see the dashboard card's own explanation), and shipping an
 * untested webhook path would be worse than not having one.
 */
export async function registerChannelRoutes(app: FastifyInstance, ctx: AppContext) {
  const scoped = [app.authenticate, requireTenantMatch(), verifyActiveImpersonation(ctx.prisma)];

  app.get(
    "/v1/tenants/:tenantId/agents/:agentId/channels",
    { preHandler: [...scoped, requirePermission("agent:read")] },
    async (request) => {
      const { agentId } = request.params as { agentId: string };
      const connections = await withTenant(ctx.prisma, request.tenantCtx!, (tx) =>
        tx.channelConnection.findMany({ where: { tenantId: request.tenantCtx!.tenantId, agentId } }),
      );
      // encryptedCredential/webhookSecret never leave the server.
      return connections.map(({ encryptedCredential, webhookSecret, ...rest }) => rest);
    },
  );

  app.post(
    "/v1/tenants/:tenantId/agents/:agentId/channels/telegram/connect",
    { preHandler: [...scoped, requirePermission("channel:connect")] },
    async (request, reply) => {
      const { agentId } = request.params as { agentId: string };
      const { botToken } = ConnectTelegramSchema.parse(request.body);

      let botUsername: string;
      try {
        const me = (await telegramCall(botToken, "getMe")) as { username?: string };
        if (!me.username) throw new Error("Telegram didn't return a bot username.");
        botUsername = me.username;
      } catch (err) {
        reply.code(400).send({
          error: "invalid_bot_token",
          message: err instanceof Error ? err.message : "Could not verify this bot token with Telegram.",
        });
        return;
      }

      const connectionId = randomUUID();
      const webhookSecret = randomBytes(24).toString("hex");
      const webhookUrl = `${env.API_PUBLIC_BASE_URL}/v1/channels/telegram/webhook/${connectionId}`;

      try {
        await telegramCall(botToken, "setWebhook", {
          url: webhookUrl,
          secret_token: webhookSecret,
          allowed_updates: ["message", "callback_query"],
        });
      } catch (err) {
        reply.code(502).send({
          error: "webhook_registration_failed",
          message: err instanceof Error ? err.message : "Telegram rejected the webhook registration.",
        });
        return;
      }

      const connection = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const created = await tx.channelConnection.upsert({
          where: { tenantId_agentId_channel: { tenantId: request.tenantCtx!.tenantId, agentId, channel: "TELEGRAM" } },
          create: {
            id: connectionId,
            tenantId: request.tenantCtx!.tenantId,
            agentId,
            channel: "TELEGRAM",
            status: "CONNECTED",
            externalLabel: `@${botUsername}`,
            encryptedCredential: encryptChannelCredential(botToken),
            webhookSecret,
            connectedAt: new Date(),
          },
          // Reconnecting with a new token reuses the same row (and the
          // now-orphaned old webhook URL keyed to the old id is simply
          // never called again — Telegram only calls the URL we just set).
          update: {
            status: "CONNECTED",
            externalLabel: `@${botUsername}`,
            encryptedCredential: encryptChannelCredential(botToken),
            webhookSecret,
            connectedAt: new Date(),
            errorMessage: null,
          },
        });
        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId: request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub,
          agentId,
          action: "channel_connected",
          metadata: { channel: "TELEGRAM", label: `@${botUsername}` },
        });
        return created;
      });

      const { encryptedCredential, webhookSecret: _secret, ...safe } = connection;
      reply.send(safe);
    },
  );

  const metaChannelSlugs: Record<string, MetaChannel> = {
    whatsapp: "WHATSAPP",
    messenger: "FACEBOOK_MESSENGER",
    instagram: "INSTAGRAM",
  };

  for (const [slug, channelEnum] of Object.entries(metaChannelSlugs)) {
    app.post(
      `/v1/tenants/:tenantId/agents/:agentId/channels/${slug}/connect`,
      { preHandler: [...scoped, requirePermission("channel:connect")] },
      async (request, reply) => {
        const { agentId } = request.params as { agentId: string };
        const { externalId, accessToken } = ConnectMetaChannelSchema.parse(request.body);
        const validation = META_CHANNEL_VALIDATION[channelEnum];

        let label: string;
        try {
          const data = await graphApiGet(accessToken, validation.path(externalId), validation.fields);
          const labelValue = data[validation.labelField];
          label = typeof labelValue === "string" ? labelValue : externalId;
        } catch (err) {
          reply.code(400).send({
            error: "invalid_meta_credential",
            message:
              err instanceof Error
                ? err.message
                : `Meta rejected this ${channelEnum === "WHATSAPP" ? "phone number id" : "id"}/access token pair.`,
          });
          return;
        }

        // externalId must be globally unique per channel (it's how the one
        // shared Meta webhook routes an inbound event back to a tenant) —
        // a duplicate here means this Page/number/IG account is already
        // connected to a different tenant or agent.
        const conflict = await withPlatformContext(ctx.prisma, (tx) =>
          tx.channelConnection.findFirst({
            where: { channel: channelEnum, externalId, NOT: { tenantId: request.tenantCtx!.tenantId, agentId } },
          }),
        );
        if (conflict) {
          reply.code(409).send({
            error: "already_connected_elsewhere",
            message: "This account is already connected to a different agent.",
          });
          return;
        }

        const connection = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
          const created = await tx.channelConnection.upsert({
            where: { tenantId_agentId_channel: { tenantId: request.tenantCtx!.tenantId, agentId, channel: channelEnum } },
            create: {
              tenantId: request.tenantCtx!.tenantId,
              agentId,
              channel: channelEnum,
              status: "CONNECTED",
              externalId,
              externalLabel: label,
              encryptedCredential: encryptChannelCredential(accessToken),
              connectedAt: new Date(),
            },
            update: {
              status: "CONNECTED",
              externalId,
              externalLabel: label,
              encryptedCredential: encryptChannelCredential(accessToken),
              connectedAt: new Date(),
              errorMessage: null,
            },
          });
          await writeAuditLog(tx, request.tenantCtx!, {
            actorUserId: request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub,
            agentId,
            action: "channel_connected",
            metadata: { channel: channelEnum, label },
          });
          return created;
        });

        const { encryptedCredential, webhookSecret: _secret, ...safe } = connection;
        reply.send(safe);
      },
    );
  }

  app.post(
    "/v1/tenants/:tenantId/agents/:agentId/channels/:channel/disconnect",
    { preHandler: [...scoped, requirePermission("channel:connect")] },
    async (request, reply) => {
      const { agentId, channel } = request.params as { agentId: string; channel: string };
      const channelUpper = channel.toUpperCase();
      const validChannels = ["TELEGRAM", "WHATSAPP", "FACEBOOK_MESSENGER", "INSTAGRAM"];
      if (!validChannels.includes(channelUpper)) {
        reply.code(400).send({ error: "unknown_channel" });
        return;
      }

      const existing = await withTenant(ctx.prisma, request.tenantCtx!, (tx) =>
        tx.channelConnection.findUnique({
          where: {
            tenantId_agentId_channel: {
              tenantId: request.tenantCtx!.tenantId,
              agentId,
              channel: channelUpper as "TELEGRAM" | "WHATSAPP" | "FACEBOOK_MESSENGER" | "INSTAGRAM",
            },
          },
        }),
      );
      if (!existing) {
        reply.code(404).send({ error: "not_connected" });
        return;
      }

      if (channelUpper === "TELEGRAM" && existing.encryptedCredential) {
        // Best-effort — a client's own bot may have already had its token
        // revoked/rotated on their end, which is fine, disconnect proceeds
        // regardless.
        await telegramCall(decryptChannelCredential(existing.encryptedCredential), "deleteWebhook").catch(() => undefined);
      }

      await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        await tx.channelConnection.update({
          where: { id: existing.id },
          data: { status: "DISCONNECTED", encryptedCredential: null, webhookSecret: null, externalId: null },
        });
        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId: request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub,
          agentId,
          action: "channel_disconnected",
          metadata: { channel: channelUpper },
        });
      });
      reply.send({ disconnected: true });
    },
  );

  /**
   * Public — Telegram calls this directly, no dashboard session involved.
   * Authenticity comes entirely from the per-connection secret_token
   * (CLAUDE.md-style defense: without this, connection ids are UUIDs but
   * still guessable-at-scale, and a forged "customer" message could
   * trigger real tool calls / AI spend).
   */
  app.post("/v1/channels/telegram/webhook/:connectionId", async (request, reply) => {
    const { connectionId } = request.params as { connectionId: string };
    const secretHeader = request.headers["x-telegram-bot-api-secret-token"];

    const connection = await withPlatformContext(ctx.prisma, (tx) =>
      tx.channelConnection.findUnique({ where: { id: connectionId } }),
    );
    if (!connection || connection.status !== "CONNECTED" || !connection.webhookSecret || !connection.encryptedCredential) {
      // 200, not 404/403 — Telegram retries aggressively on non-2xx, and a
      // disconnected/unknown connection is a permanent, not transient,
      // condition. No point telling a prober anything either way.
      reply.code(200).send({ ok: true });
      return;
    }
    if (secretHeader !== connection.webhookSecret) {
      reply.code(200).send({ ok: true });
      return;
    }

    const botToken = decryptChannelCredential(connection.encryptedCredential);
    const update = request.body as {
      message?: { chat: { id: number }; text?: string };
      callback_query?: { id: string; message?: { chat: { id: number } }; data?: string };
    };

    try {
      if (update.callback_query) {
        const chatId = update.callback_query.message?.chat.id;
        const data = update.callback_query.data ?? "";
        await telegramCall(botToken, "answerCallbackQuery", { callback_query_id: update.callback_query.id });
        if (!chatId) {
          reply.send({ ok: true });
          return;
        }
        const [action, toolCallId] = data.split(":");
        const result = await processCustomerMessage(ctx, {
          tenantId: connection.tenantId,
          agentId: connection.agentId,
          channel: "TELEGRAM",
          customerMessage: action === "confirm" ? "(confirmed the pending action)" : "(cancelled the pending action)",
          customerIdentifier: { type: "telegram_chat_id", value: String(chatId) },
          confirmToolCallId: action === "confirm" ? toolCallId : undefined,
        });
        if (result.reply) await telegramCall(botToken, "sendMessage", { chat_id: chatId, text: result.reply });
        reply.send({ ok: true });
        return;
      }

      const chatId = update.message?.chat.id;
      const text = update.message?.text;
      if (!chatId || !text) {
        reply.send({ ok: true });
        return;
      }

      const result = await processCustomerMessage(ctx, {
        tenantId: connection.tenantId,
        agentId: connection.agentId,
        channel: "TELEGRAM",
        customerMessage: text,
        customerIdentifier: { type: "telegram_chat_id", value: String(chatId) },
      });

      if (result.pendingConfirmation) {
        await telegramCall(botToken, "sendMessage", {
          chat_id: chatId,
          text: result.pendingConfirmation.confirmationPrompt,
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Confirm", callback_data: `confirm:${result.pendingConfirmation.toolCallId}` },
                { text: "❌ Cancel", callback_data: `cancel:${result.pendingConfirmation.toolCallId}` },
              ],
            ],
          },
        });
      } else if (result.reply) {
        await telegramCall(botToken, "sendMessage", { chat_id: chatId, text: result.reply });
      }
      reply.send({ ok: true });
    } catch (err) {
      request.log.error(err, "telegram webhook processing failed");
      // Still 200 — a 5xx here makes Telegram retry the same update
      // indefinitely, which would just repeat whatever failed.
      reply.code(200).send({ ok: true });
    }
  });

  /**
   * WhatsApp/Messenger/Instagram share ONE Meta App, so they share ONE
   * webhook URL — an inbound event only carries a Page/phone-number/IG
   * id, which is looked up against ChannelConnection.externalId to find
   * the tenant it belongs to (see the schema comment). Registered in its
   * own encapsulated sub-plugin so the raw-body content-type parser below
   * only shadows Fastify's default JSON parser for these two routes, not
   * every other route in the app (see @fastify/multipart's own scoped
   * parser above for the same pattern).
   */
  await app.register(async (metaScope) => {
    metaScope.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => {
      const buf = body as Buffer;
      (_req as unknown as { rawBody: Buffer }).rawBody = buf;
      try {
        done(null, buf.length ? JSON.parse(buf.toString("utf8")) : {});
      } catch (err) {
        done(err as Error, undefined);
      }
    });

    metaScope.get("/v1/channels/meta/webhook", async (request, reply) => {
      const query = request.query as Record<string, string>;
      if (
        env.META_WEBHOOK_VERIFY_TOKEN &&
        query["hub.mode"] === "subscribe" &&
        query["hub.verify_token"] === env.META_WEBHOOK_VERIFY_TOKEN
      ) {
        reply.code(200).header("content-type", "text/plain").send(query["hub.challenge"] ?? "");
        return;
      }
      reply.code(403).send();
    });

    metaScope.post("/v1/channels/meta/webhook", async (request, reply) => {
      // Always 200 once the payload shape is even plausibly Meta's — Meta
      // disables a webhook after too many non-2xx responses, and a bad
      // signature/unknown routing target is a permanent, not transient,
      // condition for that specific event (same reasoning as the Telegram
      // webhook above).
      const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;
      const signatureHeader = request.headers["x-hub-signature-256"];
      if (!env.META_APP_SECRET || !rawBody || typeof signatureHeader !== "string") {
        reply.code(200).send();
        return;
      }
      const expected = "sha256=" + createHmac("sha256", env.META_APP_SECRET).update(rawBody).digest("hex");
      const expectedBuf = Buffer.from(expected);
      const providedBuf = Buffer.from(signatureHeader);
      const validSignature = expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
      if (!validSignature) {
        request.log.warn("meta webhook signature mismatch");
        reply.code(200).send();
        return;
      }

      const payload = request.body as {
        object?: string;
        entry?: Array<{
          id?: string;
          messaging?: Array<{
            sender?: { id?: string };
            message?: { text?: string; is_echo?: boolean };
            postback?: { title?: string };
          }>;
          changes?: Array<{
            field?: string;
            value?: {
              metadata?: { phone_number_id?: string };
              messages?: Array<{ from?: string; type?: string; text?: { body?: string } }>;
            };
          }>;
        }>;
      };

      try {
        for (const entry of payload.entry ?? []) {
          if (payload.object === "whatsapp_business_account") {
            for (const change of entry.changes ?? []) {
              const phoneNumberId = change.value?.metadata?.phone_number_id;
              if (!phoneNumberId) continue;
              for (const msg of change.value?.messages ?? []) {
                const from = msg.from;
                const body = msg.text?.body;
                if (!from || msg.type !== "text" || !body) continue;
                await handleMetaInboundMessage(ctx, {
                  channel: "WHATSAPP",
                  externalId: phoneNumberId,
                  senderId: from,
                  text: body,
                  identifierType: "whatsapp_phone_number",
                  sendReply: (accessToken, reply_) =>
                    graphApiSend(accessToken, `${phoneNumberId}/messages`, {
                      messaging_product: "whatsapp",
                      to: from,
                      type: "text",
                      text: { body: reply_ },
                    }),
                });
              }
            }
          } else if (payload.object === "page" || payload.object === "instagram") {
            const pageOrIgId = entry.id;
            if (!pageOrIgId) continue;
            for (const messagingEvent of entry.messaging ?? []) {
              const senderId = messagingEvent.sender?.id;
              const text = messagingEvent.message?.text;
              // is_echo: a message the connected Page/IG account itself
              // sent (including our own replies below) — skip, or we'd
              // process our own outbound messages as new customer input.
              if (!senderId || !text || messagingEvent.message?.is_echo) continue;
              await handleMetaInboundMessage(ctx, {
                channel: payload.object === "page" ? "FACEBOOK_MESSENGER" : "INSTAGRAM",
                externalId: pageOrIgId,
                senderId,
                text,
                identifierType: payload.object === "page" ? "facebook_psid" : "instagram_igsid",
                sendReply: (accessToken, reply_) =>
                  graphApiSend(accessToken, "me/messages", {
                    recipient: { id: senderId },
                    message: { text: reply_ },
                  }),
              });
            }
          }
        }
      } catch (err) {
        request.log.error(err, "meta webhook processing failed");
      }

      reply.code(200).send();
    });
  });
}

async function handleMetaInboundMessage(
  ctx: AppContext,
  params: {
    channel: MetaChannel;
    externalId: string;
    senderId: string;
    text: string;
    identifierType: "whatsapp_phone_number" | "facebook_psid" | "instagram_igsid";
    sendReply: (accessToken: string, reply: string) => Promise<unknown>;
  },
) {
  const connection = await withPlatformContext(ctx.prisma, (tx) =>
    tx.channelConnection.findFirst({
      where: { channel: params.channel, externalId: params.externalId, status: "CONNECTED" },
    }),
  );
  if (!connection || !connection.encryptedCredential) return;

  const accessToken = decryptChannelCredential(connection.encryptedCredential);
  const result = await processCustomerMessage(ctx, {
    tenantId: connection.tenantId,
    agentId: connection.agentId,
    channel: params.channel,
    customerMessage: params.text,
    customerIdentifier: { type: params.identifierType, value: params.senderId },
  });

  const replyText = result.pendingConfirmation
    ? `${result.pendingConfirmation.confirmationPrompt}\n\nReply YES to confirm or NO to cancel.`
    : result.reply;
  // Best-effort — a send failure here (e.g. the customer blocked the Page,
  // or the token expired) has nowhere useful to surface synchronously;
  // the connection's health is visible via its own status/errorMessage
  // fields on the next explicit action, same as the Telegram path above.
  if (replyText) await params.sendReply(accessToken, replyText).catch(() => undefined);
}
