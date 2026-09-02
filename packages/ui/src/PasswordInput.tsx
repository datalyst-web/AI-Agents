import { useState, type InputHTMLAttributes } from "react";

/**
 * Show/hide toggle for a password field — used on every auth-flow page
 * (login, signup, reset-password, accept-invite), all of which are
 * fixed-dark by design (never theme-toggled, see login page's own comment
 * on this), hence the literal white/black classes rather than
 * `text-foreground`-style theme tokens used elsewhere in the dashboard.
 */
export function PasswordInput({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        {...rest}
        type={visible ? "text" : "password"}
        className={`w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 pr-10 text-sm text-white outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20 ${className}`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        tabIndex={-1}
        className="absolute right-0 top-0 flex h-full w-10 items-center justify-center text-white/35 transition-colors hover:text-white/70"
      >
        {visible ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M2 8s2.2-4.5 6-4.5S14 8 14 8s-2.2 4.5-6 4.5S2 8 2 8Z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
            <circle cx="8" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M2 8s2.2-4.5 6-4.5S14 8 14 8s-2.2 4.5-6 4.5S2 8 2 8Z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
            <circle cx="8" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.3" />
            <path d="M2.5 2.5l11 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        )}
      </button>
    </div>
  );
}
