"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button, PasswordInput } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

const ROLE_LABEL: Record<string, string> = {
  tenant_admin: "an admin",
  tenant_agent_editor: "an agent editor",
  tenant_viewer: "a viewer",
};

function AcceptInviteForm() {
  const searchParams = useSearchParams();
  const { acceptInvite } = useAuth();
  const token = searchParams.get("token") ?? "";

  const [invite, setInvite] = useState<{ email: string; role: string; tenantName: string } | null | undefined>(undefined);
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setInvite(null);
      return;
    }
    api
      .lookupInvite(token)
      .then(setInvite)
      .catch(() => setInvite(null));
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await acceptInvite(token, displayName, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That invite is invalid or has expired.");
      setBusy(false);
    }
  }

  if (invite === undefined) {
    return <p className="text-sm text-white/40">Loading...</p>;
  }

  if (invite === null) {
    return (
      <p className="text-sm text-white/50">
        This invite link is invalid or has expired — ask whoever invited you to send a new one, or{" "}
        <Link href="/login" className="font-medium text-brand-300 hover:underline">
          sign in
        </Link>{" "}
        if you already have an account.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3.5">
      <p className="text-sm text-white/60">
        Join <span className="text-white">{invite.tenantName}</span> as {ROLE_LABEL[invite.role] ?? invite.role}, signing in as{" "}
        <span className="text-white">{invite.email}</span>.
      </p>
      <div>
        <label className="mb-1 block text-xs font-medium text-white/60">Your name</label>
        <input
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-white/60">Password</label>
        <PasswordInput required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-white/60">Confirm password</label>
        <PasswordInput required minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Joining..." : "Accept invite"}
      </Button>
    </form>
  );
}

export default function AcceptInvitePage() {
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
          <h1 className="text-xl font-semibold tracking-tight text-white">You&apos;re invited</h1>
        </div>

        <div className="rounded-xl3 bg-brand-gradient-soft p-px shadow-card">
          <div className="rounded-[calc(1.75rem-1px)] bg-surface-raised/95 p-6 backdrop-blur">
            <Suspense fallback={<p className="text-sm text-white/40">Loading...</p>}>
              <AcceptInviteForm />
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
