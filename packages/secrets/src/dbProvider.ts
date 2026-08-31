import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { withPlatformContext, type PrismaClient } from "@chat-agent/db";
import type { SecretsProvider } from "./index.js";

function getKey(encryptionKeyBase64: string): Buffer {
  if (!encryptionKeyBase64) {
    throw new Error(
      "CHANNEL_CREDENTIALS_ENCRYPTION_KEY is not set — required before any tool/integration credential can be stored. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  const key = Buffer.from(encryptionKeyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("CHANNEL_CREDENTIALS_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256).");
  }
  return key;
}

/** Format: base64(iv) . base64(authTag) . base64(ciphertext) — self-contained, no separate IV storage needed. */
function encrypt(plaintext: string, encryptionKeyBase64: string): string {
  const key = getKey(encryptionKeyBase64);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(".");
}

function decrypt(stored: string, encryptionKeyBase64: string): string {
  const key = getKey(encryptionKeyBase64);
  const [ivB64, authTagB64, ciphertextB64] = stored.split(".");
  if (!ivB64 || !authTagB64 || !ciphertextB64) throw new Error("Malformed encrypted secret.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}

/**
 * A real, writable SecretsProvider for deployments running without AWS
 * Secrets Manager (SECRETS_PROVIDER=env — the lean-launch default, see
 * ALLOW_ENV_SECRETS_IN_PRODUCTION in packages/config). EnvSecretsProvider
 * (this package's other implementation) is read-only by design — built
 * for statically pre-set env vars, not tenant-supplied credentials
 * created at runtime — but every real caller of ctx.secrets (tool
 * credentials, CRM/calendar/ticketing connections) only ever does the
 * latter. Without this, any such connection 500s in any deployment that
 * hasn't provisioned AWS.
 *
 * Values are AES-256-GCM encrypted at rest, keyed by the same
 * CHANNEL_CREDENTIALS_ENCRYPTION_KEY used for channel connections
 * (apps/api/src/lib/channelCrypto.ts has its own copy of this same
 * scheme, kept separate rather than threaded through here so the
 * already-deployed, working channel-connect routes stay untouched).
 * Shared here (not in apps/api) because apps/workers needs to read the
 * exact same secrets a tool connected via the API — two independent
 * encryption implementations reading/writing the same rows would be a
 * correctness footgun waiting to happen.
 */
export class DbSecretsProvider implements SecretsProvider {
  constructor(
    private prisma: PrismaClient,
    private encryptionKeyBase64: string,
  ) {}

  async getSecret(key: string): Promise<string | undefined> {
    const row = await withPlatformContext(this.prisma, (tx) => tx.platformSecret.findUnique({ where: { key } }));
    return row ? decrypt(row.encryptedValue, this.encryptionKeyBase64) : undefined;
  }

  async setSecret(key: string, value: string): Promise<void> {
    const encryptedValue = encrypt(value, this.encryptionKeyBase64);
    await withPlatformContext(this.prisma, (tx) =>
      tx.platformSecret.upsert({ where: { key }, create: { key, encryptedValue }, update: { encryptedValue } }),
    );
  }
}
