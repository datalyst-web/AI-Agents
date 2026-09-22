"use client";

import Script from "next/script";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

// Public by design (Cloudflare: the site key ships to the browser) — only
// TURNSTILE_SECRET_KEY on the API side is sensitive.
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

export interface TurnstileHandle {
  /** Discard the current token (it's single-use) and fetch a fresh one. */
  reset(): void;
}

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

function pageTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/**
 * The Cloudflare Turnstile bot check, shared by login and signup.
 *
 * Renders reliably on every visit to the page, not just the first one.
 * The pages used next/script's `onLoad`, which fires only when the script
 * is first downloaded: arriving by in-app navigation (after signing out,
 * or switching between Sign in and Start trial) found the script already
 * loaded, never set "loaded", and the check never appeared — so every
 * attempt failed with "Please complete the CAPTCHA". `onReady` fires on
 * every mount, and a mount-time check covers a script that's already there.
 *
 * Also: the widget is removed on unmount (so returning from the 2FA code
 * step renders a fresh one instead of nothing), an expired or failed token
 * is cleared rather than submitted, and its space is reserved up front so
 * the form doesn't jump when it appears.
 */
export const TurnstileWidget = forwardRef<TurnstileHandle, { onToken: (token: string | null) => void }>(function TurnstileWidget(
  { onToken },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (window.turnstile) setReady(true);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      reset() {
        onTokenRef.current(null);
        if (window.turnstile && widgetId.current) window.turnstile.reset(widgetId.current);
      },
    }),
    [],
  );

  useEffect(() => {
    if (!ready || !TURNSTILE_SITE_KEY || !container.current || !window.turnstile) return;
    const clear = () => onTokenRef.current(null);
    const id = window.turnstile.render(container.current, {
      sitekey: TURNSTILE_SITE_KEY,
      // Matches the page at mount; not re-rendered on a later theme toggle,
      // which would discard a check the visitor has already passed.
      theme: pageTheme(),
      callback: (token: string) => onTokenRef.current(token),
      "expired-callback": clear,
      "error-callback": clear,
      "timeout-callback": clear,
      "refresh-expired": "auto",
    });
    widgetId.current = id;
    return () => {
      try {
        window.turnstile?.remove(id);
      } catch {
        // Already gone with its container — nothing to clean up.
      }
      widgetId.current = undefined;
      clear();
    };
  }, [ready]);

  if (!TURNSTILE_SITE_KEY) return null;
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setReady(true)}
      />
      <div ref={container} className="flex min-h-[65px] justify-center pt-1" />
    </>
  );
});
