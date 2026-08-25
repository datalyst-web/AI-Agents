import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import type { QueueClient, QueueMessage } from "./types.js";

/**
 * Production queue backend — the shared platform SQS setup described in
 * ARCHITECTURE.md ("One SQS account setup ... per-product queues"). Queue
 * name here is actually a full queue URL (SQS has no separate name/URL
 * indirection worth adding); callers pass the env var value straight
 * through (e.g. SQS_KNOWLEDGE_INGEST_QUEUE_URL).
 */
export class SqsQueueClient implements QueueClient {
  private client: SQSClient;
  private stopped = false;

  constructor(region: string) {
    this.client = new SQSClient({ region });
  }

  async enqueue<T>(queueUrl: string, payload: T, opts?: { delaySeconds?: number }): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(payload),
        DelaySeconds: opts?.delaySeconds,
      }),
    );
  }

  async consume<T>(queueUrl: string, handler: (msg: QueueMessage<T>) => Promise<void>): Promise<void> {
    while (!this.stopped) {
      const resp = await this.client.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
          VisibilityTimeout: 60,
        }),
      );
      for (const message of resp.Messages ?? []) {
        if (!message.Body || !message.ReceiptHandle) continue;
        try {
          await handler({
            id: message.MessageId ?? "",
            body: JSON.parse(message.Body) as T,
            receiptHandle: message.ReceiptHandle,
          });
          await this.client.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }));
        } catch (err) {
          // Not deleted -> redelivered after the visibility timeout expires.
          // eslint-disable-next-line no-console
          console.error(`[queue] handler failed for message ${message.MessageId}:`, err);
        }
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }
}
