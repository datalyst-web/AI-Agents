import { randomUUID } from "node:crypto";
import { withPlatformContext, withTenant } from "@chat-agent/db";
import { renderPremiumEmail, type EmailSection } from "@chat-agent/email";
import type { WorkerContext } from "../context.js";
import { env } from "../env.js";

/**
 * Hands a trial client the assistant drafted from their questionnaire
 * (apps/api/src/lib/intakeAutoBuild.ts): once its release time has passed
 * — 30 minutes after they submitted — the agent moves CONFIGURING →
 * TESTING and the client is emailed that our team has it ready to try.
 *
 * Fires once per tenant: `autoBuild.releasedAt` on Tenant.onboardingIntake
 * is the marker. Skips the email (but still marks it done) when staff
 * already pressed Start Testing — that route sends its own "ready" email —
 * or deleted the draft, or the account was suspended/cancelled meanwhile.
 *
 * Knowledge still ingesting at release time holds the release back so the
 * client's first test isn't answered from an empty knowledge base, for at
 * most KNOWLEDGE_GRACE_MS; after that it's released regardless and staff
 * are told which sources failed.
 */
const KNOWLEDGE_GRACE_MS = 2 * 60 * 60 * 1000;
/** Older submissions are never picked up again (and keep the query small). */
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
const PRE_TESTING = ["DRAFT", "CONFIGURING", "KNOWLEDGE_PROCESSING"] as const;
const IN_PROGRESS = ["PENDING", "EXTRACTING", "CHUNKING", "EMBEDDING"];

interface AutoBuild {
  agentId: string;
  builtAt: string;
  releaseAt: string;
  releasedAt?: string;
}
interface IntakeShape {
  answers: {
    businessName: string;
    contactName?: string;
    goals?: string[];
    channels?: string[];
    businessHours?: string;
    location?: string;
    productsAndPrices?: string;
    policies?: string;
    faqs?: { question: string; answer: string }[];
    handoffWhen?: string;
    tone?: string;
    languages?: string;
  };
  files?: unknown[];
  autoBuild?: AutoBuild;
}

export async function runIntakeAgentReleaseSweep(ctx: WorkerContext, now = new Date()): Promise<void> {
  const candidates = await withPlatformContext(ctx.prisma, (tx) =>
    tx.tenant.findMany({
      where: { onboardingIntakeAt: { gte: new Date(now.getTime() - LOOKBACK_MS) } },
      select: { id: true, name: true, subscriptionState: true, onboardingIntake: true },
    }),
  );

  for (const tenant of candidates) {
    const intake = tenant.onboardingIntake as unknown as IntakeShape | null;
    const build = intake?.autoBuild;
    if (!intake || !build || build.releasedAt || new Date(build.releaseAt) > now) continue;
    try {
      await releaseOne(ctx, tenant, intake, build, now);
    } catch (err) {
      // One tenant's failure must not hold up everyone else's release.
      console.error(`[workers] intake release failed for tenant ${tenant.id}`, err);
    }
  }
}

async function releaseOne(
  ctx: WorkerContext,
  tenant: { id: string; name: string; subscriptionState: string },
  intake: IntakeShape,
  build: AutoBuild,
  now: Date,
): Promise<void> {
  const tenantCtx = { tenantId: tenant.id };
  const sources = await withTenant(ctx.prisma, tenantCtx, (tx) =>
    tx.knowledgeSource.findMany({
      where: { tenantId: tenant.id, agentId: build.agentId },
      select: { type: true, status: true, originalFilename: true, sourceUrl: true, errorMessage: true, _count: { select: { documents: true } } },
    }),
  );
  const stillIngesting = sources.some((s) => IN_PROGRESS.includes(s.status));
  if (stillIngesting && now.getTime() - new Date(build.releaseAt).getTime() < KNOWLEDGE_GRACE_MS) return;

  const lapsed = tenant.subscriptionState === "SUSPENDED" || tenant.subscriptionState === "CANCELLED";
  const outcome = await withTenant(ctx.prisma, tenantCtx, async (tx) => {
    const agent = await tx.agent.findFirst({ where: { id: build.agentId, tenantId: tenant.id }, select: { id: true, name: true, status: true, personality: true } });
    let moved = false;
    if (agent && !lapsed) {
      // Conditional update: if staff pressed Start Testing a moment ago,
      // this changes nothing and the client isn't emailed twice.
      const res = await tx.agent.updateMany({
        where: { id: agent.id, tenantId: tenant.id, status: { in: [...PRE_TESTING] } },
        data: { status: "TESTING" },
      });
      moved = res.count === 1;
      if (moved) {
        await tx.auditLogEntry.create({
          data: {
            id: randomUUID(),
            tenantId: tenant.id,
            agentId: agent.id,
            actorUserId: SYSTEM_ACTOR_ID,
            actorIsStaff: false,
            action: "agent_moved_to_testing",
            contentSource: "released for client testing after onboarding setup",
            metadata: { automated: true },
          },
        });
      }
    }
    const fresh = await tx.tenant.findUniqueOrThrow({ where: { id: tenant.id }, select: { onboardingIntake: true } });
    const current = fresh.onboardingIntake as unknown as IntakeShape;
    await tx.tenant.update({
      where: { id: tenant.id },
      data: { onboardingIntake: { ...current, autoBuild: { ...current.autoBuild!, releasedAt: now.toISOString() } } as object },
    });
    return { agent, moved };
  });
  if (!outcome.moved || !outcome.agent) return;

  const [owners, platform] = await Promise.all([
    withTenant(ctx.prisma, tenantCtx, (tx) =>
      tx.user.findMany({
        where: { tenantId: tenant.id, isActive: true, role: { in: ["tenant_owner", "tenant_admin"] } },
        select: { email: true, displayName: true },
      }),
    ),
    withPlatformContext(ctx.prisma, (tx) => tx.platformSettings.findUnique({ where: { id: "global" }, select: { brandName: true } })),
  ]);
  const brand = platform?.brandName ?? "Datalyst Africa";
  const personality = outcome.agent.personality as { greeting?: string; tone?: string; languagesSupported?: string[] };
  const ready = sources.filter((s) => s.status === "READY");
  for (const owner of owners) {
    const email = agentReadyEmail({
      brand,
      firstName: firstNameOf(owner.displayName) ?? firstNameOf(intake.answers.contactName),
      agentName: outcome.agent.name,
      greeting: personality.greeting ?? "",
      answers: intake.answers,
      readyWebsitePages: ready.filter((s) => s.type === "WEBSITE_CRAWL").reduce((n, s) => n + s._count.documents, 0),
      readyDocuments: ready.filter((s) => ["PDF", "DOCX", "TXT", "CSV"].includes(s.type)).map((s) => s.originalFilename ?? "document"),
      dashboardUrl: env.DASHBOARD_BASE_URL,
      agentId: outcome.agent.id,
    });
    const result = await ctx.email.send({ to: owner.email, subject: email.subject, text: email.text, html: renderPremiumEmail(email.html) });
    if (!result.sent) console.error(`[workers] could not send agent-ready email for tenant ${tenant.id}: ${result.error}`);
  }

  // Staff hear about anything the client's knowledge base is missing.
  const failed = sources.filter((s) => s.status === "FAILED" || IN_PROGRESS.includes(s.status));
  if (failed.length) {
    const staff = await withPlatformContext(ctx.prisma, (tx) =>
      tx.user.findMany({ where: { isActive: true, role: { in: ["platform_admin", "setup_specialist"] } }, select: { email: true } }),
    );
    const lines = failed.map((s) => `- ${s.originalFilename ?? s.sourceUrl ?? s.type}: ${s.status === "FAILED" ? (s.errorMessage ?? "failed") : "still processing"}`);
    await Promise.all(
      staff.map((s) =>
        ctx.email.send({
          to: s.email,
          subject: `${tenant.name}: assistant released, but ${failed.length} knowledge ${failed.length === 1 ? "source needs" : "sources need"} attention`,
          text:
            `${outcome.agent!.name} for ${tenant.name} has moved to Testing and the client has been told it's ready.\n\n` +
            `These knowledge sources didn't load, so the assistant can't answer from them yet:\n${lines.join("\n")}\n\n` +
            `Fix them from Managed Setup before the client tests too much: ${env.DASHBOARD_BASE_URL}/managed-setup`,
        }),
      ),
    );
  }
}

function firstNameOf(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first && first.length <= 40 ? first : null;
}

const GOAL_COPY: Record<string, string> = {
  answer_questions: "Answers your customers' questions instantly, day or night — from what you told us, never guesswork.",
  capture_leads: "Spots interested customers and takes their name and number, so your team can follow up while they're keen.",
  book_appointments: "Takes booking requests — date, time and contact details — and tells customers your team will confirm.",
  take_orders: "Takes order requests with exactly what the customer wants, ready for your team to confirm.",
  customer_support: "Helps existing customers sort out problems, and hands over to your team when a person is needed.",
};
const CHANNEL_NAMES: Record<string, string> = { website: "your website", whatsapp: "WhatsApp", facebook: "Facebook Messenger", instagram: "Instagram", telegram: "Telegram" };

function joinNatural(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Questions worth trying first: their own FAQs, then the things customers ask most. */
function suggestedQuestions(a: IntakeShape["answers"]): string[] {
  const picks = (a.faqs ?? []).slice(0, 2).map((f) => f.question);
  if (a.productsAndPrices) picks.push("How much does it cost?");
  if (a.businessHours) picks.push("Are you open on Saturday?");
  if (a.location) picks.push("Where are you based?");
  if (a.policies) picks.push("What's your refund policy?");
  picks.push("Can I speak to a person?");
  return [...new Set(picks)].slice(0, 4);
}

export function agentReadyEmail(input: {
  brand: string;
  firstName: string | null;
  agentName: string;
  greeting: string;
  answers: IntakeShape["answers"];
  readyWebsitePages: number;
  readyDocuments: string[];
  dashboardUrl: string;
  agentId: string;
}): { subject: string; text: string; html: Parameters<typeof renderPremiumEmail>[0] } {
  const a = input.answers;
  const biz = a.businessName;
  const hello = input.firstName ? `Hi ${input.firstName},` : "Hi there,";
  const knows: string[] = ["What " + biz + " does, in your words"];
  if (a.productsAndPrices) knows.push("Your products, services and prices");
  if (a.businessHours) knows.push("Your opening hours");
  if (a.location) knows.push("Where you are and the areas you serve");
  if (a.policies) knows.push("Your policies");
  if (a.faqs?.length) knows.push(`${a.faqs.length} of your frequently asked questions, answered your way`);
  if (input.readyWebsitePages) knows.push(`${input.readyWebsitePages} ${input.readyWebsitePages === 1 ? "page" : "pages"} from your website`);
  for (const d of input.readyDocuments) knows.push(`Your document: ${d}`);
  const does = (a.goals ?? []).map((g) => GOAL_COPY[g]).filter((x): x is string => Boolean(x));
  const channels = (a.channels ?? []).map((c) => CHANNEL_NAMES[c] ?? c);
  const questions = suggestedQuestions(a);
  const agentUrl = `${input.dashboardUrl}/agents/${input.agentId}`;

  const subject = `${input.agentName} is ready — your AI assistant for ${biz} is set up`;
  const intro =
    `${hello}\n\nOur team has finished setting up ${input.agentName}, the AI assistant for ${biz}. ` +
    `We built it from everything you shared with us, and it's ready for you to try before any customer sees it.`;
  const steps = [
    { title: "Open your assistant", detail: "Sign in and go to Agents, then the Test Agent tab." },
    { title: "Ask it what your customers ask", detail: `Try: ${questions.map((q) => `“${q}”`).join(" · ")}` },
    {
      title: "Approve it for launch",
      detail: `Happy with it? Click Approve for launch.${channels.length ? ` We'll then put it live on ${joinNatural(channels)} for you.` : ""} Want something changed? Just reply to this email.`,
    },
  ];
  const sections: EmailSection[] = [
    { title: `What ${input.agentName} already knows`, blocks: [{ kind: "list", tone: "success", items: knows }] },
    ...(does.length ? [{ title: "What it will do for you", blocks: [{ kind: "list" as const, items: does }] }] : []),
    {
      title: "How it greets your customers",
      blocks: [
        ...(input.greeting ? [{ kind: "quote" as const, text: input.greeting }] : []),
        {
          kind: "text" as const,
          muted: true,
          text: "When it isn't sure of something, it says so and offers your team instead of guessing — so it never makes up a price, a time or a promise.",
        },
      ],
    },
    { title: "Try it in three steps", blocks: [{ kind: "steps", items: steps }] },
    {
      blocks: [
        {
          kind: "callout",
          tone: "brand",
          text: "Your 14-day free trial hasn't started yet. It starts the day your assistant goes live, so you get the full 14 days with real customers.",
        },
      ],
    },
  ];

  const text = [
    intro,
    "",
    `WHAT ${input.agentName.toUpperCase()} ALREADY KNOWS`,
    ...knows.map((k) => `- ${k}`),
    ...(does.length ? ["", "WHAT IT WILL DO FOR YOU", ...does.map((d) => `- ${d}`)] : []),
    ...(input.greeting ? ["", "HOW IT GREETS YOUR CUSTOMERS", `"${input.greeting}"`] : []),
    "",
    "TRY IT IN THREE STEPS",
    ...steps.map((s, i) => `${i + 1}. ${s.title} — ${s.detail}`),
    "",
    "Your 14-day free trial starts the day your assistant goes live, so you get the full 14 days with real customers.",
    "",
    `Open ${input.agentName}: ${agentUrl}`,
    "",
    `— The ${input.brand} setup team`,
  ].join("\n");

  return {
    subject,
    text,
    html: {
      preheader: `${input.agentName} knows your business and is ready for you to test. It only goes live once you approve.`,
      brand: input.brand,
      eyebrow: "Your AI assistant is ready",
      headline: `Meet ${input.agentName}`,
      intro,
      sections,
      cta: { label: `Try ${input.agentName} now`, url: agentUrl },
      signoff: `Any questions or changes, just reply — a real person on our team reads every email.\n\n— The ${input.brand} setup team`,
      footer: `You're receiving this because you set up ${biz} with ${input.brand}. Nothing goes live to your customers until you approve it.`,
    },
  };
}
