"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import Script from "next/script";
import { Button, PasswordInput } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";

// Baked in at build time (Vercel env), same pattern as NEXT_PUBLIC_API_BASE_URL
// elsewhere in this app — must match the API's GOOGLE_CLIENT_ID exactly, since
// the backend verifies the token's audience against its own copy of this id.
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
// Public by design (Cloudflare's own docs: the site key is meant to ship to
// the browser) — only TURNSTILE_SECRET_KEY on the API side is sensitive.
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
          }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
    turnstile?: {
      render: (
        container: HTMLElement,
        options: { sitekey: string; callback: (token: string) => void; "error-callback"?: () => void; theme?: string },
      ) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

export default function LoginPage() {
  const { login, loginWithGoogle } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleScriptLoaded, setGoogleScriptLoaded] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement>(null);

  const [turnstileScriptLoaded, setTurnstileScriptLoaded] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetId = useRef<string | undefined>(undefined);
  // The Google button's own effect below must NOT re-run (re-initializing/
  // re-rendering the button) every time the CAPTCHA token changes, so its
  // callback reads the latest token from this ref rather than closing over
  // the turnstileToken state value directly.
  const turnstileTokenRef = useRef<string | null>(null);
  useEffect(() => {
    turnstileTokenRef.current = turnstileToken;
  }, [turnstileToken]);

  // Burns the just-used (single-use) token and gets a fresh one queued up
  // for the next attempt — without this, a wrong password on attempt 1
  // would silently fail attempt 2 as well with a stale/already-spent token.
  function resetTurnstile() {
    setTurnstileToken(null);
    if (window.turnstile && turnstileWidgetId.current) window.turnstile.reset(turnstileWidgetId.current);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setError("Please complete the CAPTCHA.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(email, password, turnstileToken ?? undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed.");
      resetTurnstile();
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!turnstileScriptLoaded || !TURNSTILE_SITE_KEY || !turnstileContainerRef.current || !window.turnstile) return;
    turnstileWidgetId.current = window.turnstile.render(turnstileContainerRef.current, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: "dark",
      callback: (token) => setTurnstileToken(token),
      "error-callback": () => setTurnstileToken(null),
    });
  }, [turnstileScriptLoaded]);

  useEffect(() => {
    if (!googleScriptLoaded || !GOOGLE_CLIENT_ID || !googleButtonRef.current || !window.google) return;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      // Without this, a returning user gets Chrome's native FedCM
      // "quick re-authentication" chip ("Sign in as {name}") popping up
      // unprompted — a white pill the browser renders itself, completely
      // outside our CSS/theme control, clashing with the always-dark
      // login card. We already offer the styled filled_black button
      // below for the same action, so the automatic one is just noise.
      auto_select: false,
      callback: async (response) => {
        if (TURNSTILE_SITE_KEY && !turnstileTokenRef.current) {
          setError("Please complete the CAPTCHA.");
          return;
        }
        setBusy(true);
        setError(null);
        try {
          await loginWithGoogle(response.credential, turnstileTokenRef.current ?? undefined);
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Google sign-in failed.");
          resetTurnstile();
        } finally {
          setBusy(false);
        }
      },
    });
    window.google.accounts.id.renderButton(googleButtonRef.current, {
      // The login card is always dark (fixed-dark by design, never
      // theme-toggled) — filled_black is the only GIS theme that actually
      // reads as "part of this card" instead of a lighter foreign box
      // dropped on top of it. Width matches the card's own content width
      // (measured, not hardcoded) so it lines up exactly with the
      // full-width "Sign in" button above it instead of looking narrower.
      theme: "filled_black",
      size: "large",
      shape: "pill",
      width: Math.round(googleButtonRef.current.clientWidth),
      logo_alignment: "center",
      text: "signin_with",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleScriptLoaded]);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      {GOOGLE_CLIENT_ID ? (
        <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={() => setGoogleScriptLoaded(true)} />
      ) : null}
      {TURNSTILE_SITE_KEY ? (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
          onLoad={() => setTurnstileScriptLoaded(true)}
        />
      ) : null}
      <div className="pointer-events-none absolute -top-32 left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-brand-gradient opacity-20 blur-3xl" />
      <div className="relative w-full max-w-sm animate-fade-up">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl2 bg-brand-gradient shadow-glow-lg">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path d="M2 8a6 6 0 1 1 6 6" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="12" cy="12" r="1.4" fill="white" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-white">Welcome back</h1>
          <p className="mt-1 text-sm text-white/50">Sign in to manage your AI chat agents</p>
        </div>

        <div className="rounded-xl3 bg-brand-gradient-soft p-px shadow-card">
          <div className="space-y-3.5 rounded-[calc(1.75rem-1px)] bg-surface-raised/95 p-6 backdrop-blur">
            <form onSubmit={onSubmit} className="space-y-3.5">
              <div>
                <label className="mb-1 block text-xs font-medium text-white/60">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-xs font-medium text-white/60">Password</label>
                  <Link href="/forgot-password" className="text-xs font-medium text-brand-link hover:underline">
                    Forgot password?
                  </Link>
                </div>
                <PasswordInput required value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              {TURNSTILE_SITE_KEY ? <div ref={turnstileContainerRef} className="flex justify-center pt-1" /> : null}
              {error ? <p className="text-xs text-danger">{error}</p> : null}
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? "Signing in..." : "Sign in"}
              </Button>
            </form>

            {GOOGLE_CLIENT_ID ? (
              <>
                <div className="flex items-center gap-3 pt-1">
                  <div className="h-px flex-1 bg-white/10" />
                  <span className="text-xs text-white/40">or</span>
                  <div className="h-px flex-1 bg-white/10" />
                </div>
                <div ref={googleButtonRef} className="flex justify-center" />
              </>
            ) : null}
          </div>
        </div>
        <p className="mt-5 text-center text-xs text-white/40">
          No account?{" "}
          <Link href="/signup" className="font-medium text-brand-link hover:underline">
            Start your trial
          </Link>
        </p>
      </div>
    </div>
  );
}
