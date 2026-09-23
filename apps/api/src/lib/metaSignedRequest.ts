import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta's `signed_request`: "<base64url signature>.<base64url payload>",
 * signed with the app secret. Used by the data-deletion callback, which is
 * required before Meta will review an app that handles user data.
 *
 * Returns the Facebook/Instagram user id when the signature is genuine and
 * current, otherwise null — never throws, so a malformed request from the
 * open internet is just rejected.
 */
export function verifyMetaSignedRequest(signedRequest: unknown, appSecret: string | undefined): string | null {
  if (typeof signedRequest !== "string" || !appSecret) return null;
  const [encodedSignature, encodedPayload] = signedRequest.split(".");
  if (!encodedSignature || !encodedPayload) return null;

  const expected = createHmac("sha256", appSecret).update(encodedPayload).digest();
  const provided = Buffer.from(encodedSignature, "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  let payload: { algorithm?: string; user_id?: unknown; issued_at?: unknown };
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (payload.algorithm?.toUpperCase() !== "HMAC-SHA256") return null;
  // Meta sends issued_at in seconds; reject anything older than a day so a
  // captured request can't be replayed indefinitely.
  if (typeof payload.issued_at === "number" && Date.now() / 1000 - payload.issued_at > 86_400) return null;
  return typeof payload.user_id === "string" && payload.user_id.length > 0 ? payload.user_id : null;
}
