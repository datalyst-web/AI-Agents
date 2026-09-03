"use client";

import { useEffect, useState, type ReactNode } from "react";
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
  { href: "/leads", label: "Leads", icon: IconLead },
  { href: "/tools", label: "Tools & Integrations", icon: IconPlug },
  // Deployment channels (Telegram/WhatsApp/Messenger/Instagram) — unlike
  // Tools above, connecting these needs the CLIENT's own external
  // credentials, so channel:connect is deliberately granted to client
  // roles too (see shared-types/rbac.ts) and this stays in CLIENT_NAV.
  { href: "/integrations", label: "Integrations", icon: IconChannels },
  { href: "/workflows", label: "Workflows", icon: IconFlow },
  { href: "/approvals", label: "Approvals", icon: IconCheck },
  { href: "/billing", label: "Billing & Usage", icon: IconCard },
  { href: "/team", label: "Team", icon: IconUsers },
  { href: "/audit-log", label: "Audit Log", icon: IconShield },
];
const CLIENT_NAV = [
  { href: "/", label: "Overview", icon: IconGrid },
  { href: "/agents", label: "Agents", icon: IconBot },
  { href: "/leads", label: "Leads", icon: IconLead },
  { href: "/integrations", label: "Integrations", icon: IconChannels },
  { href: "/approvals", label: "Approvals", icon: IconCheck },
  { href: "/billing", label: "Billing & Usage", icon: IconCard },
  { href: "/team", label: "Team", icon: IconUsers },
  // Kept for clients on purpose (not an "AI console") — CLAUDE.md requires
  // staff actions on a client's behalf stay visible to that client
  // ("never ambiguity about who configured what"); hiding it would
  // defeat the audit trail's whole point.
  { href: "/audit-log", label: "Audit Log", icon: IconShield },
];
const STAFF_NAV_BASE = [{ href: "/managed-setup", label: "Managed Setup", icon: IconStaff }];
// platform:manage_tenants (which the /healthz/providers endpoint behind
// this page requires) is only ever granted to platform_admin, never
// setup_specialist — keeping the link itself platform_admin-only avoids
// setup_specialist staff clicking into a page that just 403s on load.
const PLATFORM_ADMIN_NAV = [{ href: "/system-health", label: "System Health", icon: IconPulse }];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, loading, logout, impersonation, endImpersonation, setTheme } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isStaff = user?.role === "setup_specialist" || user?.role === "platform_admin";
  const staffNav = user?.role === "platform_admin" ? [...STAFF_NAV_BASE, ...PLATFORM_ADMIN_NAV] : STAFF_NAV_BASE;
  // A staff account with no active impersonation has no tenant to scope
  // client-facing pages to — only the Managed Setup queue makes sense.
  // A genuine client (never staff) always gets the restricted nav —
  // staff retain the full nav while impersonating, per CLAUDE.md's "staff
  // use the exact same tenant-scoped tools a client would," just not a
  // reduced version of them.
  const nav = isStaff && !impersonation ? staffNav : impersonation ? [...staffNav, ...TENANT_NAV] : CLIENT_NAV;

  // Below md, the sidebar is an off-canvas drawer instead of a permanent
  // column (there's no room for a fixed 256px rail next to real content on
  // a phone-width viewport) — closed by default, toggled by the header's
  // hamburger button, and auto-closed on navigation so it doesn't stay
  // open covering the page a user just tapped through to.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!loading && isStaff && !impersonation && !staffNav.some((item) => item.href === pathname)) {
      router.push("/managed-setup");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // Staff's own home (no client in view yet) gets a fixed, neutral
  // identity — "Client Console" would be misleading here since there's
  // no client currently in scope. The moment "Manage this client" starts
  // an impersonation session, sidebarBrandName/sidebarLogoUrl switch to
  // that client's own branding (or the unbranded-client default below).
  const isOwnStaffHome = isStaff && !impersonation;
  // The platform's own brand/logo is deliberately NOT shown here — it
  // used to fall back to it whenever no tenant was in scope, which made
  // staff's own unmanaged home look like a real client's console was
  // already open before anyone clicked "Manage this client".
  const sidebarLogoUrl = isOwnStaffHome ? null : (user.logoUrl ?? user.platformLogoUrl);
  const sidebarBrandName = isOwnStaffHome ? null : (user.brandName ?? user.platformBrandName);

  return (
    <div className="flex min-h-screen">
      {/* Backdrop — mobile only, closes the drawer on tap-outside. z-30 sits
          between the drawer (z-40) and everything else. */}
      {mobileNavOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      ) : null}
      <aside
        className={`glass fixed inset-y-0 left-0 z-40 flex h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-surface-border transition-transform duration-200 md:sticky md:top-0 md:translate-x-0 ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
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
              {/* Deliberately keyed off user.brandName (the TENANT's own
                  white-label branding, only ever present during an active
                  impersonation) rather than sidebarBrandName above, which
                  also falls back to the platform operator's own brand —
                  otherwise staff's own unscoped home (no client in view)
                  showed "AI Console" just because the platform's fallback
                  name/logo happened to render, making it look like a real
                  client console was already open. */}
              {user.brandName ? "AI Console" : isOwnStaffHome ? "Console" : "Client Console"}
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
          <div className="mb-2 px-2 py-1.5">
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-foreground/35">
              Theme{" "}
              <span className="normal-case text-foreground/25">
                {/* Staff's own unscoped home has no tenant/widget to affect —
                    this is purely a local browser preference there (see
                    setTheme()/getLocalStaffTheme() in lib/auth.tsx), so the
                    "also sets your widget" framing would be actively wrong. */}
                {isStaff && !impersonation ? "— this browser only" : "— also sets your widget"}
              </span>
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
          <div className="sticky top-0 z-20 flex flex-col items-start gap-2 bg-warning/15 px-4 py-2 text-xs ring-1 ring-inset ring-warning/30 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-8">
            <span className="flex items-center gap-2 font-medium text-warning">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
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
        <header className="glass sticky top-0 z-10 flex h-16 items-center justify-between border-b border-surface-border px-4 sm:px-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open menu"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground/60 transition-colors hover:bg-foreground/5 hover:text-foreground md:hidden"
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
            <span className="hidden rounded-full bg-success/10 px-2 py-1 text-xs font-medium text-success ring-1 ring-inset ring-success/25 sm:inline-block">
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
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
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
function IconChannels({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none">
      <path
        d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v6A1.5 1.5 0 0 1 14.5 13H8l-3 2.5V13H5.5A1.5 1.5 0 0 1 4 11.5v-6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
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
function IconUsers({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none">
      <circle cx="7.5" cy="6.5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 16.5c0-2.8 2-5 4.5-5s4.5 2.2 4.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M13 7a2.3 2.3 0 0 1 0 4.4M15.5 16c0-2.2-1.4-4-3.3-4.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
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
function IconLead({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none">
      <rect x="3" y="4.5" width="14" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="7.5" cy="9" r="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.5 12.5c.5-1.2 1.4-1.8 2-1.8s1.5.6 2 1.8M11.5 8h4M11.5 11h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
function IconPulse({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none">
      <path d="M2.5 10h3l1.8-5 3 9 1.8-5.5 1.4 3.5h3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
