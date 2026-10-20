"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/reportError";

/** Reports errors that escape React (event handlers, timers, promises) — render errors go through app/error.tsx. */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportError(e.error ?? e.message, "unhandled");
    const onRejection = (e: PromiseRejectionEvent) => reportError(e.reason, "rejection");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
