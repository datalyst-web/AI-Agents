import { createPrismaClient, withTenant } from "./client.js";
import bcrypt from "bcryptjs";

/**
 * Dev-only seed: one demo tenant, one owner user, one agent seeded
 * straight into TESTING status. Never run against a production
 * DATABASE_URL — this is for local dev only (run manually via
 * `pnpm --filter @chat-agent/db run seed`).
 *
 * Seeded in TESTING (not DRAFT) deliberately: processCustomerMessage
 * (apps/api/src/engine/agentLoop.ts) only accepts messages for an agent
 * in TESTING or LIVE status, and the dashboard's "Test Agent" tab is the
 * point of this seed — a freshly seeded DRAFT agent couldn't be chatted
 * with at all until someone manually walked it through the publish
 * pipeline first.
 */
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required to seed.");
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run the dev seed script against NODE_ENV=production.");
  }

  const prisma = createPrismaClient(databaseUrl);

  const tenant = await prisma.tenant.upsert({
    where: { slug: "demo" },
    update: {},
    create: {
      name: "Demo Business",
      slug: "demo",
      subscriptionState: "TRIAL",
      subscriptionTier: "GROWTH",
      managedSetupTier: "SELF_SERVE",
    },
  });

  const passwordHash = await bcrypt.hash("dev-password-change-me", 10);
  await prisma.user.upsert({
    where: { email: "owner@demo.local" },
    update: {},
    create: {
      tenantId: tenant.id,
      email: "owner@demo.local",
      passwordHash,
      role: "tenant_owner",
      displayName: "Demo Owner",
    },
  });

  await withTenant(prisma, { tenantId: tenant.id }, async (tx) => {
    const existing = await tx.agent.findFirst({ where: { tenantId: tenant.id } });
    if (existing) return;
    await tx.agent.create({
      data: {
        tenantId: tenant.id,
        name: "Website Assistant",
        status: "TESTING",
        version: "v0.1",
        personality: {
          tone: "friendly",
          name: "Ava",
          greeting: "Hi! I'm Ava, Demo Business's AI assistant. Ask me anything, or try adding a knowledge base FAQ and asking about it!",
          languagePrimary: "en",
          languagesSupported: ["en"],
          systemInstructions:
            "You are Ava, the Demo Business website assistant, currently running in a sales demo. Chat naturally and helpfully. For general conversation, answer normally. For any specific business fact (prices, hours, policies, availability), answer only from the knowledge base excerpts you're given, and say plainly that you don't have that on file yet if none are provided — never invent a business-specific fact.",
          guardrailPolicy: "PREFER_UNKNOWN_OVER_INVENTED_FACT_CONFIRM_BEFORE_ACTING",
        },
        modelRouting: {
          failoverChain: ["anthropic", "openai", "gemini"],
          reasoningEffort: "medium",
        },
        enabledToolIds: [],
        crossAgentMemoryPeerIds: [],
        createdBySource: "CLIENT",
        createdByUserId: (await tx.user.findFirstOrThrow({ where: { tenantId: tenant.id } })).id,
        lastEditedBySource: "CLIENT",
        lastEditedByUserId: (await tx.user.findFirstOrThrow({ where: { tenantId: tenant.id } })).id,
      },
    });
  });

  console.log(`Seeded tenant "${tenant.slug}" (${tenant.id}).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
