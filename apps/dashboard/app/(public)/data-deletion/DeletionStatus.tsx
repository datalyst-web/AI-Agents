"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { API_BASE } from "@/lib/api";

type Status =
  | { state: "loading" }
  | { state: "done"; heldData: boolean; completedAt: string | null }
  | { state: "pending" }
  | { state: "unknown" }
  | { state: "error" };

/**
 * Shown only when someone arrives with a confirmation code from Meta's
 * data-deletion flow. No auth: the code is the only thing proving the
 * request was theirs, and the answer it gives away is deliberately
 * nothing more than "that erasure ran" — never who, or which business.
 */
export function DeletionStatus() {
  const code = useSearchParams().get("code");
  const [status, setStatus] = useState<Status>({ state: "loading" });

  useEffect(() => {
    if (!code) return;
    let active = true;
    fetch(`${API_BASE}/v1/channels/meta/data-deletion/${encodeURIComponent(code)}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          status?: string;
          heldData?: boolean;
          completedAt?: string | null;
        };
        if (!active) return;
        if (res.status === 404 || body.status === "unknown") setStatus({ state: "unknown" });
        else if (body.status === "completed")
          setStatus({ state: "done", heldData: body.heldData !== false, completedAt: body.completedAt ?? null });
        else setStatus({ state: "pending" });
      })
      .catch(() => {
        if (active) setStatus({ state: "error" });
      });
    return () => {
      active = false;
    };
  }, [code]);

  if (!code) return null;

  // Written out in full rather than interpolated — Tailwind only keeps
  // class names it can see literally in the source.
  const tone =
    status.state === "done"
      ? "bg-success/10 text-success ring-success/25"
      : status.state === "unknown" || status.state === "error"
        ? "bg-warning/10 text-warning ring-warning/25"
        : "bg-info/10 text-info ring-info/25";

  return (
    <div className={`mt-8 rounded-xl2 px-5 py-4 text-sm ring-1 ring-inset ${tone}`}>
      {status.state === "loading" ? <p>Checking your request…</p> : null}
      {status.state === "done" ? (
        <>
          <p className="font-semibold">
            {status.heldData ? "Your data has been deleted." : "There was nothing to delete."}
          </p>
          <p className="mt-1 opacity-85">
            {status.heldData
              ? "Your conversations and everything the assistant remembered about you have been removed."
              : "We hold no conversations or remembered details for this account."}
            {status.completedAt ? ` Completed ${new Date(status.completedAt).toLocaleString()}.` : ""}
          </p>
        </>
      ) : null}
      {status.state === "pending" ? (
        <p>
          <span className="font-semibold">Your request is in progress.</span> Check back shortly, or email us with the
          code below.
        </p>
      ) : null}
      {status.state === "unknown" ? (
        <p>
          <span className="font-semibold">We don&apos;t recognise this code.</span> Check it was copied in full, or
          email munyaradzi@datalystafrica.com and we&apos;ll look into it for you.
        </p>
      ) : null}
      {status.state === "error" ? (
        <p>
          <span className="font-semibold">We couldn&apos;t check the status just now.</span> Please refresh, or email
          munyaradzi@datalystafrica.com with the code below.
        </p>
      ) : null}
      <p className="mt-2 font-mono text-xs opacity-70">Confirmation code: {code}</p>
    </div>
  );
}
