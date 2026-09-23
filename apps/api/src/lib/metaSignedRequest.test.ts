import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import { verifyMetaSignedRequest } from "./metaSignedRequest.js";

const SECRET = "test-app-secret";

function sign(payload: Record<string, unknown>, secret = SECRET): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${signature}.${encoded}`;
}

const validPayload = () => ({
  algorithm: "HMAC-SHA256",
  issued_at: Math.floor(Date.now() / 1000),
  user_id: "1234567890",
});

describe("verifyMetaSignedRequest", () => {
  it("returns the user id for a genuine request", () => {
    expect(verifyMetaSignedRequest(sign(validPayload()), SECRET)).toBe("1234567890");
  });

  it("rejects a request signed with someone else's secret", () => {
    expect(verifyMetaSignedRequest(sign(validPayload(), "attacker-secret"), SECRET)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const [signature] = sign(validPayload()).split(".");
    const forged = Buffer.from(JSON.stringify({ ...validPayload(), user_id: "999" })).toString("base64url");
    expect(verifyMetaSignedRequest(`${signature}.${forged}`, SECRET)).toBeNull();
  });

  it("rejects a replay of a day-old request", () => {
    const stale = { ...validPayload(), issued_at: Math.floor(Date.now() / 1000) - 90_000 };
    expect(verifyMetaSignedRequest(sign(stale), SECRET)).toBeNull();
  });

  it("rejects an unexpected signing algorithm", () => {
    expect(verifyMetaSignedRequest(sign({ ...validPayload(), algorithm: "NONE" }), SECRET)).toBeNull();
  });

  it("rejects malformed input rather than throwing", () => {
    for (const input of [undefined, null, 42, "", "no-dot", "a.b", `${"x".repeat(43)}.not-json`]) {
      expect(verifyMetaSignedRequest(input, SECRET)).toBeNull();
    }
  });

  it("rejects everything when the app secret is not configured", () => {
    expect(verifyMetaSignedRequest(sign(validPayload()), undefined)).toBeNull();
  });
});
