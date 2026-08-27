export interface QueueMessage<T = unknown> {
  id: string;
  body: T;
  receiptHandle?: string; // present for SQS-backed messages, needed to delete/ack
  /** 1-indexed attempt count — RedisQueueClient's own retry/backoff/dead-letter tracking (SQS has this natively via receive count + redrive policy). */
  attempt?: number;
}

export interface QueueClient {
  enqueue<T>(queueName: string, payload: T, opts?: { delaySeconds?: number }): Promise<void>;
  /**
   * Long-polls for messages. `handler` must resolve (ack) or throw
   * (nack -> redelivered after visibility timeout / retry) — the queue
   * client itself never silently drops a message, matching
   * CLAUDE.md's "a failed action must not silently drop" principle
   * applied at the transport layer, not just the workflow layer.
   */
  consume<T>(queueName: string, handler: (msg: QueueMessage<T>) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
}
