import { createSign } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Platform-level transactional email (password reset today; account
 * notices later) — deliberately separate from the tenant-configured
 * SEND_EMAIL workflow action (apps/workers/src/jobs/workflowActions.ts),
 * which calls a *tenant's own* webhook/API and never touches this
 * provider. This is the platform's own outbound mail, same trust
 * boundary as the AIProvider/SecretsProvider abstractions (CLAUDE.md
 * principle 2 applied to email): application code never talks to an SMTP
 * socket directly.
 *
 * SMTP rather than a vendor SDK on purpose — every real provider a small
 * business already has (Gmail/Workspace, their hosting's mail server,
 * SendGrid/Mailgun/SES's SMTP relay) speaks it, so onboarding is "paste
 * four env vars" instead of picking and wiring a specific vendor.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ sent: boolean; error?: string }>;
}

/**
 * Dev/test default and the safe fallback when SMTP isn't configured yet —
 * logs instead of throwing, so a tenant not having set up email doesn't
 * take down request handling for something unrelated. Call sites that
 * need to tell the difference between "actually sent" and "logged only"
 * check the `sent` flag rather than assuming success.
 */
export class NoopEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<{ sent: boolean; error?: string }> {
    // eslint-disable-next-line no-console
    console.warn(`[email:noop] SMTP not configured — would have sent "${message.subject}" to ${message.to}`);
    return { sent: false, error: "smtp_not_configured" };
  }
}

export class SmtpEmailProvider implements EmailProvider {
  private transporter: Transporter;
  private fromAddress: string;

  constructor(opts: { host: string; port: number; secure: boolean; user: string; password: string; fromAddress: string }) {
    this.transporter = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.secure,
      auth: { user: opts.user, pass: opts.password },
    });
    this.fromAddress = opts.fromAddress;
  }

  async send(message: EmailMessage): Promise<{ sent: boolean; error?: string }> {
    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      return { sent: true };
    } catch (err) {
      return { sent: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export interface GoogleServiceAccount {
  client_email: string;
  private_key: string;
}

/** A mailbox user's own one-time consent: an OAuth client plus the refresh token it granted. */
export interface GoogleOAuthUserCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export type GmailAuth = { serviceAccount: GoogleServiceAccount } | { oauth: GoogleOAuthUserCredentials };

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

/**
 * Sends through a Google Workspace mailbox over Google's HTTPS API instead
 * of SMTP. Exists because Railway blocks outbound SMTP (ports 25/465/587)
 * on every plan below Pro, so no SMTP provider can work from there — Google,
 * Brevo or otherwise. HTTPS isn't blocked.
 *
 * Two ways to authenticate, both limited to the gmail.send scope:
 * - `serviceAccount`: Workspace domain-wide delegation, impersonating
 *   `fromAddress`. Needs a Workspace super-admin to authorise it once.
 * - `oauth`: the mailbox's own one-time consent (a refresh token from
 *   infra/scripts/gmail-authorize.mjs). No admin needed; stops working if
 *   the user revokes access or changes their password, and the send then
 *   reports google_token_invalid_grant.
 *
 * Either way the message is sent by the real mailbox — it appears in its
 * Sent folder, and SPF/DKIM are Google's own, so recipients see a normal
 * message from that address.
 */
export class GmailApiEmailProvider implements EmailProvider {
  private accessToken: { value: string; expiresAt: number } | null = null;
  // Builds the RFC 822 message only; streamTransport never opens a socket.
  private composer = nodemailer.createTransport({ streamTransport: true, buffer: true });

  constructor(
    private opts: GmailAuth & { fromAddress: string; fetchImpl?: typeof fetch; now?: () => number },
  ) {}

  private get fetch() {
    return this.opts.fetchImpl ?? fetch;
  }

  private now() {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt - 60_000 > this.now()) return this.accessToken.value;

    const resp = await this.fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: this.tokenRequestBody(),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await resp.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!resp.ok || !body.access_token) {
      // Google's own error code only (e.g. unauthorized_client when the
      // domain-wide delegation entry is missing, invalid_grant when consent
      // was revoked) — never the credentials themselves.
      throw new Error(`google_token_${body.error ?? resp.status}${body.error_description ? `: ${body.error_description}` : ""}`);
    }
    this.accessToken = { value: body.access_token, expiresAt: this.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }

  private tokenRequestBody(): URLSearchParams {
    if ("oauth" in this.opts) {
      return new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.opts.oauth.clientId,
        client_secret: this.opts.oauth.clientSecret,
        refresh_token: this.opts.oauth.refreshToken,
      });
    }
    const iat = Math.floor(this.now() / 1000);
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
      iss: this.opts.serviceAccount.client_email,
      sub: this.opts.fromAddress,
      scope: GMAIL_SEND_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat,
      exp: iat + 3600,
    })}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(this.opts.serviceAccount.private_key, "base64url");
    return new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    });
  }

  async send(message: EmailMessage): Promise<{ sent: boolean; error?: string }> {
    try {
      const composed = await this.composer.sendMail({
        from: this.opts.fromAddress,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      const raw = Buffer.from(composed.message as Buffer).toString("base64url");
      const resp = await this.fetch(GMAIL_SEND_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${await this.getAccessToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ raw }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as { error?: { message?: string } };
        if (resp.status === 401) this.accessToken = null;
        return { sent: false, error: `gmail_send_${resp.status}${body.error?.message ? `: ${body.error.message}` : ""}` };
      }
      return { sent: true };
    } catch (err) {
      return { sent: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/**
 * Accepts the service account key file's JSON as-is, or base64-encoded
 * (easier to paste into a hosting dashboard as one line).
 */
export function parseGoogleServiceAccount(value: string): GoogleServiceAccount {
  const trimmed = value.trim();
  const json = trimmed.startsWith("{") ? trimmed : Buffer.from(trimmed, "base64").toString("utf8");
  let parsed: Partial<GoogleServiceAccount>;
  try {
    parsed = JSON.parse(json) as Partial<GoogleServiceAccount>;
  } catch {
    throw new Error("GMAIL_SERVICE_ACCOUNT_JSON is not valid JSON (or base64-encoded JSON).");
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("GMAIL_SERVICE_ACCOUNT_JSON is missing client_email or private_key — use the service account's JSON key file.");
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

export function createEmailProviderFromEnv(env: {
  GMAIL_SERVICE_ACCOUNT_JSON?: string;
  GMAIL_OAUTH_CLIENT_ID?: string;
  GMAIL_OAUTH_CLIENT_SECRET?: string;
  GMAIL_OAUTH_REFRESH_TOKEN?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_SECURE?: string;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM_ADDRESS?: string;
}): EmailProvider {
  // Gmail API takes priority: where it's configured, SMTP is either blocked
  // (Railway below Pro) or a leftover from a previous provider.
  if (env.GMAIL_OAUTH_CLIENT_ID && env.GMAIL_OAUTH_CLIENT_SECRET && env.GMAIL_OAUTH_REFRESH_TOKEN && env.SMTP_FROM_ADDRESS) {
    return new GmailApiEmailProvider({
      oauth: {
        clientId: env.GMAIL_OAUTH_CLIENT_ID,
        clientSecret: env.GMAIL_OAUTH_CLIENT_SECRET,
        refreshToken: env.GMAIL_OAUTH_REFRESH_TOKEN,
      },
      fromAddress: env.SMTP_FROM_ADDRESS,
    });
  }
  if (env.GMAIL_SERVICE_ACCOUNT_JSON && env.SMTP_FROM_ADDRESS) {
    try {
      return new GmailApiEmailProvider({
        serviceAccount: parseGoogleServiceAccount(env.GMAIL_SERVICE_ACCOUNT_JSON),
        fromAddress: env.SMTP_FROM_ADDRESS,
      });
    } catch (err) {
      // Logged loudly rather than thrown: a bad email key must not stop
      // logins and chats from working. Every send then reports sent:false.
      // eslint-disable-next-line no-console
      console.error(`[email] ${err instanceof Error ? err.message : String(err)} Email is disabled until this is fixed.`);
      return new NoopEmailProvider();
    }
  }
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD || !env.SMTP_FROM_ADDRESS) {
    return new NoopEmailProvider();
  }
  return new SmtpEmailProvider({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ? Number(env.SMTP_PORT) : 587,
    secure: env.SMTP_SECURE === "true",
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    fromAddress: env.SMTP_FROM_ADDRESS,
  });
}
