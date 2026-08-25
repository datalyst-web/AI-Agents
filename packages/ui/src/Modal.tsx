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
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-up" onClick={onClose} />
      <div className="relative w-full max-w-md animate-fade-up rounded-xl3 bg-brand-gradient-soft p-px shadow-card-hover">
        <div className="rounded-[calc(1.75rem-1px)] bg-surface-raised/98 p-6 backdrop-blur">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold tracking-tight text-white">{title}</h3>
              {subtitle ? <p className="mt-1 text-xs text-white/50">{subtitle}</p> : null}
            </div>
            <button
              onClick={onClose}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/5 hover:text-white"
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
  );
}
