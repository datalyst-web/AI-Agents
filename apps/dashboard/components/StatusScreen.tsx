import type { ReactNode } from "react";

/** The platform's mark — same shape as the login/signup card logo and the favicon (app/icon.svg). */
export function BrandMark() {
  return (
    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl2 bg-brand-gradient shadow-glow-lg">
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2 8a6 6 0 1 1 6 6" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="12" cy="12" r="1.4" fill="white" />
      </svg>
    </div>
  );
}

/**
 * Full-page "something's not right" layout shared by the 404 and crash
 * screens, so both read as part of the product rather than a framework
 * default. Theme tokens only, so it follows light/dark like everything else.
 */
export function StatusScreen({
  mark,
  eyebrow,
  title,
  body,
  actions,
}: {
  mark: ReactNode;
  eyebrow: string;
  title: string;
  body: string;
  actions: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-6 text-foreground">
      <div className="w-full max-w-md text-center animate-fade-up">
        {mark}
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-brand-link">{eyebrow}</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-foreground/55">{body}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">{actions}</div>
      </div>
    </main>
  );
}
