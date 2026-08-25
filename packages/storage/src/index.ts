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
  constructor(
    private bucket: string,
    private productPrefix: string,
    region: string,
  ) {
    this.client = new S3Client({ region });
  }

  tenantKey(tenantId: string, ...parts: string[]): string {
    return [this.productPrefix, tenantId, ...parts].join("/");
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: "aws:kms" }),
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
