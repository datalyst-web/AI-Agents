import Link from "next/link";

/**
 * The Datalyst Africa logo on the signed-out marketing pages (home, guide,
 * legal): in the header, where it links home, and in the footer. The
 * sign-in style screens show a "Back to home" button instead of a logo.
 *
 * Deliberately NOT used on client-facing surfaces (the standalone agent
 * page, the widget) — those are white-labelled for each client and must
 * never show or point to Datalyst (CLAUDE.md principle 6).
 *
 * The image is 480x207 with a transparent background and black lettering;
 * the `.brand-logo` class (globals.css) puts it on a white card in the dark
 * theme so it stays legible.
 */
const LOGO_SRC = "/brand/datalyst-africa-logo.png";
const LOGO_ALT = "Datalyst Africa — what gets measured, gets managed";
const HOME_LABEL = "Datalyst Africa — home";

function Logo({ heightClass, eager = false }: { heightClass: string; eager?: boolean }) {
  return (
    // A plain <img>: a static, already-small PNG that doesn't need Next's
    // image optimiser (which would add a runtime dependency to the container).
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={LOGO_SRC}
      alt={LOGO_ALT}
      width={480}
      height={207}
      loading={eager ? "eager" : "lazy"}
      className={`brand-logo w-auto ${heightClass}`}
    />
  );
}

/** Top-left logo in the header of the public pages. */
export function HeaderBrand() {
  return (
    <Link href="/" aria-label={HOME_LABEL} className="rounded-lg transition-opacity hover:opacity-85">
      <Logo heightClass="h-10" eager />
    </Link>
  );
}

/** Footer logo on the public pages (not a link — the header one is). */
export function FooterBrand() {
  return <Logo heightClass="h-12" />;
}

/**
 * Top-left "Back to home" button on the sign-in style screens (login,
 * signup, password reset, invite). These pages carry no logo on purpose —
 * the logo belongs in the site header only.
 */
export function BackToHome() {
  return (
    <Link
      href="/"
      className="absolute left-4 top-4 z-10 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-foreground/60 ring-1 ring-inset ring-surface-border transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Back to home
    </Link>
  );
}
