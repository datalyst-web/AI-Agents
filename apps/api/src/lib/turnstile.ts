import { env } from "../env.js";

/**
 * Verifies a Cloudflare Turnstile token against Cloudflare's own
 * siteverify endpoint — the token itself is opaque to us, only Cloudflare
 * can confirm it was actually solved for our site key. Returns true (skips
 * verification) when TURNSTILE_SECRET_KEY isn't configured, same "optional
 * in dev/CI, required in a real deploy" pattern as Google Sign-in's
 * GOOGLE_CLIENT_ID — never block local dev on a Cloudflare account.
 */
export async function verifyTurnstileToken(token: string | undefined, remoteIp?: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;

  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = (await resp.json()) as { success: boolean };
    return data.success === true;
  } catch {
    // Cloudflare unreachable — fail closed (login blocked) rather than
    // silently letting the CAPTCHA gate be bypassed by a network blip.
    return false;
  }
}
