import { decryptChannelCredential } from "./channelCrypto.js";

const TELEGRAM_API = "https://api.telegram.org";

export async function telegramCall(botToken: string, method: string, body?: Record<string, unknown>) {
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

export async function graphApiGet(accessToken: string, path: string, fields: string) {
  const resp = await fetch(`${GRAPH_API}/${path}?fields=${encodeURIComponent(fields)}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const data = (await resp.json()) as Record<string, unknown> & { error?: { message?: string } };
  if (!resp.ok || data.error) throw new Error(data.error?.message ?? `Meta Graph API rejected this credential.`);
  return data;
}

export async function graphApiSend(accessToken: string, path: string, body: Record<string, unknown>) {
  const resp = await fetch(`${GRAPH_API}/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await resp.json()) as Record<string, unknown> & { error?: { message?: string } };
  if (!resp.ok || data.error) throw new Error(data.error?.message ?? "Meta Graph API send failed.");
  return data;
}

/**
 * Delivers a staff-typed live-takeover reply back out through the
 * customer's original channel — used only for Telegram/WhatsApp/
 * Messenger/Instagram conversations (the Widget channel delivers via the
 * widget's own polling instead, see conversations.routes.ts). Both
 * `encryptedCredential` (the connection's bot token / access token) and
 * `encryptedHandle` (the customer's chat_id / phone / PSID — see
 * CustomerIdentity.encryptedExternalHandle) are decrypted here, used for
 * exactly one outbound call, and never returned or logged.
 */
export async function sendOutboundChannelMessage(params: {
  channel: "TELEGRAM" | "WHATSAPP" | "FACEBOOK_MESSENGER" | "INSTAGRAM";
  externalId: string | null;
  encryptedCredential: string;
  encryptedHandle: string;
  message: string;
}): Promise<void> {
  const credential = decryptChannelCredential(params.encryptedCredential);
  const handle = decryptChannelCredential(params.encryptedHandle);
  switch (params.channel) {
    case "TELEGRAM":
      await telegramCall(credential, "sendMessage", { chat_id: handle, text: params.message });
      return;
    case "WHATSAPP":
      await graphApiSend(credential, `${params.externalId}/messages`, {
        messaging_product: "whatsapp",
        to: handle,
        type: "text",
        text: { body: params.message },
      });
      return;
    case "FACEBOOK_MESSENGER":
    case "INSTAGRAM":
      await graphApiSend(credential, "me/messages", { recipient: { id: handle }, message: { text: params.message } });
      return;
  }
}
