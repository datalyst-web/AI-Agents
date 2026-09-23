import type { Metadata } from "next";
import { Suspense } from "react";
import { LegalTitle, Clause, Bullets } from "../_components";
import { DeletionStatus } from "./DeletionStatus";

export const metadata: Metadata = {
  title: "Data deletion — Datalyst Africa",
  description:
    "How to have the data held about you deleted from a Datalyst Africa assistant, and how to check the status of a deletion request.",
};

/**
 * The public page Meta's data-deletion callback redirects a person to
 * (apps/api/src/routes/channels.routes.ts). Meta requires both a working
 * callback and publicly reachable instructions before it will review an
 * app with messaging permissions — but the instructions here apply to
 * every channel, not just Facebook and Instagram.
 */
export default function DataDeletionPage() {
  return (
    <article>
      <LegalTitle title="Deleting your data" updated="23 September 2026" />

      <Suspense fallback={null}>
        <DeletionStatus />
      </Suspense>

      <Clause heading="1. What we hold about you">
        <p>
          If you have chatted with an assistant built by Datalyst Africa — on a business&apos;s website, or through
          Facebook Messenger, Instagram, WhatsApp or Telegram — the business you were talking to holds a record of
          that conversation, and we hold it on their behalf. Depending on the conversation, that can include:
        </p>
        <Bullets
          items={[
            "The messages you and the assistant exchanged.",
            "Anything you told the assistant that it was asked to remember for next time, such as a preference or a previous issue.",
            "A one-way scrambled form of the account you messaged from, so the assistant can recognise you on your next visit. We never store your Facebook, Instagram or WhatsApp identifier in a readable form.",
            "Any enquiry, booking or order the assistant created for you at your request.",
          ]}
        />
      </Clause>

      <Clause heading="2. Asking us to delete it">
        <p>You have three ways to do this, and all of them are free:</p>
        <Bullets
          items={[
            "Tell the assistant. Say “forget me” or “delete my data” in the chat and it will raise the request for you.",
            "Remove the app from your Facebook or Instagram settings. Meta notifies us automatically and we delete your data straight away — that is what brought you to this page if you arrived with a confirmation code above.",
            "Email munyaradzi@datalystafrica.com from the address you used, or tell us the business and channel you messaged on. We respond within 30 days, and normally much sooner.",
          ]}
        />
      </Clause>

      <Clause heading="3. What deletion actually removes">
        <p>
          We delete your conversations with that business&apos;s assistant, everything it had remembered about you, and
          the stored means of messaging you back. What remains is a record that a deletion happened and when — with
          no identifying information in it — because we have to be able to show the request was honoured.
        </p>
        <p>
          Two things we cannot delete for you. If the business independently holds your details in their own CRM,
          calendar or email — because you booked or ordered something — that copy is theirs and you should ask them
          directly; we will tell you who to contact. And where a business is legally required to keep a record of a
          transaction, that record stays for as long as the law requires.
        </p>
      </Clause>

      <Clause heading="4. Checking on a request">
        <p>
          A deletion started from your Facebook or Instagram settings gives you a confirmation code. Open this page
          with that code — <code className="rounded bg-surface-raised px-1.5 py-0.5 text-[0.85em]">?code=YOUR-CODE</code>{" "}
          at the end of the address — and the status appears at the top of the page. For any other request, reply to
          the email you received from us and we will confirm where it stands.
        </p>
      </Clause>
    </article>
  );
}
