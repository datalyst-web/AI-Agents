import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { env } from "../env.js";

/**
 * Encrypts per-tenant channel credentials (Telegram bot tokens, WhatsApp
 * access tokens) at rest. Not routed through packages/secrets'
 * SecretsProvider — that's AWS Secrets Manager-shaped and priced per
 * secret, unsuitable for potentially thousands of small per-tenant
 * connection secrets. AES-256-GCM with a single platform-wide key instead,
 * the standard pattern for this class of per-tenant credential.
 */
function getKey(): Buffer {
  if (!env.CHANNEL_CREDENTIALS_ENCRYPTION_KEY) {
    throw new Error(
      "CHANNEL_CREDENTIALS_ENCRYPTION_KEY is not set — required before any channel can be connected. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  const key = Buffer.from(env.CHANNEL_CREDENTIALS_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new Error("CHANNEL_CREDENTIALS_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256).");
  }
  return key;
}

/** Format: base64(iv) . base64(authTag) . base64(ciphertext) — self-contained, no separate IV storage needed. */
export function encryptChannelCredential(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptChannelCredential(stored: string): string {
  const key = getKey();
  const [ivB64, authTagB64, ciphertextB64] = stored.split(".");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Malformed encrypted channel credential.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}
