import { randomUUID } from "node:crypto";
import { withTenant } from "@chat-agent/db";
import { QUEUE_NAMES } from "@chat-agent/queue";
import type { AgentPersonality, KnowledgeIngestJob } from "@chat-agent/shared-types";
import type { AppContext } from "./context.js";
import { writeAuditLog } from "./audit.js";
import { env } from "../env.js";
import type { PremiumEmail } from "@chat-agent/email";
import type { IntakeAnswers, IntakeFile } from "../routes/onboarding.routes.js";

/**
 * Drafts a trial client's assistant from their onboarding questionnaire the
 * moment they submit it, so our team starts from a working build instead of
 * a blank page.
 *
 * It goes through the same pipeline staff use (agent row, MANUAL_FAQ / FILE
 * / WEBSITE_CRAWL knowledge sources, the ingestion queue) — never a direct
 * vector-store write (CLAUDE.md principle 8). The agent is left in
 * CONFIGURING: the client's dashboard shows "Your AI Setup Team is
 * configuring this agent", staff are emailed the full build to review and
 * adjust, and workers' intakeAgentReleaseSweep moves it to TESTING and tells
 * the client it's ready AGENT_RELEASE_DELAY_MS after they submitted (or
 * sooner, if staff press Start Testing). It never goes LIVE without the
 * client's own approval.
 *
 * Business facts go to the knowledge base, never into the instructions
 * (principle 3); the instructions hold only how the assistant behaves.
 */

/** How long after the questionnaire the client is told their assistant is ready. */
export const AGENT_RELEASE_DELAY_MS = 30 * 60 * 1000;

/** Stored under Tenant.onboardingIntake.autoBuild; read by intakeAgentReleaseSweep. */
export interface IntakeAutoBuildState {
  agentId: string;
  builtAt: string;
  releaseAt: string;
  releasedAt?: string;
}

export interface IntakeBuildReport {
  agentId: string;
  agentName: string;
  personality: AgentPersonality;
  businessFacts: { question: string; answer: string }[];
  clientFaqs: { question: string; answer: string }[];
  documentsQueued: string[];
  documentsNeedingStaff: { name: string; reason: string }[];
  websiteCrawl: string | null;
  websiteSkippedReason: string | null;
  brandNameApplied: string | null;
  logoApplied: boolean;
  releaseAt: Date;
  /** Things the questionnaire asked for that only a person can finish. */
  staffTodo: string[];
}

const TONE_WORDS: Record<IntakeAnswers["tone"], string> = {
  friendly: "warm, friendly and approachable",
  professional: "professional, clear and courteous",
  playful: "upbeat and lightly playful, while still precise",
  formal: "formal, polite and precise",
  empathetic: "patient, empathetic and reassuring",
};

const GOAL_BEHAVIOUR: Record<IntakeAnswers["goals"][number], string> = {
  answer_questions: "Answer customers' questions about the business accurately, using only the knowledge base.",
  capture_leads:
    "When someone shows real interest, ask for their name and the best way to reach them (phone/WhatsApp or email) so the team can follow up — one question at a time, never as a form.",
  book_appointments:
    "When someone wants an appointment, collect their preferred date and time, what it is for, and their name and contact details, then tell them the team will confirm the booking. Never say a booking is confirmed unless a booking tool confirmed it.",
  take_orders:
    "When someone wants to order, confirm exactly what they want (item, quantity, any options) and their name and contact details, then tell them the team will confirm the order, price and delivery. Never say an order is placed or paid unless a tool confirmed it.",
  customer_support:
    "Help existing customers with problems: understand the issue, check the knowledge base for the fix or policy, and hand over to a person when it needs the team.",
};

/** Common names → ISO 639-1. Anything unrecognised stays in the written instruction only. */
const LANGUAGE_CODES: Record<string, string> = {
  english: "en", shona: "sn", ndebele: "nd", "isindebele": "nd", zulu: "zu", isizulu: "zu", xhosa: "xh", swahili: "sw", kiswahili: "sw",
  french: "fr", portuguese: "pt", spanish: "es", arabic: "ar", afrikaans: "af", chichewa: "ny", nyanja: "ny", tswana: "tn",
  setswana: "tn", sotho: "st", sesotho: "st", tonga: "toi", chitonga: "toi", venda: "ve", tshivenda: "ve", tsonga: "ts", shangani: "ts", xitsonga: "ts", kalanga: "kck", tjikalanga: "kck", nambya: "nmq", ndau: "ndc", chibarwe: "bwg", chishona: "sn", chewa: "ny", amharic: "am", yoruba: "yo", igbo: "ig",
  hausa: "ha", somali: "so", kinyarwanda: "rw", luganda: "lg", german: "de", italian: "it", chinese: "zh", mandarin: "zh", hindi: "hi",
};

export function parseLanguages(text: string): { codes: string[]; names: string[] } {
  const names = text
    .split(/[,;/&\n]|\band\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const codes: string[] = [];
  for (const n of names) {
    const code = LANGUAGE_CODES[n.toLowerCase()];
    if (code && !codes.includes(code)) codes.push(code);
  }
  if (!codes.length) codes.push("en");
  return { codes, names };
}

/** "example.com" → "https://example.com/"; anything that isn't a public http(s) host → null. */
export function normaliseWebsite(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (!/^https?:$/.test(url.protocol)) return null;
    if (!url.hostname.includes(".") || /^(localhost|\d+\.\d+\.\d+\.\d+)$/i.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function defaultAssistantName(a: IntakeAnswers): string {
  return (a.assistantName || `${a.businessName} Assistant`).slice(0, 60);
}

/** How the assistant behaves — no business facts (those are in the knowledge base). */
export function buildSystemInstructions(a: IntakeAnswers): string {
  const name = defaultAssistantName(a);
  const langs = parseLanguages(a.languages);
  const lines: string[] = [
    `You are ${name}, the AI assistant for ${a.businessName}${a.industry ? ` (${a.industry})` : ""}. You speak on the business's behalf to its customers.`,
    "",
    "YOUR JOB",
    ...a.goals.map((g) => `- ${GOAL_BEHAVIOUR[g]}`),
    "",
    "HOW YOU SOUND",
    `- Be ${TONE_WORDS[a.tone]}. Keep replies short and easy to read on a phone.`,
    // Never a restriction: a customer who writes in any other language still
    // gets answered in it (engine/language.ts).
    langs.names.length
      ? `- Most customers write in ${langs.names.join(", ")}, but always reply in whatever language the customer uses, and switch when they do.`
      : "- Always reply in whatever language the customer uses, and switch when they do.",
    "- Use the customer's name once they have given it.",
    "",
    "FACTS",
    "- Every fact about the business — what it offers, prices, hours, location, policies — must come from the knowledge base.",
    "- If the knowledge base doesn't cover something, say you'll check with the team rather than guess.",
  ];
  if (a.leadQuestions) {
    lines.push("", "QUESTIONS TO ASK NEW ENQUIRIES (naturally, one at a time, only when relevant)", a.leadQuestions);
  }
  lines.push(
    "",
    "HANDING OVER TO A PERSON",
    a.handoffWhen
      ? `- Offer to connect the customer with a person from the team when: ${a.handoffWhen}`
      : "- Offer to connect the customer with a person from the team when they ask for one, are upset, or need something you can't do.",
    "- Before handing over, make sure you have their name, contact details and what they need, so nobody has to ask again.",
  );
  if (a.mustNotDo) {
    lines.push("", "NEVER", a.mustNotDo);
  }
  return lines.join("\n");
}

export function buildGreeting(a: IntakeAnswers): string {
  if (a.greeting) return a.greeting.slice(0, 2000);
  const name = defaultAssistantName(a);
  return `Hi! I'm ${name} from ${a.businessName}. How can I help you today?`.slice(0, 2000);
}

/** The questionnaire's business facts, phrased the way customers ask them. */
export function buildBusinessFacts(a: IntakeAnswers): { question: string; answer: string }[] {
  const biz = a.businessName;
  const facts: { question: string; answer: string }[] = [
    { question: `What does ${biz} do? What is ${biz}?`, answer: a.whatYouDo },
  ];
  if (a.industry) facts.push({ question: `What kind of business is ${biz}?`, answer: `${biz} is in ${a.industry}.` });
  if (a.location) facts.push({ question: `Where is ${biz} located? Which areas do you serve?`, answer: a.location });
  if (a.businessHours) facts.push({ question: `What are ${biz}'s opening hours? When are you open?`, answer: a.businessHours });
  if (a.website) facts.push({ question: `What is ${biz}'s website?`, answer: a.website });
  if (a.productsAndPrices)
    facts.push({ question: `What products and services does ${biz} offer, and how much do they cost? Prices and price list.`, answer: a.productsAndPrices });
  if (a.policies)
    facts.push({ question: `What are ${biz}'s policies — refunds, returns, delivery, payment, cancellations, warranty?`, answer: a.policies });
  return facts;
}

const INGESTIBLE: Record<string, "PDF" | "DOCX" | "TXT" | "CSV"> = { pdf: "PDF", docx: "DOCX", txt: "TXT", csv: "CSV" };

function knowledgeQueue(): string {
  return env.SQS_KNOWLEDGE_INGEST_QUEUE_URL ?? QUEUE_NAMES.knowledgeIngest;
}

/**
 * Returns null when the tenant already has an agent (staff got there first,
 * or a repeat submission) — nothing is overwritten.
 */
export async function buildAgentFromIntake(
  ctx: AppContext,
  input: { tenantId: string; submittedByUserId: string; answers: IntakeAnswers; files: IntakeFile[]; buffers: Buffer[]; submittedAt: Date },
): Promise<IntakeBuildReport | null> {
  const { tenantId, answers: a, files, buffers } = input;
  const tenantCtx = { tenantId };
  const actorUserId = input.submittedByUserId;
  const contentSource = "auto-drafted from the client's onboarding questionnaire";

  const existing = await withTenant(ctx.prisma, tenantCtx, (tx) => tx.agent.count({ where: { tenantId } }));
  if (existing > 0) return null;

  const langs = parseLanguages(a.languages);
  const personality: AgentPersonality = {
    tone: a.tone,
    name: defaultAssistantName(a),
    greeting: buildGreeting(a),
    languagePrimary: langs.codes[0]!,
    languagesSupported: langs.codes,
    systemInstructions: buildSystemInstructions(a),
    guardrailPolicy: "PREFER_UNKNOWN_OVER_INVENTED_FACT_CONFIRM_BEFORE_ACTING",
  };
  const agentId = randomUUID();
  const businessFacts = buildBusinessFacts(a);
  const clientFaqs = a.faqs.map((f) => ({ question: f.question, answer: f.answer }));
  const website = normaliseWebsite(a.website);
  const websiteSkippedReason = a.website && !website ? `"${a.website}" isn't a web address we can read.` : null;

  // Files to ingest are copied out of intake/ so deleting a knowledge source
  // later never removes the client's original upload.
  const documentsQueued: string[] = [];
  const documentsNeedingStaff: { name: string; reason: string }[] = [];
  const fileJobs: KnowledgeIngestJob[] = [];
  const fileSources: { id: string; type: "PDF" | "DOCX" | "TXT" | "CSV"; name: string; key: string }[] = [];
  for (const [i, f] of files.entries()) {
    if (f.kind !== "document") continue;
    const ext = (f.name.split(".").pop() ?? "").toLowerCase();
    const type = INGESTIBLE[ext];
    if (!type) {
      documentsNeedingStaff.push({
        name: f.name,
        reason: ["png", "jpg", "jpeg"].includes(ext)
          ? "an image — type up anything customers need from it"
          : `a .${ext} file — save it as PDF, DOCX, TXT or CSV and upload it`,
      });
      continue;
    }
    const id = randomUUID();
    const key = ctx.objectStore.tenantKey(tenantId, "knowledge", agentId, `${id}-${f.name}`);
    await ctx.objectStore.putObject(key, buffers[i]!, f.contentType);
    fileSources.push({ id, type, name: f.name, key });
    fileJobs.push({ tenantId, agentId, knowledgeSourceId: id, kind: "FILE", s3Key: key, originalFilename: f.name, fileType: type });
    documentsQueued.push(f.name);
  }

  const logoIndex = files.findIndex((f) => f.kind === "logo");
  let logoKey: string | null = null;
  if (logoIndex >= 0) {
    const logo = files[logoIndex]!;
    const ext = (logo.name.split(".").pop() ?? "png").toLowerCase();
    logoKey = ctx.objectStore.tenantKey(tenantId, "branding", `logo-${Date.now()}.${ext}`);
    await ctx.objectStore.putObject(logoKey, buffers[logoIndex]!, logo.contentType);
  }

  const faqSourceIds = { facts: randomUUID(), faqs: randomUUID(), crawl: randomUUID() };
  const releaseAt = new Date(input.submittedAt.getTime() + AGENT_RELEASE_DELAY_MS);

  const branding = await withTenant(ctx.prisma, tenantCtx, async (tx) => {
    // Re-checked inside the write: a double submit must not make two agents.
    if ((await tx.agent.count({ where: { tenantId } })) > 0) return null;
    await tx.agent.create({
      data: {
        id: agentId,
        tenantId,
        name: personality.name,
        status: "CONFIGURING",
        version: "v0.1",
        personality,
        modelRouting: { failoverChain: ["anthropic", "openai", "gemini"], reasoningEffort: "low" },
        enabledToolIds: [],
        crossAgentMemoryPeerIds: [],
        // Shown to the client as built by the setup team; the audit rows
        // below record that it was drafted automatically from their answers.
        createdBySource: "STAFF_MANAGED_SETUP",
        createdByUserId: actorUserId,
        lastEditedBySource: "STAFF_MANAGED_SETUP",
        lastEditedByUserId: actorUserId,
      },
    });
    await writeAuditLog(tx, tenantCtx, { actorUserId, agentId, action: "agent_instructions_edited", contentSource, metadata: { event: "agent_created", automated: true } });

    const sources: { id: string; type: "MANUAL_FAQ" | "WEBSITE_CRAWL" | "PDF" | "DOCX" | "TXT" | "CSV"; originalFilename?: string; sourceUrl?: string; s3Key?: string }[] = [
      { id: faqSourceIds.facts, type: "MANUAL_FAQ", originalFilename: "Business details, products & policies" },
    ];
    if (clientFaqs.length) sources.push({ id: faqSourceIds.faqs, type: "MANUAL_FAQ", originalFilename: "Frequently asked questions" });
    if (website) sources.push({ id: faqSourceIds.crawl, type: "WEBSITE_CRAWL", sourceUrl: website });
    for (const f of fileSources) sources.push({ id: f.id, type: f.type, originalFilename: f.name, s3Key: f.key });
    for (const s of sources) {
      await tx.knowledgeSource.create({
        data: { ...s, tenantId, agentId, status: "PENDING", addedBySource: "STAFF_MANAGED_SETUP", addedByUserId: actorUserId },
      });
    }
    await writeAuditLog(tx, tenantCtx, {
      actorUserId,
      agentId,
      action: "faq_added",
      contentSource,
      metadata: { automated: true, entryCount: businessFacts.length + clientFaqs.length },
    });
    if (fileSources.length)
      await writeAuditLog(tx, tenantCtx, { actorUserId, agentId, action: "document_uploaded", contentSource, metadata: { automated: true, filenames: documentsQueued } });
    if (website) await writeAuditLog(tx, tenantCtx, { actorUserId, agentId, action: "website_crawled", contentSource, metadata: { automated: true, startUrls: [website] } });

    // White-label branding, only where staff haven't already set it.
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { brandName: true, logoObjectKey: true } });
    const brandName = !tenant.brandName && a.brandDisplayName ? a.brandDisplayName.slice(0, 80) : null;
    const logoApplied = !tenant.logoObjectKey && Boolean(logoKey);
    if (brandName || logoApplied) {
      await tx.tenant.update({
        where: { id: tenantId },
        data: { ...(brandName ? { brandName } : {}), ...(logoApplied ? { logoObjectKey: logoKey } : {}) },
      });
      await writeAuditLog(tx, tenantCtx, { actorUserId, action: "tenant_branding_updated", contentSource, metadata: { automated: true, brandName, logoUploaded: logoApplied } });
    }
    return { brandName, logoApplied };
  });
  if (!branding) return null;

  const jobs: KnowledgeIngestJob[] = [
    { tenantId, agentId, knowledgeSourceId: faqSourceIds.facts, kind: "MANUAL_FAQ", faqEntries: businessFacts },
    ...(clientFaqs.length ? [{ tenantId, agentId, knowledgeSourceId: faqSourceIds.faqs, kind: "MANUAL_FAQ" as const, faqEntries: clientFaqs }] : []),
    ...(website ? [{ tenantId, agentId, knowledgeSourceId: faqSourceIds.crawl, kind: "WEBSITE_CRAWL" as const, startUrls: [website] }] : []),
    ...fileJobs,
  ];
  for (const job of jobs) await ctx.queue.enqueue<KnowledgeIngestJob>(knowledgeQueue(), job);

  const staffTodo: string[] = [];
  const channelTodo: Record<IntakeAnswers["channels"][number], string> = {
    website:
      a.websiteInstall === "do_it_for_me"
        ? `Install the website widget for them (${a.websitePlatform.replace("_", " ")}).`
        : a.websiteInstall === "send_me_a_guide"
          ? `Send them the widget install guide for ${a.websitePlatform.replace("_", " ")}.`
          : "Website widget: they said not now — offer it again at launch.",
    whatsapp: `Connect WhatsApp${a.whatsappNumber ? ` (${a.whatsappNumber})` : " — get the number from them"}.`,
    facebook: `Connect Facebook Messenger${a.facebookPage ? ` (${a.facebookPage})` : " — get the page from them"}.`,
    instagram: `Connect Instagram${a.instagramHandle ? ` (${a.instagramHandle})` : " — get the account from them"}.`,
    telegram: `Connect Telegram — get the bot token from them${a.telegramNotes ? ` (${a.telegramNotes})` : ""}.`,
  };
  for (const c of a.channels) staffTodo.push(channelTodo[c]);
  if (a.calendar !== "none" && a.goals.includes("book_appointments"))
    staffTodo.push(`Bookings: they use ${a.calendar === "google" ? "Google Calendar — the owner connects it from Integrations" : a.calendar}. Until a booking tool is connected, the assistant collects requests and says the team will confirm.`);
  else if (a.goals.includes("book_appointments")) staffTodo.push("Bookings: no calendar given — the assistant collects requests for the team to confirm. Ask if they want a calendar connected.");
  if (a.handoffContact) staffTodo.push(`Handover alerts: set them to go to ${a.handoffContact}.`);
  if (a.otherTools) staffTodo.push(`Other tools they mentioned: ${a.otherTools}`);
  if (!a.productsAndPrices) staffTodo.push("No products or prices were given — the assistant will say it needs to check. Ask them for a price list.");
  if (!a.businessHours) staffTodo.push("No opening hours were given — ask for them; customers ask this constantly.");
  staffTodo.push("Decide with them whether customers should get a public phone/WhatsApp number from the assistant — the questionnaire's contact is for our team only, so it was not added.");
  for (const d of documentsNeedingStaff) staffTodo.push(`${d.name} is ${d.reason}.`);
  if (websiteSkippedReason) staffTodo.push(`Website: ${websiteSkippedReason}`);
  if (a.notes) staffTodo.push(`Their notes: ${a.notes}`);

  return {
    agentId,
    agentName: personality.name,
    personality,
    businessFacts,
    clientFaqs,
    documentsQueued,
    documentsNeedingStaff,
    websiteCrawl: website,
    websiteSkippedReason,
    brandNameApplied: branding.brandName,
    logoApplied: branding.logoApplied,
    releaseAt,
    staffTodo,
  };
}

const TONE_LABEL: Record<string, string> = { friendly: "Friendly", professional: "Professional", playful: "Playful", formal: "Formal", empathetic: "Empathetic" };

function formatTime(d: Date): string {
  // Harare time — our team and our clients work in CAT (UTC+2, no DST).
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Harare", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }).format(d) + " CAT";
}

/** The staff build report: everything that was set up, and exactly what's left for a person. */
export function staffBuildEmail(input: {
  brand: string;
  tenantName: string;
  answers: IntakeAnswers;
  report: IntakeBuildReport | null;
  buildError: string | null;
  intakeSummary: string;
  fileLine: string;
  dashboardUrl: string;
}): { subject: string; text: string; html: PremiumEmail } {
  const { answers: a, report: r } = input;
  const subject = r
    ? `New free trial: ${a.businessName} — assistant drafted, client notified at ${formatTime(r.releaseAt)}`
    : `New free trial: ${a.businessName}`;
  const knowledgeLines = r
    ? [
        `${r.businessFacts.length} business facts (what they do, hours, location, products & prices, policies)`,
        `${r.clientFaqs.length} of their own FAQs`,
        ...(r.websiteCrawl ? [`Website crawl: ${r.websiteCrawl} (up to 50 pages)`] : []),
        ...r.documentsQueued.map((d) => `Document: ${d}`),
      ]
    : [];
  const status = r
    ? `Their assistant "${r.agentName}" is drafted and loading knowledge now. It's in Configuring, so their dashboard says our team is working on it.\n\n` +
      `At ${formatTime(r.releaseAt)} it moves to Testing automatically and they're emailed that it's ready to try. ` +
      `Press Start Testing earlier to release it sooner, or adjust anything below first — your edits are what they'll see. It only goes live once they approve.`
    : input.buildError
      ? `The automatic draft failed (${input.buildError}). Nothing was created — build their assistant by hand from Managed Setup.`
      : "They already had an assistant, so nothing was drafted automatically. Their answers are below.";

  const text = [
    `${input.tenantName} just started a free trial and told us about their business.`,
    "",
    status,
    ...(r
      ? [
          "",
          "WHAT WAS SET UP",
          `  Assistant: ${r.agentName} — ${TONE_LABEL[r.personality.tone] ?? r.personality.tone}, languages ${r.personality.languagesSupported.join(", ")}`,
          `  Greeting: ${r.personality.greeting}`,
          ...knowledgeLines.map((l) => `  Knowledge: ${l}`),
          ...(r.brandNameApplied ? [`  Brand name: ${r.brandNameApplied}`] : []),
          ...(r.logoApplied ? ["  Logo: applied to their dashboard"] : []),
          "",
          "INSTRUCTIONS",
          r.personality.systemInstructions,
          "",
          "LEFT FOR OUR TEAM",
          ...r.staffTodo.map((t) => `  - ${t}`),
        ]
      : []),
    "",
    "THEIR ANSWERS",
    input.intakeSummary,
    "",
    input.fileLine,
    "",
    `Managed Setup: ${input.dashboardUrl}/managed-setup`,
    "Their 14-day trial starts when their assistant goes live.",
  ].join("\n");

  const html: PremiumEmail = {
    preheader: r ? `${r.agentName} is drafted — client is told it's ready at ${formatTime(r.releaseAt)}.` : `${a.businessName} sent their onboarding questionnaire.`,
    brand: input.brand,
    eyebrow: "New free trial · Build report",
    headline: r ? `${r.agentName} is drafted for ${a.businessName}` : `${a.businessName} sent their questionnaire`,
    intro: status,
    sections: [
      ...(r
        ? [
            {
              blocks: [
                {
                  kind: "stats" as const,
                  items: [
                    { value: String(r.businessFacts.length + r.clientFaqs.length), label: "answers loaded" },
                    { value: String(r.documentsQueued.length), label: "documents" },
                    { value: r.websiteCrawl ? "Yes" : "No", label: "website crawl" },
                    { value: String(r.staffTodo.length), label: "items for us" },
                  ],
                },
                { kind: "callout" as const, tone: "brand" as const, text: `Client notification: ${formatTime(r.releaseAt)} — automatic, unless you press Start Testing first.` },
              ],
            },
            {
              title: "The assistant",
              blocks: [
                {
                  kind: "facts" as const,
                  rows: [
                    { label: "Name", value: r.agentName },
                    { label: "Tone", value: TONE_LABEL[r.personality.tone] ?? r.personality.tone },
                    { label: "Languages", value: r.personality.languagesSupported.join(", ") },
                    { label: "Greeting", value: r.personality.greeting },
                    { label: "Can do", value: a.goals.map((g) => GOAL_LABEL[g]).join(", ") },
                    { label: "Brand name", value: r.brandNameApplied ?? "" },
                    { label: "Logo", value: r.logoApplied ? "Applied to their dashboard" : "" },
                  ],
                },
              ],
            },
            { title: "Instructions it follows", blocks: [{ kind: "quote" as const, text: r.personality.systemInstructions }] },
            {
              title: "Knowledge base (ingesting now)",
              blocks: [
                { kind: "list" as const, tone: "success" as const, items: knowledgeLines },
                ...r.businessFacts.map((f) => ({ kind: "facts" as const, rows: [{ label: f.question, value: f.answer }] })),
                ...r.clientFaqs.map((f) => ({ kind: "facts" as const, rows: [{ label: f.question, value: f.answer }] })),
              ],
            },
            { title: "Left for our team", blocks: [{ kind: "list" as const, tone: "warning" as const, items: r.staffTodo }] },
          ]
        : []),
      { title: "Everything they told us", blocks: [{ kind: "quote" as const, text: input.intakeSummary }, { kind: "text" as const, muted: true, text: input.fileLine }] },
    ],
    cta: { label: "Open Managed Setup", url: `${input.dashboardUrl}/managed-setup` },
    signoff: "Their 14-day trial starts the day their assistant goes live.",
    footer: `${input.brand} · internal build report for our setup team. Not for forwarding to the client.`,
  };
  return { subject, text, html };
}

const GOAL_LABEL: Record<IntakeAnswers["goals"][number], string> = {
  answer_questions: "Answer questions",
  capture_leads: "Capture leads",
  book_appointments: "Take booking requests",
  take_orders: "Take order requests",
  customer_support: "Customer support",
};
