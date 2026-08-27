"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@chat-agent/ui";
import { api, ApiError } from "@/lib/api";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword(token, password);
      setDone(true);
      setTimeout(() => router.push("/login"), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That reset link is invalid or has expired.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <p className="text-sm text-white/50">
        This link is missing its reset token — make sure you followed the exact link from your email, or{" "}
        <Link href="/forgot-password" className="font-medium text-brand-300 hover:underline">
          request a new one
        </Link>
        .
      </p>
    );
  }

  if (done) {
    return <p className="text-sm text-white/70">Password updated — taking you to sign in...</p>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3.5">
      <div>
        <label className="mb-1 block text-xs font-medium text-white/60">New password</label>
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-white/60">Confirm new password</label>
        <input
          type="password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
        />
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Updating..." : "Update password"}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute -top-32 left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-brand-gradient opacity-20 blur-3xl" />
      <div className="relative w-full max-w-sm animate-fade-up">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl2 bg-brand-gradient shadow-glow-lg">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path d="M2 8a6 6 0 1 1 6 6" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="12" cy="12" r="1.4" fill="white" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-white">Choose a new password</h1>
        </div>

        <div className="rounded-xl3 bg-brand-gradient-soft p-px shadow-card">
          <div className="rounded-[calc(1.75rem-1px)] bg-surface-raised/95 p-6 backdrop-blur">
            <Suspense fallback={<p className="text-sm text-white/40">Loading...</p>}>
              <ResetPasswordForm />
            </Suspense>
          </div>
        </div>
        <p className="mt-5 text-center text-xs text-white/40">
          <Link href="/login" className="font-medium text-brand-300 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
