import { describe, it, expect, beforeAll, vi } from "vitest";
import { createHash } from "node:crypto";

// paynow.ts imports env.js at module scope — same timing gotcha as
// agentLoop.ts's tests: a static top-level import would run env
// validation before this file gets a chance to set PAYNOW_INTEGRATION_ID/
// KEY, so import dynamically after setting them in beforeAll.
let verifyAndParseStatusUpdate: typeof import("./paynow.js").verifyAndParseStatusUpdate;
let isPaidStatus: typeof import("./paynow.js").isPaidStatus;

const INTEGRATION_KEY = "test-integration-key-not-real";

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder";
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-not-real-0123456789";
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.PAYNOW_INTEGRATION_ID = "12345";
  process.env.PAYNOW_INTEGRATION_KEY = INTEGRATION_KEY;
  ({ verifyAndParseStatusUpdate, isPaidStatus } = await import("./paynow.js"));
});

/**
 * Independently reimplements Paynow's documented hash algorithm (verified
 * against the official SDK's published source, not guessed) — deliberately
 * NOT importing paynow.ts's own generateHash (unexported anyway): a test
 * that just asks the implementation to agree with itself would pass even
 * if both sides shared the same bug.
 */
function referenceHash(fields: Record<string, string>, integrationKey: string): string {
  let concatenated = "";
  for (const key of Object.keys(fields)) {
    if (key === "hash") continue;
    concatenated += fields[key];
  }
  concatenated += integrationKey.toLowerCase();
  return createHash("sha512").update(concatenated, "utf8").digest("hex").toUpperCase();
}

function buildSignedFormBody(fields: Record<string, string>, integrationKey = INTEGRATION_KEY): string {
  const withHash = { ...fields, hash: referenceHash(fields, integrationKey) };
  return new URLSearchParams(withHash).toString();
}

describe("verifyAndParseStatusUpdate — Paynow result-URL webhook trust boundary", () => {
  const validFields = {
    reference: "sub-bellmaz-abc123",
    amount: "49.00",
    paynowreference: "PN-998877",
    pollurl: "https://www.paynow.co.zw/interface/pollurl?guid=xyz",
    status: "Paid",
  };

  it("accepts a correctly-signed payload and returns the parsed fields", () => {
    const body = buildSignedFormBody(validFields);
    const result = verifyAndParseStatusUpdate(body);

    expect(result).toBeDefined();
    expect(result?.reference).toBe("sub-bellmaz-abc123");
    expect(result?.paynowReference).toBe("PN-998877");
    expect(result?.status).toBe("Paid");
    expect(result?.pollUrl).toBe(validFields.pollurl);
  });

  it("rejects a payload whose hash doesn't match its fields", () => {
    const body = buildSignedFormBody(validFields);
    // Tamper with the amount after signing — the classic attack this hash
    // check exists to prevent (e.g. downgrading a charge or forging a
    // "Paid" status Paynow never actually sent).
    const tampered = body.replace("amount=49.00", "amount=0.01");

    expect(verifyAndParseStatusUpdate(tampered)).toBeUndefined();
  });

  it("rejects a payload signed with the wrong integration key", () => {
    const body = buildSignedFormBody(validFields, "a-different-key-entirely");
    expect(verifyAndParseStatusUpdate(body)).toBeUndefined();
  });

  it("rejects a payload with no hash field at all", () => {
    const body = new URLSearchParams(validFields).toString();
    expect(verifyAndParseStatusUpdate(body)).toBeUndefined();
  });

  it("rejects a well-signed payload that's missing a required field (reference)", () => {
    const { reference: _omit, ...rest } = validFields;
    const body = buildSignedFormBody(rest);
    expect(verifyAndParseStatusUpdate(body)).toBeUndefined();
  });
});

describe("verifyAndParseStatusUpdate — fails closed when Paynow isn't configured", () => {
  it("returns undefined (never throws) for a webhook call arriving before PAYNOW_INTEGRATION_KEY is set", async () => {
    // Regression test: found live — a webhook call arriving while
    // unconfigured used to throw out of getCredentials() uncaught,
    // surfacing as a raw 500 out of the public webhook route instead of
    // the documented "always fail closed, never crash" behavior.
    const previousId = process.env.PAYNOW_INTEGRATION_ID;
    const previousKey = process.env.PAYNOW_INTEGRATION_KEY;
    delete process.env.PAYNOW_INTEGRATION_ID;
    delete process.env.PAYNOW_INTEGRATION_KEY;
    vi.resetModules();

    try {
      const fresh = await import("./paynow.js");
      const body = buildSignedFormBody({ reference: "sub-x", status: "Paid" });
      expect(() => fresh.verifyAndParseStatusUpdate(body)).not.toThrow();
      expect(fresh.verifyAndParseStatusUpdate(body)).toBeUndefined();
    } finally {
      if (previousId !== undefined) process.env.PAYNOW_INTEGRATION_ID = previousId;
      if (previousKey !== undefined) process.env.PAYNOW_INTEGRATION_KEY = previousKey;
      vi.resetModules();
    }
  });
});

describe("isPaidStatus", () => {
  it("matches Paynow's 'Paid' status case-insensitively", () => {
    expect(isPaidStatus("Paid")).toBe(true);
    expect(isPaidStatus("PAID")).toBe(true);
    expect(isPaidStatus("paid")).toBe(true);
  });

  it("does not match any other status", () => {
    expect(isPaidStatus("Created")).toBe(false);
    expect(isPaidStatus("Cancelled")).toBe(false);
    expect(isPaidStatus("Awaiting Delivery")).toBe(false);
    expect(isPaidStatus("")).toBe(false);
  });
});
