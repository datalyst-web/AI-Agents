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

export type PaynowCurrency = "USD" | "ZWG";
const PAYNOW_CURRENCIES: readonly PaynowCurrency[] = ["USD", "ZWG"];

/**
 * A Paynow integration has one fixed currency (chosen when it's created in
 * Paynow), and Paynow charges whatever amount we send in that currency — so
 * USD and ZiG are separate integrations with separate keys.
 */
function credentialsFor(currency: PaynowCurrency): { id: string; key: string } | undefined {
  const id = currency === "USD" ? env.PAYNOW_INTEGRATION_ID : env.PAYNOW_ZWG_INTEGRATION_ID;
  const key = currency === "USD" ? env.PAYNOW_INTEGRATION_KEY : env.PAYNOW_ZWG_INTEGRATION_KEY;
  return id && key ? { id, key } : undefined;
}

export function isPaynowConfigured(currency: PaynowCurrency): boolean {
  return credentialsFor(currency) !== undefined;
}

function getCredentials(currency: PaynowCurrency): { id: string; key: string } {
  const credentials = credentialsFor(currency);
  if (!credentials) throw new Error(`Paynow is not configured for ${currency}.`);
  return credentials;
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
  /** In `currency` — the integration's own currency. */
  amount: string;
  currency: PaynowCurrency;
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
  const { id, key } = getCredentials(params.currency);
  const fields: Record<string, string> = {
    resulturl: `${env.API_PUBLIC_BASE_URL}/v1/billing/paynow/webhook`,
    returnurl: `${env.DASHBOARD_BASE_URL}/billing?paynowReference=${encodeURIComponent(params.reference)}`,
    reference: params.reference,
    amount: params.amount,
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
  const { id, key } = getCredentials(params.currency);
  const fields: Record<string, string> = {
    resulturl: `${env.API_PUBLIC_BASE_URL}/v1/billing/paynow/webhook`,
    returnurl: `${env.DASHBOARD_BASE_URL}/billing?paynowReference=${encodeURIComponent(params.reference)}`,
    reference: params.reference,
    amount: params.amount,
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
  /** Which integration signed it — so a ZiG answer can never settle a USD payment. */
  currency: PaynowCurrency;
}

/**
 * Verifies and parses an inbound payload — either Paynow's result-URL
 * webhook POST body, or the response body from polling a pollUrl (same
 * shape). The hash check is the ONLY thing that makes this trustworthy;
 * never act on a `status` field from a payload that fails verification.
 */
export function verifyAndParseStatusUpdate(rawFormBody: string, currency?: PaynowCurrency): PaynowStatusUpdate | undefined {
  // Not configured is just another way this can't be trusted — an inbound
  // call arriving before PAYNOW_INTEGRATION_KEY is set (or after it's
  // unset) must fail closed the same as a bad hash, never throw a raw
  // 500 out of the webhook route.
  // The result URL is shared by both integrations, so an unlabelled call is
  // checked against each configured key; a poll knows its currency.
  const parsed = parseFormEncoded(rawFormBody);
  const verifiedAs = (currency ? [currency] : PAYNOW_CURRENCIES).find((c) => {
    const credentials = credentialsFor(c);
    return credentials !== undefined && verifyHash(parsed, credentials.key);
  });
  if (!verifiedAs) return undefined;
  if (!parsed.reference || !parsed.status) return undefined;
  return {
    reference: parsed.reference,
    paynowReference: parsed.paynowreference,
    amount: parsed.amount,
    status: parsed.status,
    pollUrl: parsed.pollurl,
    currency: verifiedAs,
  };
}

/** Polls a stored pollUrl directly — used as a reconciliation fallback if the result-URL webhook never arrives (e.g. it was unreachable at the time). */
export async function pollPaymentStatus(pollUrl: string, currency: PaynowCurrency): Promise<PaynowStatusUpdate | undefined> {
  const resp = await fetch(pollUrl, { method: "POST", signal: AbortSignal.timeout(10_000) });
  return verifyAndParseStatusUpdate(await resp.text(), currency);
}

export function isPaidStatus(status: string): boolean {
  return status.trim().toLowerCase() === "paid";
}
