"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth, type DashboardTheme } from "@/lib/auth";
import { API_BASE } from "@/lib/api";

const THEMES: { value: DashboardTheme; label: string; swatch: string }[] = [
  { value: "DARK", label: "Dark", swatch: "bg-[#08090f]" },
  { value: "LIGHT", label: "Light", swatch: "bg-[#f7f8fc]" },
];

const PLAN_LABEL: Record<"STARTER" | "GROWTH" | "SCALE" | "ENTERPRISE", string> = {
  STARTER: "Starter Plan",
  GROWTH: "Growth Plan",
  SCALE: "Scale Plan",
  ENTERPRISE: "Enterprise Plan",
};

// Full nav — staff (while impersonating) only. Engineering/config
// surfaces (Tools, Workflows, Audit Log) are deliberately absent from
// CLIENT_NAV below under the fully-managed model: staff configure
// everything, clients only test/approve/view. See CLAUDE.md Managed
// Setup Service.
const TENANT_NAV = [
  { href: "/", label: "Overview", icon: IconGrid },
  { href: "/agents", label: "Agents", icon: IconBot },
  { href: "/tools", label: "Tools & Integrations", icon: IconPlug },
  { href: "/workflows", label: "Workflows", icon: IconFlow },
  { href: "/approvals", label: "Approvals", icon: IconCheck },
  { href: "/billing", label: "Billing & Usage", icon: IconCard },
  { href: "/audit-log", label: "Audit Log", icon: IconShield },
];
const CLIENT_NAV = [
  { href: "/", label: "Overview", icon: IconGrid },
  { href: "/agents", label: "Agents", icon: IconBot },
  { href: "/approvals", label: "Approvals", icon: IconCheck },
  { href: "/billing", label: "Billing & Usage", icon: IconCard },
  // Kept for clients on purpose (not an "AI console") — CLAUDE.md requires
  // staff actions on a client's behalf stay visible to that client
  // ("never ambiguity about who configured what"); hiding it would
  // defeat the audit trail's whole point.
  { href: "/audit-log", label: "Audit Log", icon: IconShield },
];
const STAFF_NAV = [{ href: "/managed-setup", label: "Managed Setup", icon: IconStaff }];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, loading, logout, impersonation, endImpersonation, setTheme } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isStaff = user?.role === "setup_specialist" || user?.role === "platform_admin";
  // A staff account with no active impersonation has no tenant to scope
  // client-facing pages to — only the Managed Setup queue makes sense.
  // A genuine client (never staff) always gets the restricted nav —
  // staff retain the full nav while impersonating, per CLAUDE.md's "staff
  // use the exact same tenant-scoped tools a client would," just not a
  // reduced version of them.
  const nav = isStaff && !impersonation ? STAFF_NAV : impersonation ? [...STAFF_NAV, ...TENANT_NAV] : CLIENT_NAV;

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!loading && isStaff && !impersonation && pathname !== "/managed-setup") router.push("/managed-setup");
  }, [loading, isStaff, impersonation, pathname, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-foreground/40">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" />
        <span className="ml-2">Loading...</span>
      </div>
    );
  }

  // Prefer this tenant's own white-label branding; fall back to the
  // platform operator's own brand (e.g. "Datalyst Africa") when the
  // tenant hasn't been given a custom logo/name yet, or when there's no
  // tenant in scope at all (staff's own Managed Setup view).
  const sidebarLogoUrl = user.logoUrl ?? user.platformLogoUrl;
  const sidebarBrandName = user.brandName ?? user.platformBrandName;
  // Staff's own home (no client in view yet) gets a fixed, neutral
  // identity — "Client Console" would be misleading here since there's
  // no client currently in scope. The moment "Manage this client" starts
  // an impersonation session, sidebarBrandName/sidebarLogoUrl switch to
  // that client's own branding (or the unbranded-client default below).
  const isOwnStaffHome = isStaff && !impersonation;

  return (
    <div className="flex min-h-screen">
      <aside className="glass sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-surface-border">
        <div className="flex items-center gap-2.5 px-5 py-6">
          {sidebarLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`${API_BASE}${sidebarLogoUrl}`}
              alt=""
              className="h-8 w-8 shrink-0 rounded-lg object-contain"
            />
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-gradient shadow-glow">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 8a6 6 0 1 1 6 6" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
                <circle cx="12" cy="12" r="1.4" fill="white" />
              </svg>
            </div>
          )}
          <div className="min-w-0">
            <span className="block truncate text-sm font-semibold tracking-tight text-foreground">
              {sidebarBrandName ?? "Chat Agent"}
            </span>
            <span className="block text-[10px] font-medium uppercase tracking-wider text-foreground/35">
              {sidebarBrandName ? "AI Console" : isOwnStaffHome ? "Console" : "Client Console"}
            </span>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {nav.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-all duration-200 ${
                  active
                    ? "bg-brand-500/15 text-foreground shadow-[inset_0_0_0_1px_rgba(114,136,255,0.35)]"
                    : "text-foreground/55 hover:bg-foreground/5 hover:text-foreground"
                }`}
              >
                {active ? (
                  <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-brand-gradient" />
                ) : null}
                <Icon className={`h-4 w-4 shrink-0 ${active ? "text-brand-link" : "text-foreground/40 group-hover:text-foreground/70"}`} />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-surface-border p-3">
          {!(isStaff && !impersonation) ? (
            <div className="mb-2 px-2 py-1.5">
              <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-foreground/35">
                Theme <span className="normal-case text-foreground/25">— also sets your widget</span>
              </div>
              <div className="flex gap-1.5">
                {THEMES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    title={t.label}
                    aria-label={`${t.label} theme`}
                    onClick={() => void setTheme(t.value)}
                    className={`h-6 w-6 rounded-full ${t.swatch} ring-1 ring-inset ring-black/10 transition-all ${
                      user.theme === t.value ? "ring-2 ring-brand-400 ring-offset-2 ring-offset-surface-raised" : "hover:scale-110"
                    }`}
                  />
                ))}
              </div>
            </div>
          ) : null}
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-semibold text-white">
              {user.email.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-foreground/85">{user.email}</div>
              <button onClick={logout} className="text-[11px] text-foreground/40 hover:text-foreground/70">
                Sign out
              </button>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        {impersonation ? (
          <div className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-warning/15 px-8 py-2 text-xs ring-1 ring-inset ring-warning/30">
            <span className="flex items-center gap-2 font-medium text-warning">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 3l6.5 11H1.5L8 3Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                <path d="M8 6.5v3M8 11.5v.01" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              Managing <span className="text-foreground">{impersonation.tenantName}</span> on their behalf — every action here is logged to their audit trail.
            </span>
            <button
              onClick={() => void endImpersonation()}
              className="shrink-0 rounded-full bg-warning/20 px-3 py-1 font-medium text-warning transition-colors hover:bg-warning/30"
            >
              End session
            </button>
          </div>
        ) : null}
        <header className="glass sticky top-0 z-10 flex h-16 items-center justify-between border-b border-surface-border px-8">
          <div className="flex items-center gap-2 text-xs text-foreground/40">
            <span className="rounded-full bg-success/10 px-2 py-1 font-medium text-success ring-1 ring-inset ring-success/25">
              ● All systems live
            </span>
          </div>
          <div className="flex items-center gap-3">
            {user.subscriptionTier ? (
              <span className="hidden items-center gap-1.5 rounded-full bg-brand-500/10 px-3 py-1.5 text-xs font-medium text-brand-link ring-1 ring-inset ring-brand-500/25 sm:inline-flex">
                {PLAN_LABEL[user.subscriptionTier]}
                {user.subscriptionState === "TRIAL" ? <span className="text-brand-link/70">· Trial</span> : null}
                {user.subscriptionState === "PAST_DUE" ? <span className="text-warning">· Past due</span> : null}
              </span>
            ) : null}
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
function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 10l2.3 2.3L14 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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
function IconStaff({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="6.5" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 17c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14.5 4.5c1 .3 1.5 1.2 1.5 2s-.5 1.7-1.5 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
