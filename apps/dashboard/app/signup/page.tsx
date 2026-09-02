"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, PasswordInput } from "@chat-agent/ui";
import { api, setToken, ApiError } from "@/lib/api";

export default function SignupPage() {
  const router = useRouter();
  const [tenantName, setTenantName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token } = await api.signup(tenantName, email, password);
      setToken(token);
      router.push("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Signup failed.");
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
          <h1 className="text-xl font-semibold tracking-tight text-white">Start your trial</h1>
          <p className="mt-1 text-sm text-white/50">Set up your business&apos;s AI employee in minutes</p>
        </div>

        <div className="rounded-xl3 bg-brand-gradient-soft p-px shadow-card">
          <form onSubmit={onSubmit} className="space-y-3.5 rounded-[calc(1.75rem-1px)] bg-surface-raised/95 p-6 backdrop-blur">
            <div>
              <label className="mb-1 block text-xs font-medium text-white/60">Business name</label>
              <input
                required
                value={tenantName}
                onChange={(e) => setTenantName(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
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
              <label className="mb-1 block text-xs font-medium text-white/60">Password</label>
              <PasswordInput required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error ? <p className="text-xs text-danger">{error}</p> : null}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Creating account..." : "Create account"}
            </Button>
          </form>
        </div>
        <p className="mt-5 text-center text-xs text-white/40">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-brand-300 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
