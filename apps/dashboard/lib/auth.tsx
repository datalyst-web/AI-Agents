"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api, setToken, getImpersonation, setImpersonation, type ImpersonationContext } from "./api";

export type DashboardTheme = "DARK" | "LIGHT";

interface AuthUser {
  id: string;
  email: string;
  role: string;
  /** The tenant currently in scope — overridden to the impersonated tenant while a Managed Setup session is active. */
  tenantId: string;
  displayName: string;
  /** Same value that drives this tenant's widgets (widgetConfig.routes.ts) — one setting, two surfaces. */
  theme: DashboardTheme;
  subscriptionTier: "STARTER" | "GROWTH" | "SCALE" | "ENTERPRISE" | null;
  subscriptionState: "ACTIVE" | "TRIAL" | "PAST_DUE" | "SUSPENDED" | "CANCELLED" | null;
  /** Staff-set white-label console name/logo — see tenants.routes.ts branding endpoints. Null until staff set them. */
  brandName: string | null;
  logoUrl: string | null;
  /** The platform operator's own brand (e.g. "Datalyst Africa") — fallback when the tenant has no branding of its own yet. */
  platformBrandName: string | null;
  platformLogoUrl: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  impersonation: ImpersonationContext | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  startImpersonation: (tenantId: string, tenantName: string, reason: string, durationMinutes?: number) => Promise<void>;
  endImpersonation: () => Promise<void>;
  setTheme: (theme: DashboardTheme) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [impersonation, setImpersonationState] = useState<ImpersonationContext | null>(null);
  const router = useRouter();

  function refreshMe() {
    return api
      .me()
      .then((me) => {
        const imp = getImpersonation();
        setImpersonationState(imp);
        // A staff account's own token carries no tenantId — while an
        // impersonation session is active, every other page's
        // api.xxx(user.tenantId, ...) call should transparently operate on
        // the tenant being managed, not the staff member's own (nonexistent)
        // tenant. This is the one seam that makes "same tools as a client"
        // (CLAUDE.md) work without touching any other page.
        setUser(imp ? { ...me, tenantId: imp.tenantId } : me);
      })
      .catch(() => {
        setUser(null);
        setImpersonationState(null);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refreshMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The one place that actually paints the theme — every dashboard page
  // just uses `bg-surface-*` / `text-foreground` classes, which resolve
  // through the CSS custom properties this attribute selects (see
  // globals.css). Runs before paint's worth of delay is fine here: theme
  // only changes on login/impersonation-switch, not per-navigation.
  useEffect(() => {
    document.documentElement.dataset.theme = (user?.theme ?? "DARK").toLowerCase();
  }, [user?.theme]);

  async function login(email: string, password: string) {
    const { token } = await api.login(email, password);
    setToken(token);
    setImpersonation(null);
    await refreshMe();
    router.push("/");
  }

  function logout() {
    setToken(null);
    setImpersonation(null);
    setUser(null);
    setImpersonationState(null);
    router.push("/login");
  }

  async function startImpersonation(tenantId: string, tenantName: string, reason: string, durationMinutes = 60) {
    const result = await api.startImpersonation(tenantId, reason, durationMinutes);
    setToken(result.token);
    setImpersonation({ tenantId: result.tenantId, tenantName, sessionId: result.sessionId, expiresAt: result.expiresAt });
    await refreshMe();
    router.push("/");
  }

  async function endImpersonation() {
    if (impersonation) {
      await api.endImpersonation(impersonation.sessionId).catch(() => undefined);
    }
    setImpersonation(null);
    setImpersonationState(null);
    // A manual { ...prev, tenantId: "" } patch here left theme/brandName/
    // logoUrl/subscriptionTier/subscriptionState stale — the client's
    // values kept showing (sidebar branding, theme) until something else
    // happened to trigger a fresh /me call. A real refetch is the only
    // way to get the staff's own default state back immediately; /me's
    // own session lookup already resolves correctly here since the
    // session was just marked ended above.
    await refreshMe();
    router.push("/managed-setup");
  }

  async function setTheme(theme: DashboardTheme) {
    if (!user) return;
    setUser({ ...user, theme }); // optimistic — the tenant's own dashboard should feel instant
    try {
      await api.updateTenantTheme(user.tenantId, theme);
    } catch {
      setUser((prev) => (prev ? { ...prev, theme: user.theme } : prev)); // revert on failure
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, impersonation, login, logout, startImpersonation, endImpersonation, setTheme }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
