"use client";

import { useAuth } from "@/lib/auth";
import { ThemeToggleButton } from "./ThemeToggleButton";

/**
 * The in-dashboard theme switch. Same control as the signed-out pages
 * (ThemeToggleButton), different persistence: this writes through
 * useAuth().setTheme, which saves the tenant's DashboardTheme server-side
 * and therefore also repaints that tenant's widgets — one setting, two
 * surfaces (see widgetConfig.routes.ts).
 *
 * The one exception is staff on their own unscoped home, where there's no
 * tenant to save against and setTheme falls back to a per-browser
 * preference; the caller renders the explanatory caption for that case,
 * since it changes what the control actually means.
 */
export function DashboardThemeToggle() {
  const { user, setTheme } = useAuth();
  if (!user) return null;

  const theme = user.theme === "LIGHT" ? "light" : "dark";
  return <ThemeToggleButton theme={theme} onToggle={() => void setTheme(theme === "light" ? "DARK" : "LIGHT")} />;
}
