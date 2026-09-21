import Link from "next/link";
import { BrandMark, StatusScreen } from "@/components/StatusScreen";

/**
 * Shown for any unknown URL — a mistyped link, an old bookmark, a
 * shortened invite. Replaces Next.js's bare default, which carried no
 * branding and no way back.
 */
export default function NotFound() {
  return (
    <StatusScreen
      mark={<BrandMark />}
      eyebrow="404"
      title="We couldn't find that page"
      body="The link may be mistyped, or the page may have moved."
      actions={
        <>
          <Link
            href="/"
            className="rounded-xl bg-brand-gradient px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition-shadow hover:shadow-glow-lg"
          >
            Go to the home page
          </Link>
          <Link
            href="/login"
            className="rounded-xl px-5 py-2.5 text-sm font-semibold text-foreground/70 ring-1 ring-inset ring-surface-border transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
          >
            Sign in
          </Link>
        </>
      }
    />
  );
}
