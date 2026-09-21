#!/usr/bin/env node
// One-time consent that lets the platform send email as a Google Workspace
// mailbox without a Workspace admin (see GmailApiEmailProvider's `oauth`
// mode in packages/email). Run it on a machine with a browser:
//
//   node infra/scripts/gmail-authorize.mjs <desktop-client.json> <mailbox@domain> <out.json>
//
// <desktop-client.json> is the file Google Cloud downloads for an OAuth
// client of type "Desktop app". The mailbox owner signs in and clicks Allow;
// the script checks the approving account really is <mailbox>, and that the
// send permission was actually granted, before writing anything.
//
// <out.json> receives GMAIL_OAUTH_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN
// (file mode 600). Nothing secret is printed. Load them into the hosting
// environment from that file, then delete it.
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const [clientFile, expectedEmailArg, outFile] = process.argv.slice(2);
if (!clientFile || !expectedEmailArg || !outFile) {
  console.error("usage: node infra/scripts/gmail-authorize.mjs <desktop-client.json> <mailbox@domain> <out.json>");
  process.exit(2);
}
const expectedEmail = expectedEmailArg.trim().toLowerCase();

const clientJson = JSON.parse(fs.readFileSync(clientFile, "utf8"));
const client = clientJson.installed ?? clientJson.web;
if (!client?.client_id || !client?.client_secret) {
  console.error("That file isn't an OAuth client download (expected an 'installed' or 'web' section with client_id and client_secret).");
  process.exit(1);
}
if (!clientJson.installed) {
  console.warn("Note: this is a 'Web application' client. If Google rejects the redirect, create a 'Desktop app' client instead.");
}

const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const state = randomBytes(16).toString("hex");

function openBrowser(url) {
  const [cmd, args] =
    process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

function finish(res, status, message) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><title>Email permission</title><body style="font:16px system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">${message}</body>`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/") return finish(res, 404, "Not found.");
  try {
    if (url.searchParams.get("state") !== state) throw new Error("The sign-in response didn't match this request. Run the script again.");
    const denied = url.searchParams.get("error");
    if (denied) throw new Error(`Google reported: ${denied}. Nothing was saved.`);
    const code = url.searchParams.get("code");
    if (!code) throw new Error("Google didn't return an authorisation code.");

    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        client_id: client.client_id,
        client_secret: client.client_secret,
        redirect_uri: redirectUri,
      }),
    });
    const token = await resp.json();
    if (!resp.ok) throw new Error(`Google refused the exchange: ${token.error ?? resp.status}${token.error_description ? ` — ${token.error_description}` : ""}`);

    // The id_token comes straight from Google over TLS in this response, so
    // reading its claims without re-verifying the signature is sound here.
    const claims = JSON.parse(Buffer.from(String(token.id_token ?? "").split(".")[1] ?? "", "base64url").toString() || "{}");
    const email = String(claims.email ?? "").toLowerCase();
    if (email !== expectedEmail) {
      throw new Error(`You approved as ${email || "an unknown account"}, not ${expectedEmail}. Nothing was saved — run it again and choose ${expectedEmail}.`);
    }
    if (!String(token.scope ?? "").split(" ").includes(GMAIL_SEND_SCOPE)) {
      throw new Error("The 'Send email on your behalf' box wasn't ticked. Nothing was saved — run it again and tick it.");
    }
    if (!token.refresh_token) {
      throw new Error("Google didn't issue a long-lived permission. Remove this app at myaccount.google.com/permissions and run again.");
    }

    fs.writeFileSync(
      outFile,
      JSON.stringify({
        GMAIL_OAUTH_CLIENT_ID: client.client_id,
        GMAIL_OAUTH_CLIENT_SECRET: client.client_secret,
        GMAIL_OAUTH_REFRESH_TOKEN: token.refresh_token,
      }),
      { mode: 0o600 },
    );
    finish(res, 200, `<h2>All set ✅</h2><p>The platform can now send email as <b>${expectedEmail}</b>. You can close this tab.</p>`);
    console.log(`Authorized as ${email}; saved 3 settings to ${outFile}.`);
    server.close();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    finish(res, 400, `<h2>That didn't work</h2><p>${message.replace(/</g, "&lt;")}</p>`);
    console.error(message);
    server.close();
    process.exitCode = 1;
  }
});

let redirectUri = "";
server.listen(0, "127.0.0.1", () => {
  redirectUri = `http://127.0.0.1:${server.address().port}`;
  const authUrl =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: `openid email ${GMAIL_SEND_SCOPE}`,
      access_type: "offline",
      prompt: "consent",
      login_hint: expectedEmail,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
    });
  console.log("Opening Google in your browser. If it doesn't open, paste this address into it:\n");
  console.log(authUrl + "\n");
  openBrowser(authUrl);
});

setTimeout(() => {
  console.error("Timed out after 10 minutes without a response. Nothing was saved.");
  process.exit(1);
}, 10 * 60 * 1000).unref();
