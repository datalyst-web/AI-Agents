"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, PasswordInput } from "@chat-agent/ui";
import { api, ApiError, isTwoFactorChallenge } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PublicThemeToggle } from "@/components/PublicThemeToggle";
import { BackToHome } from "@/components/BrandHome";
import { TURNSTILE_SITE_KEY, TurnstileWidget, type TurnstileHandle } from "@/components/TurnstileWidget";

const RESEND_COOLDOWN_SECONDS = 45;

export default function SignupPage() {
  const { user, loading: authLoading, completeTwoFactor, resendTwoFactorCode, establishSessionFromToken } = useAuth();
  const router = useRouter();
  // Someone already signed in has no business on this page — straight to
  // their dashboard (and never into a second signup).
  useEffect(() => {
    if (!authLoading && user) router.replace("/overview");
  }, [authLoading, user, router]);
  const [tenantName, setTenantName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);
  // Set once the account is created and a confirmation code has been
  // emailed; its presence swaps the form for the code prompt.
  const [challenge, setChallenge] = useState<{ challenge: string; email: string } | null>(null);
  const [code, setCode] = useState("");
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  // Starts counting down the moment a code is first sent, not only after a
  // manual resend — the button's whole job is to still be there once the
  // original email hasn't shown up, so it shouldn't be clickable before
  // that's even had a chance to happen.
  useEffect(() => {
    if (!challenge || resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [challenge, resendCooldown]);

  async function onResendCode() {
    if (!challenge || resending || resendCooldown > 0) return;
    setResending(true);
    setError(null);
    setResendMessage(null);
    try {
      const fresh = await resendTwoFactorCode(challenge.challenge);
      // The old challenge and the code it was tied to are both dead the
      // moment a new one is issued — swap in the new challenge and clear
      // whatever digits were typed against the old code.
      setChallenge({ challenge: fresh.challenge, email: fresh.email });
      setCode("");
      setResendMessage("New code sent — check your email.");
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't resend the code. Please try again.");
    } finally {
      setResending(false);
    }
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
      const result = await api.signup(tenantName, email, password, turnstileToken ?? undefined);
      if (isTwoFactorChallenge(result)) setChallenge({ challenge: result.challenge, email: result.email });
      else await establishSessionFromToken(result.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Signup failed.");
      // Tokens are single-use — get a fresh one for the next attempt.
      turnstileRef.current?.reset();
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitCode(e: FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      await completeTwoFactor(challenge.challenge, code);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That code didn't work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <BackToHome />
      <div className="absolute right-4 top-4 z-10">
        <PublicThemeToggle />
      </div>
      <div className="pointer-events-none absolute -top-32 left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-brand-gradient opacity-20 blur-3xl" />
      <div className="relative w-full max-w-sm animate-fade-up">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{challenge ? "Confirm your email" : "Start your trial"}</h1>
          <p className="mt-1 text-sm text-foreground/50">
            {challenge ? (
              <>We sent a 6-digit code to {challenge.email}</>
            ) : (
              "14 days free — our team builds your AI employee for you"
            )}
          </p>
        </div>

        <div className="rounded-xl3 bg-brand-gradient-soft p-px shadow-card">
          {challenge ? (
            <form onSubmit={onSubmitCode} className="space-y-3.5 rounded-[calc(1.75rem-1px)] bg-surface-raised/95 p-6 backdrop-blur">
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground/60">6-digit code</label>
                <input
                  autoFocus
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-center text-lg font-semibold tracking-[0.4em] text-foreground outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
              {error ? <p className="text-xs text-danger">{error}</p> : null}
              <Button type="submit" disabled={busy || code.length !== 6} className="w-full">
                {busy ? "Verifying..." : "Confirm and continue"}
              </Button>
              <div className="text-center">
                <button
                  type="button"
                  onClick={onResendCode}
                  disabled={resending || resendCooldown > 0}
                  className="text-xs font-medium text-brand-link transition-colors hover:underline disabled:cursor-not-allowed disabled:text-foreground/30 disabled:no-underline"
                >
                  {resending ? "Sending…" : resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : "Resend code"}
                </button>
              </div>
              {resendMessage ? <p className="text-center text-xs text-success">{resendMessage}</p> : null}
              <p className="text-center text-[11px] leading-relaxed text-foreground/35">
                Your account is created. The code expires in 10 minutes — check your spam folder if it hasn&apos;t arrived. Still
                nothing?{" "}
                <Link href="/login" className="text-foreground/55 underline underline-offset-2 hover:text-foreground/80">
                  Sign in
                </Link>{" "}
                to start over.
              </p>
            </form>
          ) : (
          <form onSubmit={onSubmit} className="space-y-3.5 rounded-[calc(1.75rem-1px)] bg-surface-raised/95 p-6 backdrop-blur">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground/60">Business name</label>
              <input
                required
                value={tenantName}
                onChange={(e) => setTenantName(e.target.value)}
                className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground/60">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground/60">Password</label>
              <PasswordInput required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <TurnstileWidget ref={turnstileRef} onToken={setTurnstileToken} />
            {error ? <p className="text-xs text-danger">{error}</p> : null}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Creating account..." : "Create account"}
            </Button>
            <p className="text-center text-[11px] leading-relaxed text-foreground/35">
              By creating an account you agree to our{" "}
              <Link href="/terms" className="text-foreground/55 underline underline-offset-2 hover:text-foreground/80">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="text-foreground/55 underline underline-offset-2 hover:text-foreground/80">
                Privacy Policy
              </Link>
              .
            </p>
          </form>
          )}
        </div>
        <p className="mt-5 text-center text-xs text-foreground/40">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-brand-link hover:text-brand-link-hover hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
