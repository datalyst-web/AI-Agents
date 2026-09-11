"use client";

import { useEffect, useState } from "react";
import { ThemeToggleButton } from "./ThemeToggleButton";

/**
 * Light/dark switch for the signed-out pages (landing, guide, terms,
 * privacy, and the auth screens).
 *
 * Separate from the dashboard's theme, deliberately: that one is a tenant
 * setting persisted server-side (see auth.tsx / tenants.routes.ts theme
 * endpoint) and shared with the tenant's widgets. A visitor here has no
 * account, so their choice is per-browser only and lives in localStorage
 * under its own key — the two never collide. The control itself is shared
 * (ThemeToggleButton) so both surfaces look identical.
 *
 * The initial value is applied before first paint by the inline script in
 * app/layout.tsx; this component only reflects and toggles it, so there's
 * no flash of the wrong theme on load.
 */
export const PUBLIC_THEME_KEY = "datalyst:public-theme";

type Theme = "dark" | "light";

export function PublicThemeToggle() {
  const [theme, setThemeState] = useState<Theme | null>(null);

  // Read from the DOM rather than from storage: the inline script has
  // already resolved stored-preference-or-system-preference by this point,
  // so the attribute is the single source of truth for what's on screen.
  useEffect(() => {
    setThemeState(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);

  function toggle() {
    const next: Theme = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    setThemeState(next);
    try {
      localStorage.setItem(PUBLIC_THEME_KEY, next);
    } catch {
      // Private browsing or blocked storage — the toggle still works for
      // this page view, it just won't be remembered. Not worth surfacing.
    }
  }

  // Renders a same-size placeholder until mounted so the server-rendered
  // markup and the first client render agree (the server can't know the
  // visitor's theme).
  if (theme === null) return <div className="h-8 w-8" aria-hidden="true" />;

  return <ThemeToggleButton theme={theme} onToggle={toggle} />;
}
