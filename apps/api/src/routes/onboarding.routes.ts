import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { withPlatformContext, withTenant } from "@chat-agent/db";
import type { EmailAttachment } from "@chat-agent/email";
import type { AppContext } from "../lib/context.js";
import { requireStaff, requireTenantMatch } from "../lib/rbac.js";
import { writeAuditLog } from "../lib/audit.js";
import { env } from "../env.js";

/**
 * The free-trial onboarding questionnaire. Right after signup (and the
 * email code) a new TRIAL client lands on "Tell us about your business"
 * before anything else. It exists only for trials — clients who subscribe
 * directly give us their information another way.
 *
 * It collects everything our team needs to build and connect the client's
 * assistant without chasing them: business facts, how the assistant should
 * behave, the knowledge it answers from (FAQs, prices, policies,
 * documents), branding (including their logo), and every channel to
 * connect (CLAUDE.md Managed Setup Service: "their only input is sending
 * us their material"). Every staff member is emailed all of it, with files
 * attached when small enough; it's also on the client's card in Managed
 * Setup. Files go to R2 under the tenant's "intake/" prefix — staff review
 * them and add what belongs in the knowledge base through the normal tools.
 */
const optionalText = (max: number) => z.string().trim().max(max).optional().default("");

export const IntakeAnswersSchema = z.object({
  // Business
  businessName: z.string().trim().min(1, "Tell us your business name.").max(120),
  whatYouDo: z.string().trim().min(10, "Tell us a little about what your business does.").max(3000),
  industry: optionalText(120),
  location: optionalText(300),
  businessHours: optionalText(300),
  website: optionalText(300),
  // Who our team talks to
  contactName: z.string().trim().min(1, "Tell us who we should talk to.").max(120),
  contactPhone: z.string().trim().min(5, "Add a phone or WhatsApp number we can reach you on.").max(40),
  contactEmail: optionalText(200),
  // The assistant
  assistantName: optionalText(60),
  tone: z.enum(["friendly", "professional", "playful", "formal", "empathetic"]).optional().default("friendly"),
  greeting: optionalText(500),
  languages: optionalText(200),
  goals: z
    .array(z.enum(["answer_questions", "capture_leads", "book_appointments", "take_orders", "customer_support"]))
    .min(1, "Choose at least one thing your assistant should do."),
  mustNotDo: optionalText(2000),
  handoffWhen: optionalText(1000),
  handoffContact: optionalText(300),
  leadQuestions: optionalText(1000),
  // Knowledge
  productsAndPrices: optionalText(8000),
  faqs: z
    .array(z.object({ question: z.string().trim().min(1).max(500), answer: z.string().trim().min(1).max(3000) }))
    .max(50)
    .optional()
    .default([]),
  policies: optionalText(5000),
  // Branding
  brandDisplayName: optionalText(120),
  brandColor: optionalText(40),
  // Channels
  channels: z
    .array(z.enum(["website", "whatsapp", "facebook", "instagram", "telegram"]))
    .min(1, "Choose at least one place your customers should reach it."),
  websitePlatform: z.enum(["wordpress", "wix", "shopify", "squarespace", "custom", "none", "not_sure"]).optional().default("not_sure"),
  websiteInstall: z.enum(["do_it_for_me", "send_me_a_guide", "not_now"]).optional().default("do_it_for_me"),
  whatsappNumber: optionalText(40),
  facebookPage: optionalText(300),
  instagramHandle: optionalText(120),
  telegramNotes: optionalText(300),
  // Bookings and tools
  calendar: z.enum(["google", "outlook", "other", "none"]).optional().default("none"),
  otherTools: optionalText(500),
  notes: optionalText(3000),
});
export type IntakeAnswers = z.infer<typeof IntakeAnswersSchema>;

export interface IntakeFile {
  name: string;
  key: string;
  size: number;
  contentType: string;
  /** "logo" for the brand logo upload, otherwise a knowledge document. */
  kind: "document" | "logo";
}

const MAX_DOCUMENTS = 8;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Gmail's API rejects large raw messages; beyond this, staff download files from Managed Setup instead. */
const MAX_EMAIL_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const DOCUMENT_EXTENSIONS = new Set(["pdf", "doc", "docx", "txt", "csv", "xls", "xlsx", "ppt", "pptx", "png", "jpg", "jpeg"]);
const LOGO_EXTENSIONS = new Set(["png", "jpg", "jpeg", "svg", "webp"]);

const GOALS: Record<IntakeAnswers["goals"][number], string> = {
  answer_questions: "Answer customer questions",
  capture_leads: "Capture and qualify leads",
  book_appointments: "Book appointments",
  take_orders: "Take orders and enquiries",
  customer_support: "Customer support",
};
const CHANNELS: Record<IntakeAnswers["channels"][number], string> = {
  website: "Website",
  whatsapp: "WhatsApp",
  facebook: "Facebook Messenger",
  instagram: "Instagram",
  telegram: "Telegram",
};
const PLATFORMS: Record<IntakeAnswers["websitePlatform"], string> = {
  wordpress: "WordPress",
  wix: "Wix",
  shopify: "Shopify",
  squarespace: "Squarespace",
  custom: "Custom-built",
  none: "No website",
  not_sure: "Not sure",
};
const INSTALL: Record<IntakeAnswers["websiteInstall"], string> = {
  do_it_for_me: "Install it for me",
  send_me_a_guide: "Send me a step-by-step guide",
  not_now: "Not now",
};
const CALENDARS: Record<IntakeAnswers["calendar"], string> = { google: "Google Calendar", outlook: "Outlook", other: "Other", none: "None" };

/** Plain-text summary for the staff email and Managed Setup — every answer, grouped as the form is. */
export function describeIntake(a: IntakeAnswers): string {
  const v = (x: string) => x || "—";
  const faqs = a.faqs.length ? a.faqs.map((f, i) => `  ${i + 1}. Q: ${f.question}\n     A: ${f.answer}`).join("\n") : "  —";
  return [
    "BUSINESS",
    `  Name: ${a.businessName}`,
    `  What they do: ${a.whatYouDo}`,
    `  Industry: ${v(a.industry)}`,
    `  Location / service area: ${v(a.location)}`,
    `  Hours: ${v(a.businessHours)}`,
    `  Website: ${v(a.website)}`,
    "",
    "CONTACT FOR OUR TEAM",
    `  ${a.contactName}, ${a.contactPhone}${a.contactEmail ? `, ${a.contactEmail}` : ""}`,
    "",
    "THE ASSISTANT",
    `  Name: ${v(a.assistantName)}`,
    `  Tone: ${a.tone}`,
    `  Greeting: ${v(a.greeting)}`,
    `  Languages: ${v(a.languages)}`,
    `  Should: ${a.goals.map((g) => GOALS[g]).join(", ")}`,
    `  Must never: ${v(a.mustNotDo)}`,
    `  Hand over to a person when: ${v(a.handoffWhen)}`,
    `  Handover alerts go to: ${v(a.handoffContact)}`,
    `  Questions to ask new leads: ${v(a.leadQuestions)}`,
    "",
    "KNOWLEDGE",
    `  Products, services and prices:\n  ${v(a.productsAndPrices)}`,
    `  FAQs:\n${faqs}`,
    `  Policies:\n  ${v(a.policies)}`,
    "",
    "BRANDING",
    `  Display name: ${v(a.brandDisplayName)}`,
    `  Brand colour: ${v(a.brandColor)}`,
    "",
    "CHANNELS",
    `  Wanted: ${a.channels.map((c) => CHANNELS[c]).join(", ")}`,
    `  Website platform: ${PLATFORMS[a.websitePlatform]} — ${INSTALL[a.websiteInstall]}`,
    `  WhatsApp number: ${v(a.whatsappNumber)}`,
    `  Facebook page: ${v(a.facebookPage)}`,
    `  Instagram: ${v(a.instagramHandle)}`,
    `  Telegram: ${v(a.telegramNotes)}`,
    "",
    "BOOKINGS AND TOOLS",
    `  Calendar: ${CALENDARS[a.calendar]}`,
    `  Other tools: ${v(a.otherTools)}`,
    "",
    "ANYTHING ELSE",
    `  ${v(a.notes)}`,
  ].join("\n");
}

function safeFilename(name: string): string {
  return name.replace(/[^\w.\- ]+/g, "_").slice(-120) || "file";
}

export async function registerOnboardingRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/v1/tenants/:tenantId/intake", { preHandler: [app.authenticate, requireTenantMatch()] }, async (request, reply) => {
    const role = request.authUser!.role;
    if (role !== "tenant_owner" && role !== "tenant_admin") {
      reply.code(403).send({ error: "forbidden", message: "Only the account owner or an admin can send this." });
      return;
    }
    const tenantId = request.tenantCtx!.tenantId;

    let rawAnswers: unknown;
    const files: IntakeFile[] = [];
    const buffers: Buffer[] = [];
    for await (const part of request.parts()) {
      if (part.type === "field") {
        if (part.fieldname === "answers") {
          try {
            rawAnswers = JSON.parse(String(part.value));
          } catch {
            reply.code(400).send({ error: "invalid_request", message: "The form couldn't be read. Please try again." });
            return;
          }
        }
        continue;
      }
      const kind: IntakeFile["kind"] = part.fieldname === "logo" ? "logo" : "document";
      const ext = (part.filename.split(".").pop() ?? "").toLowerCase();
      if (kind === "logo" && !LOGO_EXTENSIONS.has(ext)) {
        reply.code(400).send({ error: "unsupported_file_type", message: `${part.filename}: your logo should be a PNG, JPG, SVG or WebP image.` });
        return;
      }
      if (kind === "document" && !DOCUMENT_EXTENSIONS.has(ext)) {
        reply.code(400).send({ error: "unsupported_file_type", message: `${part.filename}: please send PDF, Word, Excel, PowerPoint, text, CSV or image files.` });
        return;
      }
      const limitReached = kind === "logo" ? files.some((f) => f.kind === "logo") : files.filter((f) => f.kind === "document").length >= MAX_DOCUMENTS;
      if (limitReached) {
        reply.code(400).send({ error: "too_many_files", message: kind === "logo" ? "Send one logo." : `You can send up to ${MAX_DOCUMENTS} documents.` });
        return;
      }
      const buffer = await part.toBuffer();
      if (buffer.length > MAX_FILE_BYTES) {
        reply.code(400).send({ error: "file_too_large", message: `${part.filename} is over 10 MB.` });
        return;
      }
      const name = safeFilename(part.filename);
      const key = ctx.objectStore.tenantKey(tenantId, "intake", `${randomUUID()}-${name}`);
      await ctx.objectStore.putObject(key, buffer, part.mimetype);
      files.push({ name, key, size: buffer.length, contentType: part.mimetype, kind });
      buffers.push(buffer);
    }
    const answers = IntakeAnswersSchema.parse(rawAnswers);

    const tenant = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
      const updated = await tx.tenant.update({
        where: { id: tenantId },
        data: { onboardingIntake: { answers, files } as object, onboardingIntakeAt: new Date() },
        select: { id: true, name: true },
      });
      await writeAuditLog(tx, request.tenantCtx!, {
        actorUserId: request.authUser!.sub,
        action: "onboarding_intake_submitted",
        contentSource: "client onboarding questionnaire",
        metadata: { files: files.map((f) => f.name) },
      });
      return updated;
    });

    // Every staff member gets the whole questionnaire. Failing to email must
    // not lose the submission (it's saved above and shown in Managed Setup),
    // so it's logged, not returned as an error.
    const staff = await withPlatformContext(ctx.prisma, (tx) =>
      tx.user.findMany({ where: { isActive: true, role: { in: ["platform_admin", "setup_specialist"] } }, select: { email: true } }),
    );
    const totalBytes = buffers.reduce((sum, b) => sum + b.length, 0);
    const attachments: EmailAttachment[] | undefined =
      files.length && totalBytes <= MAX_EMAIL_ATTACHMENT_BYTES
        ? files.map((f, i) => ({ filename: f.name, content: buffers[i]!, contentType: f.contentType }))
        : undefined;
    const fileNames = files.map((f) => (f.kind === "logo" ? `${f.name} (logo)` : f.name)).join(", ");
    const fileLine = files.length
      ? attachments
        ? `Files attached: ${fileNames}.`
        : `Files: ${fileNames} — too large to attach; download them from Managed Setup.`
      : "No files were sent.";
    const staffText =
      `${tenant.name} just started a free trial and told us about their business.\n\n` +
      `${describeIntake(answers)}\n\n${fileLine}\n\n` +
      `Build their assistant from Managed Setup: ${env.DASHBOARD_BASE_URL}/managed-setup\n` +
      `Their 14-day trial starts when their assistant goes live.`;
    const results = await Promise.all(
      staff.map((s) => ctx.email.send({ to: s.email, subject: `New free trial: ${answers.businessName}`, text: staffText, attachments })),
    );
    const failed = results.filter((r) => !r.sent);
    if (failed.length) request.log.error({ tenantId, failed: failed.length, error: failed[0]?.error }, "could not email staff about a new trial intake");

    const submitter = await withTenant(ctx.prisma, request.tenantCtx!, (tx) =>
      tx.user.findUnique({ where: { id: request.authUser!.sub }, select: { email: true } }),
    );
    if (submitter) {
      await ctx.email.send({
        to: submitter.email,
        subject: "We've got your details — we're building your AI assistant",
        text:
          `Thanks for telling us about ${answers.businessName}.\n\n` +
          `Our team is now building your AI assistant from what you sent, and we'll set everything up for you — ` +
          `including connecting it to your website and channels. We'll email you the moment it's ready to try.\n\n` +
          `Your 14-day free trial starts the day it goes live, so you get the full 14 days with it.\n\n` +
          `Want to add something? Just reply to this email.`,
      });
    }

    reply.send({ ok: true, files: files.length });
  });

  app.get("/v1/platform/tenants/:tenantId/intake", { preHandler: [app.authenticate, requireStaff()] }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const tenant = await withPlatformContext(ctx.prisma, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId }, select: { onboardingIntake: true, onboardingIntakeAt: true } }),
    );
    if (!tenant?.onboardingIntake) {
      reply.code(404).send({ error: "no_intake" });
      return;
    }
    const intake = tenant.onboardingIntake as unknown as { answers: IntakeAnswers; files: IntakeFile[] };
    reply.send({
      submittedAt: tenant.onboardingIntakeAt,
      answers: intake.answers,
      summary: describeIntake(intake.answers),
      // Storage keys stay server-side; files are fetched by index.
      files: intake.files.map((f, index) => ({ index, name: f.name, size: f.size, kind: f.kind ?? "document" })),
    });
  });

  app.get("/v1/platform/tenants/:tenantId/intake/files/:index", { preHandler: [app.authenticate, requireStaff()] }, async (request, reply) => {
    const { tenantId, index } = request.params as { tenantId: string; index: string };
    const tenant = await withPlatformContext(ctx.prisma, (tx) => tx.tenant.findUnique({ where: { id: tenantId }, select: { onboardingIntake: true } }));
    const file = (tenant?.onboardingIntake as unknown as { files?: IntakeFile[] } | null)?.files?.[Number(index)];
    if (!file) {
      reply.code(404).send({ error: "file_not_found" });
      return;
    }
    reply.send({ url: await ctx.objectStore.presignedDownloadUrl(file.key, 300), name: file.name });
  });
}
