"use client";

import { useEffect, useState } from "react";

/**
 * Light/dark switch for the public pages (landing, guide, terms, privacy).
 *
 * Separate from the dashboard's theme, deliberately: that one is a tenant
 * setting persisted server-side (see auth.tsx / tenants.routes.ts theme
 * endpoint) and shared with the tenant's widgets. A visitor here has no
 * account, so their choice is per-browser only and lives in localStorage
 * under its own key — the two never collide.
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

  // Renders nothing until mounted so the server-rendered markup and the
  // first client render agree (the server can't know the visitor's theme).
  if (theme === null) return <div className="h-8 w-8" aria-hidden="true" />;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground/55 ring-1 ring-inset ring-surface-border transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
    >
      {theme === "light" ? (
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
          <path
            d="M16.5 11.8A7 7 0 1 1 8.2 3.5a5.5 5.5 0 0 0 8.3 8.3Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
          <circle cx="10" cy="10" r="3.4" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M10 2.5v1.8M10 15.7v1.8M17.5 10h-1.8M4.3 10H2.5M15.3 4.7l-1.3 1.3M6 14l-1.3 1.3M15.3 15.3 14 14M6 6 4.7 4.7"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}
