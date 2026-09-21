"use client";

import { useEffect } from "react";
import Link from "next/link";
import { BrandMark, StatusScreen } from "@/components/StatusScreen";

/**
 * Catches a page that throws while rendering. Without it Next.js shows
 * "Application error: a client-side exception has occurred" — raw, unbranded,
 * with no way forward. `reset` re-renders the segment, which recovers from
 * the common case: a transient failure while loading data.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <StatusScreen
      mark={<BrandMark />}
      eyebrow="Something went wrong"
      title="This page hit an unexpected error"
      body="Try again — it usually clears on its own. If it keeps happening, email info@datalystafrica.com and we'll look into it."
      actions={
        <>
          <button
            type="button"
            onClick={reset}
            className="rounded-xl bg-brand-gradient px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition-shadow hover:shadow-glow-lg"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-xl px-5 py-2.5 text-sm font-semibold text-foreground/70 ring-1 ring-inset ring-surface-border transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
          >
            Go to the home page
          </Link>
        </>
      }
    />
  );
}
