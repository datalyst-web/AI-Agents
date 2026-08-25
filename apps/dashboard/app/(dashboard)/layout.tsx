"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";

const NAV = [
  { href: "/", label: "Overview", icon: IconGrid },
  { href: "/agents", label: "Agents", icon: IconBot },
  { href: "/tools", label: "Tools & Integrations", icon: IconPlug },
  { href: "/workflows", label: "Workflows", icon: IconFlow },
  { href: "/billing", label: "Billing & Usage", icon: IconCard },
  { href: "/audit-log", label: "Audit Log", icon: IconShield },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-white/40">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" />
        <span className="ml-2">Loading...</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="glass sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-surface-border">
        <div className="flex items-center gap-2.5 px-5 py-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-gradient shadow-glow">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 8a6 6 0 1 1 6 6" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="12" cy="12" r="1.4" fill="white" />
            </svg>
          </div>
          <div>
            <span className="block text-sm font-semibold tracking-tight text-white">Chat Agent</span>
            <span className="block text-[10px] font-medium uppercase tracking-wider text-white/35">Client Console</span>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-all duration-200 ${
                  active
                    ? "bg-brand-500/15 text-white shadow-[inset_0_0_0_1px_rgba(114,136,255,0.35)]"
                    : "text-white/55 hover:bg-white/5 hover:text-white"
                }`}
              >
                {active ? (
                  <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-brand-gradient" />
                ) : null}
                <Icon className={`h-4 w-4 shrink-0 ${active ? "text-brand-300" : "text-white/40 group-hover:text-white/70"}`} />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-surface-border p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-semibold text-white">
              {user.email.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-white/85">{user.email}</div>
              <button onClick={logout} className="text-[11px] text-white/40 hover:text-white/70">
                Sign out
              </button>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="glass sticky top-0 z-10 flex h-16 items-center justify-between border-b border-surface-border px-8">
          <div className="flex items-center gap-2 text-xs text-white/40">
            <span className="rounded-full bg-success/10 px-2 py-1 font-medium text-success ring-1 ring-inset ring-success/25">
              ● All systems live
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden rounded-full bg-brand-500/10 px-3 py-1.5 text-xs font-medium text-brand-200 ring-1 ring-inset ring-brand-500/25 sm:inline-flex">
              Free Demo Plan
            </span>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-8 py-8">
          <div className="mx-auto max-w-6xl animate-fade-up">{children}</div>
        </main>
      </div>
    </div>
  );
}

function IconGrid({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none">
      <rect x="3" y="3" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="3" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="11" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="11" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function IconBot({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none">
      <rect x="4" y="7" width="12" height="9" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 7V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="3" r="1" fill="currentColor" />
      <circle cx="7.5" cy="11.5" r="1" fill="currentColor" />
      <circle cx="12.5" cy="11.5" r="1" fill="currentColor" />
    </svg>
  );
}
function IconPlug({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none">
      <path d="M7 3v4M13 3v4M5 7h10v3a5 5 0 0 1-10 0V7Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 15v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function IconFlow({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none">
      <circle cx="4.5" cy="5" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="15.5" cy="15" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="15.5" cy="5" r="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 5h6.5M15.5 7v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function IconCard({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none">
      <rect x="3" y="5" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 8.5h14" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function IconShield({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none">
      <path d="M10 3l6 2v4.5c0 4-2.7 6.6-6 7.5-3.3-.9-6-3.5-6-7.5V5l6-2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7.5 10l1.8 1.8L12.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
