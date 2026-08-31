import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

/**
 * Hand-rolled Paynow (paynow.co.zw — Zimbabwe's payment gateway) client,
 * matching the official SDK's wire protocol exactly (verified against its
 * published source): form-encoded requests/responses, SHA-512 request
 * signing. Built directly against the documented endpoints/fields rather
 * than depending on the `paynow` npm package, consistent with how every
 * other vendor integration in this codebase (HubSpot, Zendesk, Google
 * Calendar) is a plain fetch-based client, not an SDK dependency.
 */
const INITIATE_URL = "https://www.paynow.co.zw/interface/initiatetransaction";
const INITIATE_MOBILE_URL = "https://www.paynow.co.zw/interface/remotetransaction";

function getCredentials(): { id: string; key: string } {
  if (!env.PAYNOW_INTEGRATION_ID || !env.PAYNOW_INTEGRATION_KEY) {
    throw new Error("Paynow is not configured — PAYNOW_INTEGRATION_ID/PAYNOW_INTEGRATION_KEY must be set.");
  }
  return { id: env.PAYNOW_INTEGRATION_ID, key: env.PAYNOW_INTEGRATION_KEY };
}

/**
 * Paynow's exact algorithm: concatenate every field's value (insertion
 * order, excluding "hash" itself), append the integration key lowercased,
 * SHA-512, uppercase hex. Both signing an outbound request and verifying
 * an inbound one (result URL callback, poll response) use this same
 * function — Paynow signs its responses with the same key.
 */
function generateHash(fields: Record<string, string>, integrationKey: string): string {
  let concatenated = "";
  for (const key of Object.keys(fields)) {
    if (key === "hash") continue;
    concatenated += fields[key];
  }
  concatenated += integrationKey.toLowerCase();
  return createHash("sha512").update(concatenated, "utf8").digest("hex").toUpperCase();
}

function verifyHash(fields: Record<string, string>, integrationKey: string): boolean {
  const provided = fields.hash;
  if (!provided) return false;
  const expected = generateHash(fields, integrationKey);
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided.toUpperCase());
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

/** Paynow responds (and calls the result URL) as `application/x-www-form-urlencoded` text, never JSON. */
function parseFormEncoded(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(text)) {
    out[key.toLowerCase()] = value;
  }
  return out;
}

export interface InitiateWebPaymentParams {
  reference: string;
  amountUsd: string;
  description: string;
  authEmail: string;
}

export interface InitiateWebPaymentResult {
  ok: boolean;
  redirectUrl?: string;
  pollUrl?: string;
  error?: string;
}

/** Standard (card/hosted-page) checkout — customer is redirected to Paynow's own payment page. */
export async function initiateWebPayment(params: InitiateWebPaymentParams): Promise<InitiateWebPaymentResult> {
  const { id, key } = getCredentials();
  const fields: Record<string, string> = {
    resulturl: `${env.API_PUBLIC_BASE_URL}/v1/billing/paynow/webhook`,
    returnurl: `${env.DASHBOARD_BASE_URL}/billing?paynowReference=${encodeURIComponent(params.reference)}`,
    reference: params.reference,
    amount: params.amountUsd,
    id,
    additionalinfo: params.description,
    authemail: params.authEmail,
    status: "Message",
  };
  fields.hash = generateHash(fields, key);

  const resp = await fetch(INITIATE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  const parsed = parseFormEncoded(await resp.text());

  if (parsed.status?.toLowerCase() === "error") {
    return { ok: false, error: parsed.error ?? "Paynow rejected the request." };
  }
  if (!verifyHash(parsed, key)) {
    return { ok: false, error: "Paynow's response failed hash verification." };
  }
  return { ok: true, redirectUrl: parsed.browserurl, pollUrl: parsed.pollurl };
}

export interface InitiateMobilePaymentParams extends InitiateWebPaymentParams {
  phone: string;
  method: "ecocash" | "onemoney";
}

export interface InitiateMobilePaymentResult {
  ok: boolean;
  instructions?: string;
  pollUrl?: string;
  error?: string;
}

/** Express/mobile checkout (EcoCash, OneMoney) — no redirect; the customer approves a prompt on their phone. */
export async function initiateMobilePayment(params: InitiateMobilePaymentParams): Promise<InitiateMobilePaymentResult> {
  const { id, key } = getCredentials();
  const fields: Record<string, string> = {
    resulturl: `${env.API_PUBLIC_BASE_URL}/v1/billing/paynow/webhook`,
    returnurl: `${env.DASHBOARD_BASE_URL}/billing?paynowReference=${encodeURIComponent(params.reference)}`,
    reference: params.reference,
    amount: params.amountUsd,
    id,
    additionalinfo: params.description,
    authemail: params.authEmail,
    phone: params.phone,
    method: params.method,
    status: "Message",
  };
  fields.hash = generateHash(fields, key);

  const resp = await fetch(INITIATE_MOBILE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  const parsed = parseFormEncoded(await resp.text());

  if (parsed.status?.toLowerCase() === "error") {
    return { ok: false, error: parsed.error ?? "Paynow rejected the request." };
  }
  if (!verifyHash(parsed, key)) {
    return { ok: false, error: "Paynow's response failed hash verification." };
  }
  return { ok: true, instructions: parsed.instructions, pollUrl: parsed.pollurl };
}

export interface PaynowStatusUpdate {
  reference: string;
  paynowReference?: string;
  amount?: string;
  status: string;
  pollUrl?: string;
}

/**
 * Verifies and parses an inbound payload — either Paynow's result-URL
 * webhook POST body, or the response body from polling a pollUrl (same
 * shape). The hash check is the ONLY thing that makes this trustworthy;
 * never act on a `status` field from a payload that fails verification.
 */
export function verifyAndParseStatusUpdate(rawFormBody: string): PaynowStatusUpdate | undefined {
  const { key } = getCredentials();
  const parsed = parseFormEncoded(rawFormBody);
  if (!verifyHash(parsed, key)) return undefined;
  if (!parsed.reference || !parsed.status) return undefined;
  return {
    reference: parsed.reference,
    paynowReference: parsed.paynowreference,
    amount: parsed.amount,
    status: parsed.status,
    pollUrl: parsed.pollurl,
  };
}

/** Polls a stored pollUrl directly — used as a reconciliation fallback if the result-URL webhook never arrives (e.g. it was unreachable at the time). */
export async function pollPaymentStatus(pollUrl: string): Promise<PaynowStatusUpdate | undefined> {
  const resp = await fetch(pollUrl, { method: "POST" });
  return verifyAndParseStatusUpdate(await resp.text());
}

export function isPaidStatus(status: string): boolean {
  return status.trim().toLowerCase() === "paid";
}
