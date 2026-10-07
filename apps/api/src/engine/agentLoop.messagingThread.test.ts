import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

/**
 * Messaging channels (WhatsApp, Telegram, Messenger, Instagram) carry no
 * conversation id, so every message used to start a new conversation and the
 * agent forgot the previous one. Also covers the WhatsApp coexistence pause:
 * a reply from the WhatsApp Business app makes the AI step back in that chat,
 * and the pause lapses on its own. Runs against the real RLS-enforced role,
 * with a stand-in model that always answers "ok".
 */

let prisma: import("@chat-agent/db").PrismaClient;
let withPlatformContext: typeof import("@chat-agent/db").withPlatformContext;
let withTenant: typeof import("@chat-agent/db").withTenant;
let loop: typeof import("./agentLoop.js");
const createdTenantIds: string[] = [];
const modelCalls: { messages: { role: string; content: string }[] }[] = [];

beforeAll(async () => {
  if (!process.env.CHAT_APP_DATABASE_URL) return;
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? process.env.CHAT_APP_DATABASE_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-not-real-0123456789";
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.CHANNEL_CREDENTIALS_ENCRYPTION_KEY =
    process.env.CHANNEL_CREDENTIALS_ENCRYPTION_KEY ?? Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
  const db = await import("@chat-agent/db");
  ({ withPlatformContext, withTenant } = db);
  prisma = db.createPrismaClient(process.env.CHAT_APP_DATABASE_URL);
  loop = await import("./agentLoop.js");
}, 120_000);

afterAll(async () => {
  if (!prisma) return;
  await withPlatformContext(prisma, async (tx) => {
    for (const id of createdTenantIds) await tx.tenant.delete({ where: { id } }).catch(() => undefined);
  });
  await prisma.$disconnect();
});

function deps() {
  const router = {
    generate: async (req: { messages: { role: string; content: string }[] }) => {
      modelCalls.push({ messages: req.messages });
      return { content: "ok", finishReason: "stop", toolCalls: [], provider: "gemini", model: "test", usage: { inputTokens: 1, outputTokens: 1 } };
    },
    embed: async () => {
      throw new Error("no embeddings in this test");
    },
  };
  return { prisma, router, secrets: {}, queue: { enqueue: async () => undefined } } as never;
}

async function seedAgent() {
  const tenant = await withPlatformContext(prisma, (tx) =>
    tx.tenant.create({ data: { name: `Thread Co ${randomUUID().slice(0, 8)}`, slug: `thread-${randomUUID()}`, subscriptionState: "ACTIVE" } }),
  );
  createdTenantIds.push(tenant.id);
  const actorId = randomUUID();
  const agent = await withTenant(prisma, { tenantId: tenant.id }, (tx) =>
    tx.agent.create({
      data: {
        tenantId: tenant.id,
        name: "Thread Agent",
        status: "TESTING",
        personality: {
          tone: "friendly",
          name: "Ava",
          greeting: "Hi!",
          languagePrimary: "en",
          languagesSupported: ["en"],
          systemInstructions: "Be helpful.",
          guardrailPolicy: "PREFER_UNKNOWN_OVER_INVENTED_FACT_CONFIRM_BEFORE_ACTING",
        },
        modelRouting: { failoverChain: ["gemini"] },
        enabledToolIds: [],
        crossAgentMemoryPeerIds: [],
        createdBySource: "CLIENT",
        createdByUserId: actorId,
        lastEditedBySource: "CLIENT",
        lastEditedByUserId: actorId,
      },
    }),
  );
  return { tenantId: tenant.id, agentId: agent.id };
}

const send = (ids: { tenantId: string; agentId: string }, customer: string, text: string) =>
  loop.processCustomerMessage(deps(), {
    ...ids,
    channel: "WHATSAPP",
    customerMessage: text,
    customerIdentifier: { type: "whatsapp_phone_number", value: customer },
    useWorkingCopy: true,
  });

describe.skipIf(!process.env.CHAT_APP_DATABASE_URL)("messaging-channel threads", () => {
  it("continues one conversation per customer, so the model sees the earlier message", async () => {
    const ids = await seedAgent();
    const first = await send(ids, "263770000001", "My name is Tendai");
    modelCalls.length = 0;
    const second = await send(ids, "263770000001", "What is my name?");
    expect(second.conversationId).toBe(first.conversationId);
    const seen = modelCalls[0]!.messages.map((m) => m.content).join("\n");
    expect(seen).toContain("My name is Tendai");

    // A different customer gets their own thread.
    const other = await send(ids, "263770000002", "Hello");
    expect(other.conversationId).not.toBe(first.conversationId);
  });

  it("steps back after a reply from the WhatsApp Business app, and comes back once the pause lapses", async () => {
    const ids = await seedAgent();
    const first = await send(ids, "263770000003", "Do you deliver?");
    await loop.recordBusinessAppReply({ prisma } as never, {
      ...ids,
      channel: "WHATSAPP",
      customerIdentifier: { type: "whatsapp_phone_number", value: "263770000003" },
      text: "Yes, we deliver in Harare.",
    });

    const paused = await send(ids, "263770000003", "Great, how long does it take?");
    expect(paused.conversationId).toBe(first.conversationId);
    expect(paused.humanTakeoverActive).toBe(true);
    const staffMessages = await withTenant(prisma, { tenantId: ids.tenantId }, (tx) =>
      tx.message.count({ where: { conversationId: first.conversationId, role: "staff" } }),
    );
    expect(staffMessages).toBe(1);

    // Pretend the last staff reply was longer ago than the pause.
    await withTenant(prisma, { tenantId: ids.tenantId }, (tx) =>
      tx.conversation.update({
        where: { id: first.conversationId },
        data: { takenOverAt: new Date(Date.now() - loop.BUSINESS_APP_REPLY_PAUSE_MS - 60_000) },
      }),
    );
    const resumed = await send(ids, "263770000003", "Anyone there?");
    expect(resumed.humanTakeoverActive).toBeFalsy();
    expect(resumed.reply).toBe("ok");
  });
});
