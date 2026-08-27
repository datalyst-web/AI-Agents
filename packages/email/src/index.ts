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

export function createEmailProviderFromEnv(env: {
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_SECURE?: string;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM_ADDRESS?: string;
}): EmailProvider {
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
