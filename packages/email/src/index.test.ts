import { generateKeyPairSync, createVerify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  GmailApiEmailProvider,
  NoopEmailProvider,
  SmtpEmailProvider,
  createEmailProviderFromEnv,
  parseGoogleServiceAccount,
} from "./index.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const serviceAccount = {
  client_email: "mailer@test-project.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};
const FROM = "info@example.com";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Simulates Google: the token endpoint, then the Gmail send endpoint. */
function fakeGoogle(opts: { tokenStatus?: number; tokenBody?: unknown; sendStatus?: number; sendBody?: unknown } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (String(url).includes("oauth2.googleapis.com")) {
      return json(opts.tokenStatus ?? 200, opts.tokenBody ?? { access_token: "tok-1", expires_in: 3600 });
    }
    return json(opts.sendStatus ?? 200, opts.sendBody ?? { id: "msg-1" });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("GmailApiEmailProvider", () => {
  it("requests a gmail.send token impersonating the sender, signed with the service account key", async () => {
    const google = fakeGoogle();
    const provider = new GmailApiEmailProvider({ serviceAccount, fromAddress: FROM, fetchImpl: google.fetchImpl });

    expect(await provider.send({ to: "customer@example.org", subject: "Hi", text: "Body" })).toEqual({ sent: true });

    const tokenCall = google.calls[0]!;
    expect(tokenCall.url).toBe("https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(String(tokenCall.init.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");

    const [header, claims, signature] = form.get("assertion")!.split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const decoded = JSON.parse(Buffer.from(claims!, "base64url").toString());
    expect(decoded).toMatchObject({
      iss: serviceAccount.client_email,
      sub: FROM,
      scope: "https://www.googleapis.com/auth/gmail.send",
      aud: "https://oauth2.googleapis.com/token",
    });
    expect(decoded.exp - decoded.iat).toBe(3600);
    const valid = createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(publicKey, signature!, "base64url");
    expect(valid).toBe(true);
  });

  it("sends a real RFC 822 message from the configured address, with the bearer token", async () => {
    const google = fakeGoogle();
    const provider = new GmailApiEmailProvider({ serviceAccount, fromAddress: FROM, fetchImpl: google.fetchImpl });

    await provider.send({ to: "customer@example.org", subject: "Reset your password", text: "Plain body", html: "<p>HTML body</p>" });

    const sendCall = google.calls[1]!;
    expect(sendCall.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect((sendCall.init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
    const raw = Buffer.from(JSON.parse(String(sendCall.init.body)).raw, "base64url").toString();
    expect(raw).toMatch(/^From: info@example\.com$/m);
    expect(raw).toMatch(/^To: customer@example\.org$/m);
    expect(raw).toMatch(/^Subject: Reset your password$/m);
    expect(raw).toContain("Plain body");
    expect(raw).toContain("<p>HTML body</p>");
  });

  it("includes attachments in the message it sends", async () => {
    const google = fakeGoogle();
    const provider = new GmailApiEmailProvider({ serviceAccount, fromAddress: FROM, fetchImpl: google.fetchImpl });
    await provider.send({
      to: "staff@example.org",
      subject: "New trial",
      text: "See attached",
      attachments: [{ filename: "price-list.txt", content: Buffer.from("Haircut: $10"), contentType: "text/plain" }],
    });
    const raw = Buffer.from(JSON.parse(String(google.calls[1]!.init.body)).raw, "base64url").toString();
    expect(raw).toMatch(/Content-Disposition: attachment; filename=price-list\.txt/);
    expect(raw).toContain(Buffer.from("Haircut: $10").toString("base64"));
  });

  it("reuses the access token until shortly before it expires", async () => {
    let now = 1_000_000;
    const google = fakeGoogle();
    const provider = new GmailApiEmailProvider({ serviceAccount, fromAddress: FROM, fetchImpl: google.fetchImpl, now: () => now });
    const tokenCalls = () => google.calls.filter((c) => c.url.includes("oauth2")).length;

    await provider.send({ to: "a@example.org", subject: "1", text: "1" });
    await provider.send({ to: "b@example.org", subject: "2", text: "2" });
    expect(tokenCalls()).toBe(1);

    now += 3600 * 1000 - 30_000; // inside the one-minute safety margin
    await provider.send({ to: "c@example.org", subject: "3", text: "3" });
    expect(tokenCalls()).toBe(2);
  });

  it("reports Google's reason, without throwing, when delegation isn't set up", async () => {
    const google = fakeGoogle({
      tokenStatus: 401,
      tokenBody: { error: "unauthorized_client", error_description: "Client is unauthorized to retrieve access tokens using this method" },
    });
    const provider = new GmailApiEmailProvider({ serviceAccount, fromAddress: FROM, fetchImpl: google.fetchImpl });

    const result = await provider.send({ to: "a@example.org", subject: "x", text: "x" });
    expect(result.sent).toBe(false);
    expect(result.error).toMatch(/^google_token_unauthorized_client/);
    expect(result.error).not.toContain("BEGIN PRIVATE KEY");
    expect(google.calls).toHaveLength(1);
  });

  it("reports a Gmail send failure and drops the token on 401 so the next send re-authenticates", async () => {
    const google = fakeGoogle({ sendStatus: 401, sendBody: { error: { message: "Invalid Credentials" } } });
    const provider = new GmailApiEmailProvider({ serviceAccount, fromAddress: FROM, fetchImpl: google.fetchImpl });

    expect(await provider.send({ to: "a@example.org", subject: "x", text: "x" })).toEqual({
      sent: false,
      error: "gmail_send_401: Invalid Credentials",
    });
    await provider.send({ to: "a@example.org", subject: "x", text: "x" });
    expect(google.calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(2);
  });
});

describe("GmailApiEmailProvider with the mailbox's own consent (refresh token)", () => {
  const oauth = { clientId: "client-1.apps.googleusercontent.com", clientSecret: "secret-1", refreshToken: "refresh-1" };

  it("exchanges the refresh token for an access token, then sends", async () => {
    const google = fakeGoogle();
    const provider = new GmailApiEmailProvider({ oauth, fromAddress: FROM, fetchImpl: google.fetchImpl });

    expect(await provider.send({ to: "customer@example.org", subject: "Hi", text: "Body" })).toEqual({ sent: true });

    const form = new URLSearchParams(String(google.calls[0]!.init.body));
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "refresh_token",
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      refresh_token: oauth.refreshToken,
    });
    expect((google.calls[1]!.init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
  });

  it("reports revoked consent without leaking the token", async () => {
    const google = fakeGoogle({ tokenStatus: 400, tokenBody: { error: "invalid_grant", error_description: "Token has been expired or revoked." } });
    const provider = new GmailApiEmailProvider({ oauth, fromAddress: FROM, fetchImpl: google.fetchImpl });

    const result = await provider.send({ to: "a@example.org", subject: "x", text: "x" });
    expect(result).toEqual({ sent: false, error: "google_token_invalid_grant: Token has been expired or revoked." });
    expect(result.error).not.toContain("refresh-1");
    expect(result.error).not.toContain("secret-1");
  });
});

describe("parseGoogleServiceAccount", () => {
  it("accepts the key file as JSON or base64", () => {
    const text = JSON.stringify({ type: "service_account", ...serviceAccount });
    expect(parseGoogleServiceAccount(text)).toEqual(serviceAccount);
    expect(parseGoogleServiceAccount(Buffer.from(text).toString("base64"))).toEqual(serviceAccount);
  });

  it("rejects values that aren't a service account key", () => {
    expect(() => parseGoogleServiceAccount("not json")).toThrow(/not valid JSON/);
    expect(() => parseGoogleServiceAccount(JSON.stringify({ client_id: "x" }))).toThrow(/missing client_email or private_key/);
  });
});

describe("createEmailProviderFromEnv", () => {
  const smtp = { SMTP_HOST: "smtp.example.com", SMTP_USER: "u", SMTP_PASSWORD: "p", SMTP_FROM_ADDRESS: FROM };

  it("prefers the Gmail API over SMTP when both are configured", () => {
    const provider = createEmailProviderFromEnv({ ...smtp, GMAIL_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount) });
    expect(provider).toBeInstanceOf(GmailApiEmailProvider);
  });

  it("prefers the mailbox's own consent when all three OAuth settings are present", () => {
    const oauthEnv = { GMAIL_OAUTH_CLIENT_ID: "c", GMAIL_OAUTH_CLIENT_SECRET: "s", GMAIL_OAUTH_REFRESH_TOKEN: "r" };
    expect(createEmailProviderFromEnv({ ...smtp, ...oauthEnv, GMAIL_SERVICE_ACCOUNT_JSON: "{broken" })).toBeInstanceOf(GmailApiEmailProvider);
    // Partial OAuth settings don't count — fall through to SMTP.
    expect(createEmailProviderFromEnv({ ...smtp, GMAIL_OAUTH_CLIENT_ID: "c" })).toBeInstanceOf(SmtpEmailProvider);
  });

  it("falls back to SMTP, then to the logging no-op", () => {
    expect(createEmailProviderFromEnv(smtp)).toBeInstanceOf(SmtpEmailProvider);
    expect(createEmailProviderFromEnv({})).toBeInstanceOf(NoopEmailProvider);
  });

  it("disables email instead of crashing when the key is malformed", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(createEmailProviderFromEnv({ ...smtp, GMAIL_SERVICE_ACCOUNT_JSON: "{broken" })).toBeInstanceOf(NoopEmailProvider);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Email is disabled until this is fixed"));
    errorSpy.mockRestore();
  });
});
