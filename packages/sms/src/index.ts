/**
 * Platform-level transactional SMS (escalation alerts today) — same trust
 * boundary and abstraction shape as @chat-agent/email (CLAUDE.md principle
 * 2 applied to SMS): application code never talks to a carrier/vendor API
 * directly, always through SmsProvider.
 *
 * Unlike email there's no universal wire protocol every vendor speaks, so
 * this picks Twilio's plain REST API (called via fetch, no SDK dependency)
 * as the one supported vendor — the standard default choice, and easy to
 * add a second TextProvider implementation alongside it later if a tenant
 * ever needs one. Falls back to a no-op that logs instead of throwing when
 * credentials aren't configured, exactly like NoopEmailProvider, so an
 * unconfigured platform doesn't take down request handling for something
 * unrelated to the request path.
 */
export interface SmsMessage {
  to: string;
  body: string;
}

export interface SmsProvider {
  send(message: SmsMessage): Promise<{ sent: boolean; error?: string }>;
}

export class NoopSmsProvider implements SmsProvider {
  async send(message: SmsMessage): Promise<{ sent: boolean; error?: string }> {
    // eslint-disable-next-line no-console
    console.warn(`[sms:noop] Twilio not configured — would have sent an SMS to ${message.to}`);
    return { sent: false, error: "sms_not_configured" };
  }
}

export class TwilioSmsProvider implements SmsProvider {
  constructor(private opts: { accountSid: string; authToken: string; fromNumber: string }) {}

  async send(message: SmsMessage): Promise<{ sent: boolean; error?: string }> {
    try {
      const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.opts.accountSid}/Messages.json`, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${this.opts.accountSid}:${this.opts.authToken}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: message.to, From: this.opts.fromNumber, Body: message.body }).toString(),
      });
      if (!resp.ok) {
        const data = (await resp.json().catch(() => ({}))) as { message?: string };
        return { sent: false, error: data.message ?? `Twilio responded ${resp.status}` };
      }
      return { sent: true };
    } catch (err) {
      return { sent: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export function createSmsProviderFromEnv(env: {
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
}): SmsProvider {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) {
    return new NoopSmsProvider();
  }
  return new TwilioSmsProvider({
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    fromNumber: env.TWILIO_FROM_NUMBER,
  });
}
