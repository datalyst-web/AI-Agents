import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Thin wrapper around the shared platform S3 bucket
 * (ARCHITECTURE.md: "One S3 bucket, key-prefixed by product then tenant").
 * Every key this package writes is built via tenantKey() so a caller
 * cannot accidentally construct a cross-tenant path — CLAUDE.md principle 1
 * applied to object storage.
 */
export class ObjectStore {
  private client: S3Client;
  private readonly isR2: boolean;
  constructor(
    private bucket: string,
    private productPrefix: string,
    region: string,
    // When set, points the client at an S3-compatible provider other than
    // AWS (e.g. Cloudflare R2's account-scoped endpoint) instead of real
    // S3. R2 requires path-style addressing and has no concept of region
    // beyond the literal string "auto" — AWS S3 itself is untouched when
    // this is left unset.
    endpoint?: string,
  ) {
    this.isR2 = Boolean(endpoint);
    this.client = new S3Client({
      region: endpoint ? "auto" : region,
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
  }

  tenantKey(tenantId: string, ...parts: string[]): string {
    return [this.productPrefix, tenantId, ...parts].join("/");
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // R2 doesn't support AWS-KMS-based SSE (and encrypts at rest by
        // default regardless) — this parameter is AWS-S3-only.
        ...(this.isR2 ? {} : { ServerSideEncryption: "aws:kms" as const }),
      }),
    );
  }

  async getObject(key: string): Promise<Buffer> {
    const resp = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of resp.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async presignedDownloadUrl(key: string, expiresInSeconds = 300): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: expiresInSeconds });
  }
}
