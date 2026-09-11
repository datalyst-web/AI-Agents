import type { Metadata } from "next";
import Link from "next/link";
import { Clause, Bullets } from "../_components";

export const metadata: Metadata = {
  title: "How it works — Datalyst Africa",
  description: "What happens from the day you sign up to the day your AI agent goes live — and what we need from you along the way.",
};

/**
 * The client-facing walkthrough, written for the fully-managed model: our
 * team configures everything, the client reviews, approves and monitors.
 * It is NOT a DIY setup checklist — describing self-configuration here
 * would contradict both how the product is sold and what CLIENT_NAV in the
 * dashboard actually exposes.
 *
 * Public on purpose: a prospect deciding whether to buy should be able to
 * see exactly how little work is involved on their side.
 */
export default function GuidePage() {
  return (
    <article>
      <div className="border-b border-surface-border pb-8">
        <h1 className="text-3xl font-semibold tracking-tightest text-foreground">How it works</h1>
        <p className="mt-3 text-sm leading-relaxed text-foreground/55">
          From signing up to your agent answering real customers. Our team does the building — your part is sending us what you
          already have, then reviewing and approving what we produce.
        </p>
      </div>

      <Clause heading="Your 14-day free trial">
        <p>
          Signing up starts a 14-day trial. There&apos;s no card required, and the trial is when we build your first agent — so
          you&apos;re evaluating a real assistant trained on your actual business, not a generic demo.
        </p>
        <p>
          Your dashboard shows how many days remain, and we email you before it ends. If the trial finishes without a plan, your
          agent pauses — nothing is deleted, and everything picks up exactly where it left off when you subscribe.
        </p>
      </Clause>

      <Clause heading="Step 1 — You send us your material">
        <p>This is the only real work on your side. Send whatever already exists:</p>
        <Bullets
          items={[
            "Documents — price lists, service descriptions, policies, warranty terms, FAQs. PDF, Word, plain text or spreadsheets are all fine.",
            "Your website address, so we can read and index the relevant pages.",
            "The questions your customers actually ask, especially the ones that aren't written down anywhere yet.",
            "What you want the agent to do beyond answering — book appointments, qualify leads, raise tickets, look up orders.",
          ]}
        />
        <p>
          It does not need to be tidy or complete. Structuring it is our job, and we&apos;ll come back to you with specific
          questions where something is missing.
        </p>
      </Clause>

      <Clause heading="Step 2 — We build and configure it">
        <p>Our setup team works inside your account and does all of the following for you:</p>
        <Bullets
          items={[
            "Builds your knowledge base from what you sent, so the agent answers from your business rather than from general internet knowledge.",
            "Writes the agent's instructions — its tone, its limits, what it should do when it doesn't know something, and when it should bring in a human.",
            "Connects your tools: calendar for real availability, CRM for qualified leads, helpdesk for tickets, and any API you already have.",
            "Sets the safety rules, so anything that costs money or changes a sensitive record is confirmed with the customer or held for your approval.",
          ]}
        />
        <p>
          Every action we take on your behalf is written to your audit log with who did it, when, and what content it was based on.
          You can read that log at any time — nothing we do in your account is hidden from you.
        </p>
      </Clause>

      <Clause heading="Step 3 — You test it">
        <p>
          When it&apos;s ready, the agent moves into a testing stage and we hand it to you. Talk to it the way your customers would,
          and push on the awkward cases: a question your documents don&apos;t cover, a price we weren&apos;t sent, an annoyed
          customer, someone demanding a human.
        </p>
        <p>Tell us what&apos;s wrong and we adjust it. This loop repeats as many times as it needs to.</p>
      </Clause>

      <Clause heading="Step 4 — You approve, and it goes live">
        <p>
          The agent cannot go live until you explicitly approve it. That is a hard rule, not a courtesy — we build and test, you sign
          off. Until you do, it never speaks to one of your customers.
        </p>
        <p>Once approved, we put it where your customers are:</p>
        <Bullets
          items={[
            "Your website — one line of code, which we'll give you (or hand to whoever manages your site). Works with WordPress, Shopify, Wix, Squarespace, Webflow, or a custom build.",
            "A shareable link, if you'd rather use it in an email signature, a social bio or a QR code with no site changes at all.",
            "WhatsApp, Telegram, Facebook Messenger and Instagram — the same agent, same knowledge, answering everywhere.",
          ]}
        />
      </Clause>

      <Clause heading="Step 5 — You watch it, we keep improving it">
        <p>Your dashboard is where you see what the agent is actually doing:</p>
        <Bullets
          items={[
            "Live Inbox — conversations happening right now. You can take one over and reply as a human at any point, then hand it back to the agent.",
            "Leads — every qualified lead with its score and outcome.",
            "Analytics — resolution and escalation rates, where customers drop off, sentiment trends and satisfaction scores.",
            "Approvals — anything the agent is holding for a human decision.",
            "Audit Log — every change made in your account, by us or by your team.",
          ]}
        />
        <p>
          You don&apos;t have to act on any of it. We review the same reports and update your knowledge base as your prices,
          policies and services change — that upkeep is part of the service, not something we hand back to you.
        </p>
      </Clause>

      <Clause heading="What if something's wrong?">
        <p>
          Raise it from the Support section of your dashboard and it goes straight to our team with your account context attached.
          If the agent said something it shouldn&apos;t have, tell us — we&apos;ll fix the underlying knowledge or instruction, not
          just the one answer.
        </p>
      </Clause>

      <div className="mt-12 rounded-xl3 bg-brand-gradient-soft p-8 text-center ring-1 ring-inset ring-brand-500/25">
        <h2 className="text-xl font-semibold text-foreground">Ready to start?</h2>
        <p className="mx-auto mt-2.5 max-w-lg text-sm leading-relaxed text-foreground/60">
          Sign up, send us what you have, and we&apos;ll build your agent during the 14-day trial.
        </p>
        <Link
          href="/signup"
          className="mt-6 inline-block rounded-xl bg-brand-gradient px-6 py-2.5 text-sm font-semibold text-white shadow-glow transition-shadow hover:shadow-glow-lg"
        >
          Start your free trial
        </Link>
      </div>
    </article>
  );
}
