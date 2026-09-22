import Link from "next/link";

/**
 * The platform's own logo on the signed-out pages (marketing, guide, legal,
 * and the sign-in/sign-up/reset/invite screens). Always a link to the home
 * page, so a visitor can get back from any of them.
 *
 * Deliberately NOT used on client-facing surfaces (the standalone agent
 * page, the widget) — those are white-labelled for each client and must
 * never point to Datalyst (CLAUDE.md principle 6).
 */
const HOME_LABEL = "Datalyst Africa — home";

function Mark({ size }: { size: "sm" | "lg" }) {
  const box = size === "lg" ? "h-11 w-11 rounded-xl2 shadow-glow-lg" : "h-8 w-8 rounded-xl shadow-glow";
  const icon = size === "lg" ? 18 : 15;
  return (
    <div className={`flex shrink-0 items-center justify-center bg-brand-gradient ${box}`}>
      <svg width={icon} height={icon} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2 8a6 6 0 1 1 6 6" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="12" cy="12" r="1.4" fill="white" />
      </svg>
    </div>
  );
}

/** Top-left logo + name in the header of the public pages. */
export function HeaderBrand() {
  return (
    <Link href="/" aria-label={HOME_LABEL} className="flex items-center gap-2.5 rounded-lg transition-opacity hover:opacity-85">
      <Mark size="sm" />
      <span className="text-sm font-semibold tracking-tight text-foreground">Datalyst Africa</span>
    </Link>
  );
}

/** Centered logo above the form on the sign-in style screens. */
export function AuthBrandMark() {
  return (
    <Link
      href="/"
      aria-label={HOME_LABEL}
      title="Back to the home page"
      className="mx-auto mb-4 block w-fit rounded-xl2 transition-transform hover:scale-105"
    >
      <Mark size="lg" />
    </Link>
  );
}
