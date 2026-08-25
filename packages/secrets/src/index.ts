import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  CreateSecretCommand,
} from "@aws-sdk/client-secrets-manager";

/**
 * Reads/writes secrets under a "chat/" path prefix in the platform-shared
 * Secrets Manager instance (see ARCHITECTURE.md "Shared platform hosting").
 * Clients/browsers never see these values — only backend services import
 * this package, per CLAUDE.md's Security Requirements.
 *
 * Dev mode ("env"): reads straight from process.env so local dev never
 * needs AWS credentials. Never allowed when NODE_ENV=production.
 */
export interface SecretsProvider {
  getSecret(key: string): Promise<string | undefined>;
  setSecret(key: string, value: string): Promise<void>;
}

export class EnvSecretsProvider implements SecretsProvider {
  async getSecret(key: string): Promise<string | undefined> {
    return process.env[key];
  }
  async setSecret(): Promise<void> {
    throw new Error(
      "EnvSecretsProvider is read-only (dev mode) — use SECRETS_PROVIDER=aws to write secrets.",
    );
  }
}

export class AwsSecretsProvider implements SecretsProvider {
  private client: SecretsManagerClient;
  private pathPrefix: string;
  private cache = new Map<string, { value: string; fetchedAt: number }>();
  private readonly cacheTtlMs = 5 * 60_000;

  constructor(opts: { region: string; pathPrefix: string }) {
    this.client = new SecretsManagerClient({ region: opts.region });
    this.pathPrefix = opts.pathPrefix.endsWith("/") ? opts.pathPrefix : `${opts.pathPrefix}/`;
  }

  private fullKey(key: string): string {
    return `${this.pathPrefix}${key}`;
  }

  async getSecret(key: string): Promise<string | undefined> {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.fetchedAt < this.cacheTtlMs) {
      return cached.value;
    }
    try {
      const resp = await this.client.send(
        new GetSecretValueCommand({ SecretId: this.fullKey(key) }),
      );
      const value = resp.SecretString;
      if (value !== undefined) {
        this.cache.set(key, { value, fetchedAt: Date.now() });
      }
      return value;
    } catch (err) {
      if ((err as { name?: string }).name === "ResourceNotFoundException") return undefined;
      throw err;
    }
  }

  async setSecret(key: string, value: string): Promise<void> {
    const secretId = this.fullKey(key);
    try {
      await this.client.send(new PutSecretValueCommand({ SecretId: secretId, SecretString: value }));
    } catch (err) {
      if ((err as { name?: string }).name === "ResourceNotFoundException") {
        await this.client.send(new CreateSecretCommand({ Name: secretId, SecretString: value }));
      } else {
        throw err;
      }
    }
    this.cache.delete(key);
  }
}

export function createSecretsProvider(opts: {
  mode: "env" | "aws";
  region?: string;
  pathPrefix?: string;
}): SecretsProvider {
  if (opts.mode === "aws") {
    if (!opts.region || !opts.pathPrefix) {
      throw new Error("AwsSecretsProvider requires region and pathPrefix.");
    }
    return new AwsSecretsProvider({ region: opts.region, pathPrefix: opts.pathPrefix });
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SECRETS_PROVIDER=env is not allowed in production — set SECRETS_PROVIDER=aws.",
    );
  }
  return new EnvSecretsProvider();
}
