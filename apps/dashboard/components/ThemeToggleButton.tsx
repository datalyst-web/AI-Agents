"use client";

/**
 * The theme switch control itself — purely presentational, with no opinion
 * about where the choice is stored.
 *
 * Shared so the signed-out pages and the dashboard show the *same* control
 * rather than two lookalikes that drift apart: the two differ only in
 * persistence (a per-browser localStorage preference out front, a
 * server-persisted tenant setting inside), which is the callers' business,
 * not this component's.
 */
export function ThemeToggleButton({
  theme,
  onToggle,
  className = "",
}: {
  theme: "dark" | "light";
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
      className={`flex h-8 w-8 items-center justify-center rounded-lg text-foreground/55 ring-1 ring-inset ring-surface-border transition-colors hover:bg-foreground/[0.06] hover:text-foreground ${className}`}
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
