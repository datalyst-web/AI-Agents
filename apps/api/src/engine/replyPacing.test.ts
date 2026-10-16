import { describe, it, expect } from "vitest";
import { ReplyPacingSchema } from "@chat-agent/shared-types";

process.env.DATABASE_URL ??= "postgresql://unit:test@localhost:5432/none";
process.env.JWT_SECRET ??= "unit-test-jwt-secret-not-real-0123456789";
const { computeDelayMs, isUrgent, pacingFor, typingMs } = await import("./replyPacing.js");

const personality = (replyPacing?: unknown) => ({
  tone: "friendly",
  name: "Ava",
  greeting: "Hi",
  systemInstructions: "x",
  ...(replyPacing ? { replyPacing } : {}),
});

describe("reply pacing", () => {
  it("answers instantly unless a delay is set for that channel", () => {
    expect(pacingFor(personality(), "WHATSAPP")).toBeNull();
    expect(pacingFor(personality({ mode: "instant" }), "WHATSAPP")).toBeNull();
    expect(pacingFor(personality({ mode: "fixed", delaySeconds: 60, channels: ["TELEGRAM"] }), "WHATSAPP")).toBeNull();
    expect(pacingFor(personality({ mode: "fixed", delaySeconds: 60 }), "WHATSAPP")).toMatchObject({ mode: "fixed", delaySeconds: 60, mergeBurst: true });
    // A malformed stored config never breaks replies — it just answers instantly.
    expect(pacingFor({ nonsense: true }, "WHATSAPP")).toBeNull();
  });

  it("waits exactly the fixed delay, e.g. one minute", () => {
    const p = ReplyPacingSchema.parse({ mode: "fixed", delaySeconds: 60 });
    expect(computeDelayMs(p, "hi")).toBe(60_000);
    expect(computeDelayMs(p, "a much longer message ".repeat(20))).toBe(60_000);
  });

  it("paces human-like: longer messages take longer, always within the bounds", () => {
    const p = ReplyPacingSchema.parse({ mode: "humanlike", minSeconds: 3, maxSeconds: 40 });
    const mid = () => 0.5;
    const short = computeDelayMs(p, "Hi", mid);
    const long = computeDelayMs(p, "x".repeat(400), mid);
    expect(long).toBeGreaterThan(short);
    for (const r of [0, 0.5, 0.999]) {
      for (const text of ["", "hello", "x".repeat(5000)]) {
        const ms = computeDelayMs(p, text, () => r);
        expect(ms).toBeGreaterThanOrEqual(3000);
        expect(ms).toBeLessThanOrEqual(40_000);
      }
    }
  });

  it("shows typing for a natural time before the reply", () => {
    const human = ReplyPacingSchema.parse({ mode: "humanlike" });
    expect(typingMs(human, "Sure!")).toBe(1500);
    expect(typingMs(human, "x".repeat(2000))).toBe(8000);
    expect(typingMs(ReplyPacingSchema.parse({ mode: "fixed" }), "anything")).toBe(2000);
    expect(typingMs(ReplyPacingSchema.parse({ mode: "fixed", typingIndicator: false }), "anything")).toBe(0);
  });

  it("recognises urgent messages", () => {
    expect(isUrgent("This is urgent, my tooth is bleeding")).toBe(true);
    expect(isUrgent("EMERGENCY")).toBe(true);
    expect(isUrgent("please reply asap")).toBe(true);
    expect(isUrgent("Help!!!")).toBe(true);
    expect(isUrgent("What time do you open?")).toBe(false);
  });

  it("refuses delays beyond what the queue can hold", () => {
    expect(ReplyPacingSchema.safeParse({ mode: "fixed", delaySeconds: 901 }).success).toBe(false);
    expect(ReplyPacingSchema.safeParse({ mode: "fixed", channels: [] }).success).toBe(false);
  });
});
