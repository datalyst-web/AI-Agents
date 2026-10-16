import { describe, it, expect } from "vitest";
import { renderPremiumEmail } from "@chat-agent/email";

process.env.DATABASE_URL ??= "postgresql://unit:test@localhost:5432/none";
process.env.JWT_SECRET ??= "unit-test-jwt-secret-not-real-0123456789";
const { agentReadyEmail } = await import("./intakeAgentReleaseSweep.js");

const base = {
  brand: "Datalyst Africa",
  firstName: "Tendai",
  agentName: "Ava",
  greeting: "Hi! I'm Ava from Sunrise Dental.",
  answers: {
    businessName: "Sunrise Dental",
    goals: ["answer_questions", "book_appointments"],
    channels: ["website", "whatsapp"],
    businessHours: "Mon–Fri 8–5",
    productsAndPrices: "Check-up $30",
    faqs: [{ question: "Do you accept medical aid?", answer: "Yes" }],
  },
  readyWebsitePages: 6,
  readyDocuments: ["price list.pdf"],
  dashboardUrl: "https://app.example",
  agentId: "agent-1",
};

describe("the client's 'your assistant is ready' email", () => {
  it("is personal, specific to what was built, and links straight to their assistant", () => {
    const email = agentReadyEmail(base);
    expect(email.subject).toBe("Ava is ready — your AI assistant for Sunrise Dental is set up");
    expect(email.text).toMatch(/^Hi Tendai,/);
    expect(email.text).toContain("Our team has finished setting up Ava");
    expect(email.text).toContain("6 pages from your website");
    expect(email.text).toContain("Your document: price list.pdf");
    expect(email.text).toContain("“Do you accept medical aid?”");
    expect(email.text).toContain("your website and WhatsApp");
    expect(email.text).toContain("https://app.example/agents/agent-1");
    expect(email.text).toContain("starts the day your assistant goes live");
  });

  it("never names the AI provider or model, and escapes client text", () => {
    const html = renderPremiumEmail(agentReadyEmail({ ...base, agentName: "<b>Ava</b>" }).html);
    expect(html).not.toMatch(/openai|gpt|gemini|anthropic|claude/i);
    expect(html).not.toContain("<b>Ava</b>");
  });

  it("still reads naturally with a minimal questionnaire", () => {
    const email = agentReadyEmail({ ...base, firstName: null, answers: { businessName: "Kopje Hardware" }, readyWebsitePages: 0, readyDocuments: [] });
    expect(email.text).toMatch(/^Hi there,/);
    expect(email.text).toContain("What Kopje Hardware does, in your words");
    expect(email.text).toContain("“Can I speak to a person?”");
    expect(email.text).not.toContain("We'll then put it live on");
  });
});
