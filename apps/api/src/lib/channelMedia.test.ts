import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";

process.env.DATABASE_URL ??= "postgresql://unit:test@localhost:5432/none";
process.env.JWT_SECRET ??= "unit-test-jwt-secret-not-real-0123456789";
const { prepareAttachment, metaAttachmentLabel } = await import("./channelMedia.js");
const { notice } = await import("../engine/language.js");
const { registerClientErrorRoutes } = await import("../routes/clientErrors.routes.js");

const router = (text: string | Error) =>
  ({
    transcribe: vi.fn(async () => {
      if (text instanceof Error) throw text;
      return { text, provider: "openai" as const, model: "gpt-4o-mini-transcribe", usage: { inputTokens: 120, outputTokens: 9 } };
    }),
  }) as never;
const voice = (bytes = new Uint8Array([1, 2, 3]), mimeType = "audio/ogg; codecs=opus") => ({ kind: "voice" as const, download: async () => ({ bytes, mimeType }) });

describe("voice notes and attachments on messaging channels", () => {
  it("answers a voice note from its transcript, shows staff it was spoken, and bills the transcription", async () => {
    const r = router("Mhoroi, check-up inoita marii?");
    const prepared = await prepareAttachment(r, voice());
    expect(prepared).toEqual({
      text: "Mhoroi, check-up inoita marii?",
      storedContent: "🎤 Voice note: Mhoroi, check-up inoita marii?",
      inputKind: "voice",
      transcriptionUsage: { provider: "openai", modelId: "gpt-4o-mini-transcribe", inputTokens: 120, outputTokens: 9 },
    });
    // The filename's extension is what the speech-to-text API goes by.
    expect((r as unknown as { transcribe: ReturnType<typeof vi.fn> }).transcribe).toHaveBeenCalledWith(expect.objectContaining({ filename: "voice.ogg" }));
  });

  it("asks the customer to resend or type when a voice note can't be made out — never silence", async () => {
    for (const r of [router(""), router(new Error("provider down"))]) {
      const prepared = await prepareAttachment(r, voice());
      expect(prepared.inputKind).toBe("media");
      expect(prepared.storedContent).toBe("🎤 Voice note (couldn't be made out)");
      expect(prepared.text).toMatch(/ask them to send it again or type it/);
    }
    const failedDownload = await prepareAttachment(router("x"), { kind: "voice", download: async () => { throw new Error("404"); } });
    expect(failedDownload.inputKind).toBe("media");
    const empty = await prepareAttachment(router("x"), voice(new Uint8Array()));
    expect(empty.inputKind).toBe("media");
  });

  it("turns photos and files into a polite request to describe them", async () => {
    const photo = await prepareAttachment(router("x"), { kind: "media", label: "photo" });
    expect(photo.storedContent).toBe("📷 Photo");
    expect(photo.text).toMatch(/a photo, which you can't open here/);
    expect(photo.text).toMatch(/language of the conversation/);
    expect(metaAttachmentLabel("image")).toBe("photo");
    expect(metaAttachmentLabel("location")).toBe("location");
    expect(metaAttachmentLabel("fallback")).toBe("file");
  });
});

describe("fixed messages follow the conversation's language", () => {
  it("translates where we can vouch for it, else English", () => {
    expect(notice("takeover", null)).toMatch(/^A team member/);
    expect(notice("takeover", "Shona")).toMatch(/^Mumwe wechikwata chedu/);
    expect(notice("confirmButton", "Shona mixed with English")).toBe("✅ Hongu");
    expect(notice("cancelButton", "Ndebele (isiNdebele)")).toBe("❌ Hatshi");
    expect(notice("unavailable", "French")).toMatch(/momentanément indisponible/);
    expect(notice("confirmHint", "Portuguese")).toMatch(/SIM/);
    expect(notice("trouble", "Swahili")).toMatch(/^Samahani/);
    expect(notice("takeover", "Kalanga")).toMatch(/^A team member/);
  });
});

describe("dashboard crash reports", () => {
  it("accepts a well-formed report and rejects junk", async () => {
    const app = Fastify();
    await registerClientErrorRoutes(app);
    const ok = await app.inject({ method: "POST", url: "/v1/client-errors", payload: { message: "x is undefined", path: "/agents/1?token=secret", kind: "render" } });
    expect(ok.statusCode).toBe(204);
    expect((await app.inject({ method: "POST", url: "/v1/client-errors", payload: { message: "" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/client-errors", payload: { message: "a".repeat(501) } })).statusCode).toBe(400);
    await app.close();
  });
});
