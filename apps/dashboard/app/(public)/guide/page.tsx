import type { Metadata } from "next";
import Link from "next/link";
import { Clause, Bullets } from "../_components";

export const metadata: Metadata = {
  title: "Getting started — Datalyst AI",
  description: "How to get your AI agent live: build its knowledge, test it, embed it on your site, and connect your messaging channels.",
};

/**
 * The client-facing quickstart. Public on purpose — a prospect deciding
 * whether to buy should be able to see exactly how much work is involved,
 * and an existing client shouldn't need to be signed in to follow it.
 *
 * Deliberately does NOT reproduce the embed snippet with a fake agent id:
 * the real one (with the client's actual agent id and API base) is
 * generated on the agent's own page, and a copy-pasteable placeholder here
 * would be the single most likely thing for someone to paste by mistake.
 */
export default function GuidePage() {
  return (
    <article>
      <div className="border-b border-surface-border pb-8">
        <h1 className="text-3xl font-semibold tracking-tightest text-foreground">Getting started</h1>
        <p className="mt-3 text-sm leading-relaxed text-foreground/55">
          What it takes to get your agent answering real customers. If you bought managed setup, our team does steps 1 to 3 for you
          and you pick up at step 4 — reviewing and approving.
        </p>
      </div>

      <Clause heading="1. Add what your agent needs to know">
        <p>
          Your agent answers from your knowledge base, not from general internet knowledge. This is the step that determines whether
          it&apos;s useful, so it&apos;s worth doing properly.
        </p>
        <Bullets
          items={[
            "Upload documents — PDF, Word, plain text or CSV. Price lists, service descriptions, policies, warranty terms, FAQs.",
            "Point it at your website. Give it specific pages or a sitemap and it will read and index them.",
            "Add FAQs directly for the questions customers actually ask that aren't written down anywhere yet.",
          ]}
        />
        <p>
          Anything you change here takes effect without a redeploy. If your prices change, update the source and the agent is
          answering correctly within minutes.
        </p>
      </Clause>

      <Clause heading="2. Tell it how to behave">
        <p>
          In the agent&apos;s configuration you set its name, its tone, what it should do when it doesn&apos;t know something, and
          when it should bring in a human. Be specific about your business rules — &quot;never quote for orders over 50 units, take
          their details and escalate&quot; is the kind of instruction that makes the difference.
        </p>
      </Clause>

      <Clause heading="3. Connect the tools it should be able to use">
        <p>Only connect what you want it to actually do. Each tool you connect is a capability you&apos;re granting:</p>
        <Bullets
          items={[
            "Calendar — so it can check real availability and book appointments.",
            "CRM — so a qualified lead lands in your pipeline with its score and notes.",
            "Ticketing — so a support request becomes a ticket in your helpdesk.",
            "Your own APIs and webhooks — order lookups, stock checks, anything you already have an endpoint for.",
          ]}
        />
        <p>
          Actions that cost money or change something sensitive are held back for confirmation from the customer, or approval from
          your team, rather than being executed automatically.
        </p>
      </Clause>

      <Clause heading="4. Test it, then approve it">
        <p>
          Before it can go live, the agent moves into a testing stage where you talk to it yourself. Try the awkward cases: a
          question your documents don&apos;t answer, a price you didn&apos;t upload, an angry customer, a request to speak to a
          person.
        </p>
        <p>
          It cannot go live until you explicitly approve it. That applies even when our own team configured it — we build and test,
          you sign off.
        </p>
      </Clause>

      <Clause heading="5. Put it on your website">
        <p>
          Open your agent&apos;s page in the dashboard and copy the embed snippet shown there. It already contains your agent&apos;s
          id — paste it once before the closing <code className="rounded bg-foreground/10 px-1.5 py-0.5 font-mono text-xs">&lt;/body&gt;</code>{" "}
          tag of your site and the chat bubble appears.
        </p>
        <p>
          It works on anything that lets you add a script tag: WordPress, Shopify, Wix, Squarespace, Webflow, or a site your
          developer built. If you use WordPress, the dashboard&apos;s integrations page can connect it for you.
        </p>
        <p>
          You also get a shareable link to the agent, which is useful in an email signature, a social bio, or a QR code, with no site
          changes at all.
        </p>
      </Clause>

      <Clause heading="6. Connect your messaging channels">
        <p>
          The same agent — same knowledge, same rules — can answer on WhatsApp, Telegram, Facebook Messenger and Instagram. Each is
          connected from the agent&apos;s channels section, and each needs an account you control on that platform.
        </p>
        <p>
          Conversations from every channel land in one place, so your team isn&apos;t watching four inboxes.
        </p>
      </Clause>

      <Clause heading="7. Watch it, then improve it">
        <p>Once it&apos;s live, the dashboard tells you where it&apos;s working and where it isn&apos;t:</p>
        <Bullets
          items={[
            "The live inbox shows conversations happening now. You can take one over and reply as a human at any point, then hand it back.",
            "Analytics show resolution and escalation rates, where customers drop off, sentiment trends, and satisfaction scores.",
            "The 'couldn't answer' report lists the questions it failed on — the fastest list of what to add to your knowledge base next.",
            "Leads shows every qualified lead with its score and business outcome.",
          ]}
        />
        <p>
          Fully managed clients get this handled for them — we review these reports and update the knowledge base as part of the
          service.
        </p>
      </Clause>

      <div className="mt-12 rounded-xl3 bg-brand-gradient-soft p-8 text-center ring-1 ring-inset ring-brand-500/25">
        <h2 className="text-xl font-semibold text-foreground">Need us to do it for you?</h2>
        <p className="mx-auto mt-2.5 max-w-lg text-sm leading-relaxed text-foreground/60">
          Send us your documents and website and our team builds the knowledge base, writes the instructions, and wires up the tools —
          then hands it to you to review.
        </p>
        <Link
          href="/signup"
          className="mt-6 inline-block rounded-xl bg-brand-gradient px-6 py-2.5 text-sm font-semibold text-white shadow-glow transition-shadow hover:shadow-glow-lg"
        >
          Get started
        </Link>
      </div>
    </article>
  );
}
