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

export default function SignupPage() {
  const { user, loading: authLoading, completeTwoFactor, establishSessionFromToken } = useAuth();
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
              <p className="text-center text-[11px] leading-relaxed text-foreground/35">
                Your account is created. The code expires in 10 minutes — check your spam folder if it hasn&apos;t arrived. If it
                expires,{" "}
                <Link href="/login" className="text-foreground/55 underline underline-offset-2 hover:text-foreground/80">
                  sign in
                </Link>{" "}
                to get a new one.
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
