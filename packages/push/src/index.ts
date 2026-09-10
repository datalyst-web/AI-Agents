import webpush from "web-push";

/**
 * Platform-level Web Push (escalation alerts to a staff member's browser)
 * — same abstraction shape as @chat-agent/email and @chat-agent/sms
 * (CLAUDE.md principle 2 applied to push): application code never talks
 * to the Push API directly, always through PushProvider.
 *
 * Unlike SMS, this needs no third-party account — Web Push is an open
 * standard (RFC 8030) authenticated by a VAPID key pair the platform
 * generates and owns itself, delivered by whichever push service the
 * subscriber's browser already uses (Chrome/Firefox/etc.), so there's no
 * vendor to sign up with. Falls back to a no-op that logs instead of
 * throwing when the key pair isn't configured, exactly like
 * NoopEmailProvider/NoopSmsProvider.
 */
export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

export interface PushProvider {
  send(subscription: PushSubscriptionKeys, payload: PushPayload): Promise<{ sent: boolean; error?: string; gone?: boolean }>;
}

export class NoopPushProvider implements PushProvider {
  async send(subscription: PushSubscriptionKeys, payload: PushPayload): Promise<{ sent: boolean; error?: string }> {
    // eslint-disable-next-line no-console
    console.warn(`[push:noop] VAPID keys not configured — would have sent "${payload.title}" to ${subscription.endpoint}`);
    return { sent: false, error: "push_not_configured" };
  }
}

export class WebPushProvider implements PushProvider {
  constructor(opts: { publicKey: string; privateKey: string; subject: string }) {
    webpush.setVapidDetails(opts.subject, opts.publicKey, opts.privateKey);
  }

  async send(subscription: PushSubscriptionKeys, payload: PushPayload): Promise<{ sent: boolean; error?: string; gone?: boolean }> {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify(payload),
      );
      return { sent: true };
    } catch (err) {
      // 404/410 means the browser unsubscribed or the subscription expired
      // — the caller should delete this row rather than keep retrying it.
      const statusCode = (err as { statusCode?: number }).statusCode;
      const gone = statusCode === 404 || statusCode === 410;
      return { sent: false, error: err instanceof Error ? err.message : String(err), gone };
    }
  }
}

export function createPushProviderFromEnv(env: {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}): PushProvider {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return new NoopPushProvider();
  }
  return new WebPushProvider({
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT ?? "mailto:support@example.com",
  });
}
