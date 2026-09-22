import Link from "next/link";

/**
 * The Datalyst Africa logo on the signed-out pages (marketing, guide, legal,
 * and the sign-in/sign-up/reset/invite screens). In headers and above the
 * auth forms it is always a link to the home page, so a visitor can get back
 * from any of them.
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

/** Logo above the form on the sign-in style screens. */
export function AuthBrandMark() {
  return (
    <Link
      href="/"
      aria-label={HOME_LABEL}
      title="Back to the home page"
      className="mx-auto mb-5 block w-fit rounded-xl transition-transform hover:scale-[1.03]"
    >
      <Logo heightClass="h-16" eager />
    </Link>
  );
}

/** Large logo at the top of the home page, above the tagline. */
export function HeroBrand() {
  return (
    <div className="mb-8 flex justify-center">
      <Logo heightClass="h-24 sm:h-28" eager />
    </div>
  );
}
