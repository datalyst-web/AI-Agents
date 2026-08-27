"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

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
          <h1 className="text-xl font-semibold tracking-tight text-white">Welcome back</h1>
          <p className="mt-1 text-sm text-white/50">Sign in to manage your AI chat agents</p>
        </div>

        <div className="rounded-xl3 bg-brand-gradient-soft p-px shadow-card">
          <form onSubmit={onSubmit} className="space-y-3.5 rounded-[calc(1.75rem-1px)] bg-surface-raised/95 p-6 backdrop-blur">
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
                <Link href="/forgot-password" className="text-xs font-medium text-brand-300 hover:underline">
                  Forgot password?
                </Link>
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            {error ? <p className="text-xs text-danger">{error}</p> : null}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </div>
        <p className="mt-5 text-center text-xs text-white/40">
          No account?{" "}
          <Link href="/signup" className="font-medium text-brand-300 hover:underline">
            Start your trial
          </Link>
        </p>
      </div>
    </div>
  );
}
