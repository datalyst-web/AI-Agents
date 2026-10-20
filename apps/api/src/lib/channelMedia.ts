import type { ModelRouter, ProviderName } from "@chat-agent/ai-provider";
import { GRAPH_API, telegramCall } from "./channelSend.js";

/**
 * Voice notes, photos and files arriving on messaging channels. Customers
 * who'd rather talk than type send voice notes; before this they got no
 * reply at all, because only text was handled.
 *
 * - A voice note is downloaded from the channel and transcribed through the
 *   model router (never a provider SDK directly — CLAUDE.md principle 2);
 *   the transcript is answered like any typed message, and staff see it as
 *   "🎤 Voice note: …".
 * - Anything the agent can't see (photo, video, file, sticker…) gets a
 *   polite reply in the conversation's language asking them to put it in
 *   words, instead of silence.
 *
 * Audio is held in memory only for the transcription call; nothing is stored.
 */

/** Telegram bots can't download files over 20 MB; a minute of voice note is ~100 KB. */
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export type MediaLabel = "photo" | "video" | "file" | "sticker" | "location" | "contact" | "voice note";

const STORED: Record<MediaLabel, string> = {
  photo: "📷 Photo",
  video: "🎬 Video",
  file: "📎 File",
  sticker: "Sticker",
  location: "📍 Location",
  contact: "👤 Contact card",
  "voice note": "🎤 Voice note (couldn't be made out)",
};

export type InboundAttachment =
  | { kind: "voice"; download: () => Promise<{ bytes: Uint8Array; mimeType: string }> }
  | { kind: "media"; label: MediaLabel };

export interface PreparedMessage {
  /** What the agent reads. */
  text: string;
  /** What staff see in the conversation. */
  storedContent: string;
  inputKind: "voice" | "media";
  transcriptionUsage?: { provider: ProviderName; modelId: string; inputTokens: number; outputTokens: number };
}

function mediaMessage(label: MediaLabel): PreparedMessage {
  const what =
    label === "voice note"
      ? "a voice note, but it couldn't be made out. Apologise briefly and ask them to send it again or type it"
      : `a ${label}, which you can't open here. Thank them and ask them to tell you in words what they need${label === "location" ? " (for example the area or address)" : ""}`;
  return {
    text: `[The customer sent ${what}. Reply in the language of the conversation.]`,
    storedContent: STORED[label],
    inputKind: "media",
  };
}

function filenameFor(mimeType: string): string {
  const t = mimeType.toLowerCase();
  if (t.includes("ogg") || t.includes("opus")) return "voice.ogg";
  if (t.includes("mpeg") || t.includes("mp3")) return "voice.mp3";
  if (t.includes("wav")) return "voice.wav";
  if (t.includes("webm")) return "voice.webm";
  return "voice.m4a"; // mp4/aac — Messenger and Instagram voice clips
}

/** Turns an attachment into a message the agent can answer. Never throws. */
export async function prepareAttachment(router: ModelRouter, attachment: InboundAttachment): Promise<PreparedMessage> {
  if (attachment.kind === "media") return mediaMessage(attachment.label);
  try {
    const { bytes, mimeType } = await attachment.download();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_AUDIO_BYTES) return mediaMessage("voice note");
    const result = await router.transcribe({ audio: bytes, mimeType, filename: filenameFor(mimeType) });
    if (!result.text.trim()) return mediaMessage("voice note");
    return {
      text: result.text,
      storedContent: `🎤 Voice note: ${result.text}`,
      inputKind: "voice",
      transcriptionUsage: { provider: result.provider, modelId: result.model, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
    };
  } catch {
    return mediaMessage("voice note");
  }
}

async function fetchBytes(url: string, headers: Record<string, string> = {}): Promise<{ bytes: Uint8Array; contentType: string }> {
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`media download failed: ${resp.status}`);
  const length = Number(resp.headers.get("content-length") ?? 0);
  if (length > MAX_AUDIO_BYTES) throw new Error("media too large");
  return { bytes: new Uint8Array(await resp.arrayBuffer()), contentType: resp.headers.get("content-type") ?? "" };
}

/** WhatsApp Cloud API: media id → short-lived URL → bytes, both with the connection's token. */
export function whatsappVoice(accessToken: string, mediaId: string, mimeType?: string): InboundAttachment {
  return {
    kind: "voice",
    download: async () => {
      const metaResp = await fetch(`${GRAPH_API}/${encodeURIComponent(mediaId)}`, { headers: { authorization: `Bearer ${accessToken}` } });
      const meta = (await metaResp.json()) as { url?: string; mime_type?: string };
      if (!metaResp.ok || !meta.url) throw new Error("whatsapp media lookup failed");
      const { bytes } = await fetchBytes(meta.url, { authorization: `Bearer ${accessToken}` });
      return { bytes, mimeType: meta.mime_type ?? mimeType ?? "audio/ogg" };
    },
  };
}

/** Telegram: file id → file path → bytes. */
export function telegramVoice(botToken: string, fileId: string, mimeType?: string): InboundAttachment {
  return {
    kind: "voice",
    download: async () => {
      const file = (await telegramCall(botToken, "getFile", { file_id: fileId })) as { file_path?: string };
      if (!file.file_path) throw new Error("telegram file lookup failed");
      const { bytes } = await fetchBytes(`https://api.telegram.org/file/bot${botToken}/${file.file_path}`);
      return { bytes, mimeType: mimeType ?? "audio/ogg" };
    },
  };
}

/** Messenger / Instagram: the attachment carries a CDN URL directly. */
export function urlVoice(url: string): InboundAttachment {
  return {
    kind: "voice",
    download: async () => {
      const { bytes, contentType } = await fetchBytes(url);
      return { bytes, mimeType: contentType || "audio/mp4" };
    },
  };
}

/** Meta attachment types → what we tell the agent. */
export function metaAttachmentLabel(type: string | undefined): MediaLabel {
  switch (type) {
    case "image":
      return "photo";
    case "video":
      return "video";
    case "location":
      return "location";
    case "sticker":
      return "sticker";
    case "contacts":
      return "contact";
    default:
      return "file";
  }
}
