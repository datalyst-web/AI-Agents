import { describe, it, expect } from "vitest";
import { renderPremiumEmail } from "@chat-agent/email";

// The route module loads env at import time; nothing here touches a database.
process.env.DATABASE_URL ??= "postgresql://unit:test@localhost:5432/none";
process.env.JWT_SECRET ??= "unit-test-jwt-secret-not-real-0123456789";
const { IntakeAnswersSchema } = await import("../routes/onboarding.routes.js");
const { buildBusinessFacts, buildGreeting, buildSystemInstructions, defaultAssistantName, normaliseWebsite, parseLanguages, staffBuildEmail } =
  await import("./intakeAutoBuild.js");

const answers = IntakeAnswersSchema.parse({
  businessName: "Sunrise Dental",
  whatYouDo: "A family dental clinic offering check-ups, whitening and braces.",
  businessHours: "Mon–Fri 8am–5pm, Sat 8am–12pm",
  location: "12 Samora Machel Ave, Harare",
  productsAndPrices: "Check-up $30\nWhitening $120",
  policies: "Cancel 24 hours ahead or pay a $10 fee.",
  goals: ["answer_questions", "book_appointments", "capture_leads"],
  channels: ["website", "whatsapp"],
  contactName: "Tendai Moyo",
  contactPhone: "+263 77 123 4567",
  languages: "English, Shona",
  mustNotDo: "Never give medical diagnoses.",
  faqs: [{ question: "Do you accept medical aid?", answer: "Yes — CIMAS and PSMAS." }],
});

describe("drafting an assistant from the onboarding questionnaire", () => {
  it("keeps business facts out of the instructions and in the knowledge base", () => {
    const instructions = buildSystemInstructions(answers);
    expect(instructions).toContain("Sunrise Dental");
    expect(instructions).toContain("Never give medical diagnoses.");
    expect(instructions).toContain("English, Shona");
    // Facts (CLAUDE.md principle 3) are never baked into the prompt.
    expect(instructions).not.toContain("$30");
    expect(instructions).not.toContain("Samora Machel");
    expect(instructions).toMatch(/Never say a booking is confirmed unless a booking tool confirmed it/);

    const facts = buildBusinessFacts(answers);
    expect(facts.map((f) => f.answer)).toEqual(
      expect.arrayContaining(["Check-up $30\nWhitening $120", "Mon–Fri 8am–5pm, Sat 8am–12pm", "12 Samora Machel Ave, Harare"]),
    );
    // The team contact number is for us, never handed to customers.
    expect(JSON.stringify(facts)).not.toContain("+263 77 123 4567");
  });

  it("fills sensible defaults for what the client left blank", () => {
    expect(defaultAssistantName(answers)).toBe("Sunrise Dental Assistant");
    expect(buildGreeting(answers)).toBe("Hi! I'm Sunrise Dental Assistant from Sunrise Dental. How can I help you today?");
    expect(parseLanguages("English, Shona and Ndebele").codes).toEqual(["en", "sn", "nd"]);
    expect(parseLanguages("").codes).toEqual(["en"]);
    expect(parseLanguages("Klingon").codes).toEqual(["en"]);
  });

  it("only crawls real public web addresses", () => {
    expect(normaliseWebsite("sunrisedental.co.zw")).toBe("https://sunrisedental.co.zw/");
    expect(normaliseWebsite("http://example.com/about")).toBe("http://example.com/about");
    expect(normaliseWebsite("localhost:3000")).toBeNull();
    expect(normaliseWebsite("192.168.0.1")).toBeNull();
    expect(normaliseWebsite("we don't have one")).toBeNull();
    expect(normaliseWebsite("")).toBeNull();
  });

  it("emails staff the full build, and escapes everything the client typed", () => {
    const hostile = { ...answers, businessName: `<script>alert(1)</script>` };
    const email = staffBuildEmail({
      brand: "Datalyst Africa",
      tenantName: "Sunrise Dental",
      answers: hostile,
      report: {
        agentId: "a",
        agentName: "Ava",
        personality: { tone: "friendly", name: "Ava", greeting: "Hi!", languagePrimary: "en", languagesSupported: ["en", "sn"], systemInstructions: buildSystemInstructions(hostile), guardrailPolicy: "PREFER_UNKNOWN_OVER_INVENTED_FACT_CONFIRM_BEFORE_ACTING" },
        businessFacts: buildBusinessFacts(hostile),
        clientFaqs: hostile.faqs,
        documentsQueued: ["prices.pdf"],
        documentsNeedingStaff: [],
        websiteCrawl: null,
        websiteSkippedReason: null,
        brandNameApplied: null,
        logoApplied: true,
        releaseAt: new Date("2026-10-15T10:30:00Z"),
        staffTodo: ["Connect WhatsApp."],
      },
      buildError: null,
      intakeSummary: "summary",
      fileLine: "No files were sent.",
      dashboardUrl: "https://app.example",
    });
    expect(email.subject).toContain("client notified at");
    expect(email.text).toContain("Connect WhatsApp.");
    expect(email.text).toContain("prices.pdf");
    const html = renderPremiumEmail(email.html);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("12:30 CAT");
  });
});
