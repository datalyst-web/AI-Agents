"use client";

import { type ReactNode, useEffect } from "react";

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    // Scrolls as a whole (not just clipping) once a form is taller than the
    // viewport — e.g. the workflow builder's action-specific fields — since
    // `items-center` centering with no overflow handling silently pushes
    // the top of the modal (and its submit button) off-screen with no way
    // to reach it.
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-fade-up" onClick={onClose} />
      <div className="relative flex min-h-full items-center justify-center px-4 py-8">
        <div className="relative w-full max-w-md animate-fade-up rounded-xl3 bg-brand-gradient-soft p-px shadow-card-hover">
          <div className="max-h-[85vh] overflow-y-auto rounded-[calc(1.75rem-1px)] bg-surface-raised/98 p-6 backdrop-blur">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold tracking-tight text-foreground">{title}</h3>
                {subtitle ? <p className="mt-1 text-xs text-foreground/50">{subtitle}</p> : null}
              </div>
              <button
                onClick={onClose}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-foreground/40 transition-colors hover:bg-foreground/5 hover:text-foreground"
                aria-label="Close"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
