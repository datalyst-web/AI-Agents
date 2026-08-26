"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api, setToken, getImpersonation, setImpersonation, type ImpersonationContext } from "./api";

interface AuthUser {
  id: string;
  email: string;
  role: string;
  /** The tenant currently in scope — overridden to the impersonated tenant while a Managed Setup session is active. */
  tenantId: string;
  displayName: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  impersonation: ImpersonationContext | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  startImpersonation: (tenantId: string, tenantName: string, reason: string, durationMinutes?: number) => Promise<void>;
  endImpersonation: () => Promise<void>;
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
    setUser((prev) => (prev ? { ...prev, tenantId: "" } : prev));
    router.push("/managed-setup");
  }

  return (
    <AuthContext.Provider value={{ user, loading, impersonation, login, logout, startImpersonation, endImpersonation }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
