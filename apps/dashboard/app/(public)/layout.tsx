import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared chrome for the public content pages (guide, terms, privacy) —
 * deliberately outside the (dashboard) group so they render with no
 * sidebar and require no auth: a prospect must be able to read them before
 * creating an account, and a regulator or a client's lawyer must be able to
 * reach the legal ones from a link.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-surface text-foreground">
      <header className="border-b border-surface-border/60">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-brand-gradient" />
            <span className="text-sm font-semibold tracking-tight text-foreground">Datalyst AI</span>
          </Link>
          <div className="flex items-center gap-5 text-xs text-foreground/50">
            <Link href="/guide" className="transition-colors hover:text-foreground/80">
              Guide
            </Link>
            <Link href="/terms" className="transition-colors hover:text-foreground/80">
              Terms
            </Link>
            <Link href="/privacy" className="transition-colors hover:text-foreground/80">
              Privacy
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-6 py-14">{children}</main>
      <footer className="border-t border-surface-border/60 py-8">
        <div className="mx-auto w-full max-w-3xl px-6 text-xs text-foreground/40">
          <Link href="/" className="transition-colors hover:text-foreground/70">
            ← Back to home
          </Link>
        </div>
      </footer>
    </div>
  );
}
