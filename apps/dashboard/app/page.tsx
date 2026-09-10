import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { PublicThemeToggle } from "@/components/PublicThemeToggle";

/**
 * The public marketing page — the only route a prospect sees before
 * signing up, so it's deliberately a static server component (no
 * "use client", no auth call) for fast first paint and real SEO.
 *
 * Two rules this page has to keep:
 *  - Never name the AI provider or model behind the product (CLAUDE.md
 *    principle 6, white-label safety). "Multiple frontier models with
 *    automatic failover" is the honest, provider-agnostic framing.
 *  - Never claim a customer, logo, testimonial, or metric we don't have.
 *    Everything described here is a capability that actually ships today;
 *    the same anti-hallucination standard the agent itself is held to.
 */
const BRAND = "Datalyst AI";

export const metadata: Metadata = {
  title: `${BRAND} — AI digital employees for your business`,
  description:
    "An AI assistant that answers customer questions from your own documents, qualifies leads, books appointments, and hands off to your team with full context. Our team builds and configures it for you.",
};

const CAPABILITIES: { title: string; body: string }[] = [
  {
    title: "Answers from your business, not the internet",
    body: "Send us your documents and your website and we turn them into its knowledge base. Prices, policies, hours and product details come from there — and we keep it updated as your business changes.",
  },
  {
    title: "Qualifies and scores leads",
    body: "It asks the questions your sales process needs, scores the lead, and pushes hot ones straight into your CRM while notifying the right person.",
  },
  {
    title: "Books appointments",
    body: "Checks real availability through your calendar and confirms the booking back to the customer — never a slot it hasn't verified.",
  },
  {
    title: "Takes action in your tools",
    body: "Create tickets, look up orders, check inventory, call your own APIs and webhooks. Risky actions ask for confirmation first; the highest-risk ones wait for a human.",
  },
  {
    title: "Hands off to a human properly",
    body: "When it escalates, your team gets the customer, the request, the problem, what was collected and what was tried — not a cold transcript to read through.",
  },
  {
    title: "Shows you what's working",
    body: "Resolution and escalation rates, where conversations drop off, sentiment trends, customer satisfaction scores, and what it couldn't answer — so gaps get fixed.",
  },
];

const CHANNELS = ["Your website", "WhatsApp", "Telegram", "Facebook Messenger", "Instagram", "A shareable link"];

const TRUST: { title: string; body: string }[] = [
  {
    title: "It says \"I don't know\"",
    body: "The agent is built to refuse rather than invent a price, a policy, or an availability it can't verify from your knowledge base. That's a design constraint, not a setting.",
  },
  {
    title: "Nothing risky happens silently",
    body: "Anything that spends money, cancels, or changes a sensitive record is confirmed with the customer or held for a human to approve.",
  },
  {
    title: "Your data is yours alone",
    body: "Every record is isolated per business at the database level, not just in application code. No agent can reach another business's knowledge or conversations.",
  },
  {
    title: "Everything is on the record",
    body: "Every change — including anything our setup team does on your behalf — is logged with who did it, when, and what it was based on. You set how long conversation data is kept.",
  },
];

const PLANS: {
  tier: string;
  price: string;
  cadence: string;
  blurb: string;
  included: string[];
  cta: string;
  href: string;
  featured?: boolean;
}[] = [
  {
    tier: "Starter",
    price: "$49",
    cadence: "/month",
    blurb: "One agent on your website, for a business testing the water.",
    included: ["500 conversations/month", "500,000 AI tokens/month", "Website widget + shareable link", "Knowledge base from your docs & site", "Email escalation alerts"],
    cta: "Start 14-day free trial",
    href: "/signup",
  },
  {
    tier: "Growth",
    price: "$149",
    cadence: "/month",
    blurb: "For businesses running real volume across more than one channel.",
    included: [
      "2,500 conversations/month",
      "2,000,000 AI tokens/month",
      "WhatsApp, Telegram, Messenger, Instagram",
      "CRM, calendar and webhook actions",
      "Lead scoring + analytics",
      "SMS and push alerts",
    ],
    cta: "Start 14-day free trial",
    href: "/signup",
    featured: true,
  },
  {
    tier: "Scale",
    price: "$399",
    cadence: "/month",
    blurb: "Multiple agents, multiple departments, higher volume.",
    included: [
      "10,000 conversations/month",
      "6,000,000 AI tokens/month",
      "Multiple agents with shared customer context",
      "Custom tools and API integrations",
      "Workflow automation",
      "Live inbox with human takeover",
    ],
    cta: "Start 14-day free trial",
    href: "/signup",
  },
  {
    tier: "Enterprise",
    price: "Custom",
    cadence: "",
    blurb: "Negotiated volume, custom domain, and a managed service agreement.",
    included: ["Volume pricing, no hard cap", "Your own domain for the agent", "Fully managed knowledge upkeep", "Priority support", "Custom integrations built for you"],
    cta: "Talk to us",
    href: "/signup",
  },
];

const STEPS: { step: string; title: string; body: string }[] = [
  {
    step: "01",
    title: "Tell us about your business",
    body: "Send us your documents, your website, your price list — whatever you already have. That is genuinely the whole ask on your side.",
  },
  {
    step: "02",
    title: "We build and test your agent",
    body: "Our team structures your knowledge base, writes the agent's instructions, and wires up your tools. You review it in a test conversation before anything goes live.",
  },
  {
    step: "03",
    title: "You approve, then it goes live",
    body: "Nothing reaches your customers until you sign off. Paste one line of code on your site, connect your channels, and it starts working.",
  },
];

function Section({ id, children, className = "" }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`mx-auto w-full max-w-6xl px-6 ${className}`}>
      {children}
    </section>
  );
}

function SectionHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-400">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tightest text-foreground sm:text-4xl">{title}</h2>
      {body ? <p className="mt-4 text-base leading-relaxed text-foreground/55">{body}</p> : null}
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-surface text-foreground">
      <header className="sticky top-0 z-20 border-b border-surface-border/60 bg-surface/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-brand-gradient shadow-glow" />
            <span className="text-sm font-semibold tracking-tight text-foreground">{BRAND}</span>
          </div>
          <nav className="hidden items-center gap-8 text-sm text-foreground/60 md:flex">
            <a href="#capabilities" className="transition-colors hover:text-foreground">
              What it does
            </a>
            <a href="#how-it-works" className="transition-colors hover:text-foreground">
              How it works
            </a>
            <a href="#trust" className="transition-colors hover:text-foreground">
              Trust
            </a>
            <a href="#pricing" className="transition-colors hover:text-foreground">
              Pricing
            </a>
            <Link href="/guide" className="transition-colors hover:text-foreground">
              Guide
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <PublicThemeToggle />
            <Link href="/login" className="text-sm font-medium text-foreground/70 transition-colors hover:text-foreground">
              Sign in
            </Link>
            <Link
              href="/signup"
              className="rounded-xl bg-brand-gradient px-4 py-2 text-sm font-semibold text-white shadow-glow transition-shadow hover:shadow-glow-lg"
            >
              Get started
            </Link>
          </div>
        </div>
      </header>

      <div className="bg-mesh-ambient">
        <Section className="pb-20 pt-20 sm:pt-28">
          <div className="mx-auto max-w-3xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-foreground/[0.06] px-3.5 py-1.5 text-xs font-medium text-foreground/70 ring-1 ring-inset ring-surface-border">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              We build it. You approve it. It goes live.
            </div>
            <h1 className="mt-6 text-4xl font-semibold leading-[1.08] tracking-tightest text-foreground sm:text-6xl">
              An AI employee that actually knows your business
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-foreground/60">
              It answers your customers from your own documents and website, qualifies leads, books appointments, and brings a
              real person in when it should — on your site, WhatsApp, Telegram, Messenger and Instagram.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="w-full rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-white shadow-glow transition-shadow hover:shadow-glow-lg sm:w-auto"
              >
                Start your 14-day free trial
              </Link>
              <a
                href="#how-it-works"
                className="w-full rounded-xl bg-foreground/[0.06] px-6 py-3 text-sm font-semibold text-foreground ring-1 ring-inset ring-surface-border transition-colors hover:bg-foreground/[0.1] sm:w-auto"
              >
                See how it works
              </a>
            </div>
            <p className="mt-5 text-xs text-foreground/40">14-day free trial. No card required. We build your agent for you.</p>
          </div>

          <div className="mt-16 flex flex-wrap items-center justify-center gap-2.5">
            {CHANNELS.map((channel) => (
              <span
                key={channel}
                className="rounded-full bg-surface-raised px-4 py-2 text-xs font-medium text-foreground/70 ring-1 ring-inset ring-surface-border"
              >
                {channel}
              </span>
            ))}
          </div>
        </Section>
      </div>

      <Section id="capabilities" className="py-20">
        <SectionHeading
          eyebrow="What it does"
          title="Not a chatbot with a FAQ list"
          body="It understands the question, looks up the answer in your knowledge base, decides whether it needs to do something, does it, and confirms what happened."
        />
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((item) => (
            <div
              key={item.title}
              className="rounded-xl3 bg-surface-raised bg-card-sheen p-6 shadow-card ring-1 ring-inset ring-surface-border transition-shadow hover:shadow-card-hover"
            >
              <h3 className="text-base font-semibold text-foreground">{item.title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-foreground/55">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <div className="border-y border-surface-border/60 bg-surface-raised/40">
        <Section id="how-it-works" className="py-20">
          <SectionHeading
            eyebrow="How it works"
            title="You don't configure anything"
            body="Assembling a knowledge base, writing agent instructions and wiring up integrations is our job, not yours. Our team does all of it inside your account — every action logged and visible to you — and hands it over for you to test and approve."
          />
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {STEPS.map((item) => (
              <div key={item.step} className="relative rounded-xl3 bg-surface p-7 shadow-card ring-1 ring-inset ring-surface-border">
                <span className="font-mono text-xs font-semibold tracking-widest text-brand-400">{item.step}</span>
                <h3 className="mt-4 text-lg font-semibold text-foreground">{item.title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-foreground/55">{item.body}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section id="trust" className="py-20">
        <SectionHeading
          eyebrow="Trust"
          title="The part most AI tools skip"
          body="An assistant that invents a price or confirms a booking that never happened costs you more than having no assistant at all."
        />
        <div className="mt-14 grid gap-5 sm:grid-cols-2">
          {TRUST.map((item) => (
            <div key={item.title} className="rounded-xl3 bg-surface-raised p-6 ring-1 ring-inset ring-surface-border">
              <h3 className="text-base font-semibold text-foreground">{item.title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-foreground/55">{item.body}</p>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-10 max-w-2xl text-center text-sm leading-relaxed text-foreground/45">
          Your agent runs on multiple frontier AI models with automatic failover, so a single provider having a bad day doesn&apos;t
          take your assistant offline. Which model answered is never exposed to your customers.
        </p>
      </Section>

      <div className="border-y border-surface-border/60 bg-surface-raised/40">
        <Section id="pricing" className="py-20">
          <SectionHeading
            eyebrow="Pricing"
            title="Straightforward monthly plans"
            body="Setup and configuration by our team is included in every plan. Each plan comes with a monthly usage allowance; go over it and you're billed a per-token overage rate, with exactly where you stand visible in your dashboard — never a surprise invoice."
          />
          <div className="mt-14 grid gap-5 lg:grid-cols-4">
            {PLANS.map((plan) => (
              <div
                key={plan.tier}
                className={`flex flex-col rounded-xl3 p-7 ring-1 ring-inset ${
                  plan.featured
                    ? "bg-surface shadow-glow-lg ring-brand-500/40"
                    : "bg-surface shadow-card ring-surface-border"
                }`}
              >
                {plan.featured ? (
                  <span className="mb-4 self-start rounded-full bg-brand-gradient px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
                    Most popular
                  </span>
                ) : null}
                <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground/60">{plan.tier}</h3>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-3xl font-semibold tracking-tightest text-foreground">{plan.price}</span>
                  <span className="text-sm text-foreground/45">{plan.cadence}</span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-foreground/55">{plan.blurb}</p>
                <ul className="mt-6 space-y-2.5 border-t border-surface-border pt-6">
                  {plan.included.map((feature) => (
                    <li key={feature} className="flex gap-2.5 text-sm text-foreground/70">
                      <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 flex-none text-brand-400" fill="none" aria-hidden="true">
                        <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link
                  href={plan.href}
                  className={`mt-7 rounded-xl px-4 py-2.5 text-center text-sm font-semibold transition-shadow ${
                    plan.featured
                      ? "bg-brand-gradient text-white shadow-glow hover:shadow-glow-lg"
                      : "bg-foreground/[0.06] text-foreground ring-1 ring-inset ring-surface-border hover:bg-foreground/[0.1]"
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
          <p className="mt-8 text-center text-xs text-foreground/40">
            Every plan starts with a 14-day free trial, and every plan includes our team building and configuring your agent for
            you. Ongoing knowledge-base upkeep is included on Scale and Enterprise, and available as an add-on below that.
          </p>
        </Section>
      </div>

      <Section className="py-24">
        <div className="rounded-xl3 bg-brand-gradient-soft p-12 text-center ring-1 ring-inset ring-brand-500/25">
          <h2 className="text-3xl font-semibold tracking-tightest text-foreground sm:text-4xl">
            Put it in front of your customers this week
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-foreground/60">
            Tell us about your business and we&apos;ll build your first agent during your 14-day free trial. You review it, you
            approve it, and only then does it talk to a customer.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="w-full rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-white shadow-glow transition-shadow hover:shadow-glow-lg sm:w-auto"
            >
              Start 14-day free trial
            </Link>
            <Link
              href="/login"
              className="w-full rounded-xl bg-foreground/[0.06] px-6 py-3 text-sm font-semibold text-foreground ring-1 ring-inset ring-surface-border transition-colors hover:bg-foreground/[0.1] sm:w-auto"
            >
              Sign in
            </Link>
          </div>
        </div>
      </Section>

      <footer className="border-t border-surface-border/60 py-10">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <div className="h-6 w-6 rounded-lg bg-brand-gradient" />
            <span className="text-xs text-foreground/45">
              © {new Date().getFullYear()} {BRAND}
            </span>
          </div>
          <div className="flex items-center gap-6 text-xs text-foreground/45">
            <Link href="/guide" className="transition-colors hover:text-foreground/70">
              Getting started
            </Link>
            <Link href="/terms" className="transition-colors hover:text-foreground/70">
              Terms of Service
            </Link>
            <Link href="/privacy" className="transition-colors hover:text-foreground/70">
              Privacy Policy
            </Link>
            <Link href="/login" className="transition-colors hover:text-foreground/70">
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
