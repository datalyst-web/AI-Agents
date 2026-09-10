import type { ReactNode } from "react";

/**
 * Shared typography for the legal pages. Kept as plain components rather
 * than a markdown renderer — two static documents don't justify a
 * dependency, and this keeps the placeholder highlighting below possible.
 */
export function LegalTitle({ title, updated }: { title: string; updated: string }) {
  return (
    <div className="border-b border-surface-border pb-8">
      <h1 className="text-3xl font-semibold tracking-tightest text-foreground">{title}</h1>
      <p className="mt-2 text-sm text-foreground/45">Last updated: {updated}</p>
    </div>
  );
}

export function Clause({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="text-lg font-semibold text-foreground">{heading}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-foreground/65">{children}</div>
    </section>
  );
}

export function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="ml-1 space-y-2">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5">
          <span className="mt-[0.45rem] h-1 w-1 flex-none rounded-full bg-foreground/35" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A detail only the business owner (or their lawyer) can supply. Rendered
 * visibly rather than as a silent blank so it's impossible to publish this
 * document without noticing what's still unfilled.
 */
export function Fill({ children }: { children: ReactNode }) {
  return (
    <mark className="rounded bg-warning/15 px-1.5 py-0.5 font-mono text-[0.8em] font-semibold text-warning">[{children}]</mark>
  );
}

export function PlaceholderNotice() {
  return (
    <div className="rounded-xl2 bg-warning/10 px-5 py-4 text-sm text-warning ring-1 ring-inset ring-warning/25">
      <strong className="font-semibold">Draft — not yet legally reviewed.</strong> Every highlighted field below needs your real
      company details, and this document should be checked by a lawyer in your jurisdiction before you rely on it.
    </div>
  );
}
