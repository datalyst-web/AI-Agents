import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { createPrismaClient, withPlatformContext, withTenant, type PrismaClient, type Prisma } from "@chat-agent/db";
import { EnvSecretsProvider } from "@chat-agent/secrets";
import { buildToolRegistryForAgent } from "./toolRegistryForAgent.js";

/**
 * Security regression coverage: buildToolRegistryForAgent.test.ts already
 * covers execution-tier logic against a fake, hand-typed Prisma tx (no real
 * filtering happens there — the mock just returns whatever rows the test
 * hands it). What that file can't prove is the actual DB-level tenant scope
 * on the query itself, which is the real backstop against a very concrete
 * attack shape: agents.routes.ts's PATCH .../enabledToolIds only validates
 * that each id is a UUID (see CreateAgentSchema/UpdateAgentSchema) — it
 * never checks the id actually belongs to a ToolDefinition owned by this
 * tenant. If a tenant_agent_editor ever obtained another tenant's tool id
 * (leaked in an error message, guessed, whatever) and pasted it into their
 * own agent's enabledToolIds, the ONLY thing standing between that and the
 * AI actually being handed a foreign tenant's tool is buildToolRegistryForAgent's
 * `where: { tenantId: params.tenantId, ... }` filter — this proves that
 * filter holds against a real, RLS-enforced connection, not just that the
 * code reads correctly.
 *
 * Note: ToolRegistry.listToolSpecs() surfaces each tool by its HANDLER's
 * fixed name (e.g. "call_webhook", "call_external_api" — one per
 * category/factory), never the ToolDefinition row's own `name` column —
 * so telling "tenant A's tool" and "tenant B's tool" apart in the returned
 * spec list requires giving them different categories, not different
 * ToolDefinition names.
 */
describe.skipIf(!process.env.CHAT_APP_DATABASE_URL)("buildToolRegistryForAgent — cross-tenant tool isolation (real chat_app_user connection)", () => {
  let prisma: PrismaClient;
  const secrets = new EnvSecretsProvider();
  const noopRetrieve = async () => [];
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    prisma = createPrismaClient(process.env.CHAT_APP_DATABASE_URL as string);
    await connectWithRetry(prisma);
  });

  afterAll(async () => {
    await withPlatformContext(prisma, async (tx) => {
      for (const id of createdTenantIds) {
        await tx.tenant.delete({ where: { id } }).catch(() => undefined);
      }
    });
    await prisma.$disconnect();
  });

  async function connectWithRetry(client: PrismaClient, attempts = 4): Promise<void> {
    for (let i = 0; i < attempts; i++) {
      try {
        await client.$queryRaw`SELECT 1`;
        return;
      } catch (err) {
        if (i === attempts - 1) throw err;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  }

  async function seedTenant() {
    const tenant = await withPlatformContext(prisma, (tx) =>
      tx.tenant.create({ data: { name: "Cross-Tenant Tool Test", slug: `xtool-${randomUUID()}`, subscriptionState: "ACTIVE" } }),
    );
    createdTenantIds.push(tenant.id);
    return tenant.id;
  }

  const AGENT_PERSONALITY = {
    tone: "friendly",
    name: "Ava",
    greeting: "Hi!",
    languagePrimary: "en",
    languagesSupported: ["en"],
    systemInstructions: "Be helpful.",
    guardrailPolicy: "PREFER_UNKNOWN_OVER_INVENTED_FACT_CONFIRM_BEFORE_ACTING",
  };

  async function createAgent(tx: Prisma.TransactionClient, tenantId: string, name = "Test Agent") {
    return tx.agent.create({
      data: {
        tenantId,
        name,
        status: "LIVE",
        personality: AGENT_PERSONALITY,
        modelRouting: { failoverChain: ["anthropic", "openai", "gemini"] },
        enabledToolIds: [],
        crossAgentMemoryPeerIds: [],
        createdBySource: "CLIENT",
        createdByUserId: randomUUID(),
        lastEditedBySource: "CLIENT",
        lastEditedByUserId: randomUUID(),
      },
    });
  }

  async function createTool(
    tx: Prisma.TransactionClient,
    tenantId: string,
    category: "webhook" | "api",
    agentId: string | null,
  ) {
    return tx.toolDefinition.create({
      data: {
        tenantId,
        agentId,
        name: `${category} test tool`,
        description: "test tool",
        category,
        inputSchema: {},
        outputSchema: {},
        executionTier: "automatic",
        config: category === "webhook" ? { url: "https://example.invalid/webhook" } : { baseUrl: "https://example.invalid" },
        enabled: true,
      },
    });
  }

  it(
    "never registers another tenant's tool, even when its id is (maliciously or accidentally) present in this tenant's enabledToolIds",
    async () => {
    const tenantAId = await seedTenant();
    const tenantBId = await seedTenant();

    // Tenant A's tool is "webhook" (surfaces as "call_webhook"); tenant B's
    // own tool is "api" (surfaces as "call_external_api") — deliberately
    // different categories so the two are distinguishable in listToolSpecs().
    const tenantATool = await withTenant(prisma, { tenantId: tenantAId }, async (tx) => {
      const agent = await createAgent(tx, tenantAId);
      return createTool(tx, tenantAId, "webhook", agent.id);
    });

    const { agentId: tenantBAgentId, toolId: tenantBToolId } = await withTenant(prisma, { tenantId: tenantBId }, async (tx) => {
      const agent = await createAgent(tx, tenantBId);
      const tool = await createTool(tx, tenantBId, "api", agent.id);
      return { agentId: agent.id, toolId: tool.id };
    });

    const registry = await withTenant(prisma, { tenantId: tenantBId }, (tx) =>
      buildToolRegistryForAgent(tx, secrets, {
        tenantId: tenantBId,
        agentId: tenantBAgentId,
        // The attack: tenant B's enabledToolIds names BOTH its own tool and
        // tenant A's tool id, as if leaked/guessed/injected via a client
        // that only validates UUID shape, not ownership.
        enabledToolIds: [tenantATool.id, tenantBToolId],
        retrieve: noopRetrieve,
      }),
    );

    const names = registry.listToolSpecs().map((t) => t.name);
    expect(names).toContain("call_external_api"); // tenant B's own tool
    expect(names).not.toContain("call_webhook"); // tenant A's tool must never appear
    // Belt-and-suspenders: exactly one non-builtin tool got registered, not two.
    expect(names.filter((n) => n !== "search_knowledge")).toHaveLength(1);
    },
    // Does roughly 2x the setup work of the other tests here (two full
    // tenant+agent+tool seeds instead of one) — the default 30s test
    // timeout is occasionally too tight against a cold-starting free-tier
    // Neon compute, found live while running this suite repeatedly.
    45_000,
  );

  it("never registers a tool scoped to a different agent within the SAME tenant", async () => {
    const tenantId = await seedTenant();
    const { agentUnderTestId, foreignToolId } = await withTenant(prisma, { tenantId }, async (tx) => {
      const agentUnderTest = await createAgent(tx, tenantId, "Agent Under Test");
      const otherAgent = await createAgent(tx, tenantId, "Other Agent");
      const tool = await createTool(tx, tenantId, "webhook", otherAgent.id);
      return { agentUnderTestId: agentUnderTest.id, foreignToolId: tool.id };
    });

    const registry = await withTenant(prisma, { tenantId }, (tx) =>
      buildToolRegistryForAgent(tx, secrets, {
        tenantId,
        agentId: agentUnderTestId,
        enabledToolIds: [foreignToolId],
        retrieve: noopRetrieve,
      }),
    );

    const names = registry.listToolSpecs().map((t) => t.name);
    expect(names).not.toContain("call_webhook");
    expect(names.filter((n) => n !== "search_knowledge")).toHaveLength(0);
  });

  it("DOES register a tenant-wide tool (agentId: null) for any agent under that tenant", async () => {
    const tenantId = await seedTenant();
    const { agentId, toolId } = await withTenant(prisma, { tenantId }, async (tx) => {
      const agent = await createAgent(tx, tenantId);
      const tool = await createTool(tx, tenantId, "webhook", null);
      return { agentId: agent.id, toolId: tool.id };
    });

    const registry = await withTenant(prisma, { tenantId }, (tx) =>
      buildToolRegistryForAgent(tx, secrets, {
        tenantId,
        agentId,
        enabledToolIds: [toolId],
        retrieve: noopRetrieve,
      }),
    );

    const names = registry.listToolSpecs().map((t) => t.name);
    expect(names).toContain("call_webhook");
  });
});
