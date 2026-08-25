import { describe, it, expect, vi } from "vitest";
import { writeCrossConversationFact, getCrossConversationFacts } from "./facts.js";
import type { Prisma } from "@chat-agent/db";

function fakeTx(overrides: {
  create?: ReturnType<typeof vi.fn>;
  findMany?: ReturnType<typeof vi.fn>;
}): Prisma.TransactionClient {
  return {
    crossConversationMemoryFact: {
      create: overrides.create ?? vi.fn(async () => ({ id: "fact-1" })),
      findMany: overrides.findMany ?? vi.fn(async () => []),
    },
  } as unknown as Prisma.TransactionClient;
}

const baseParams = {
  tenantId: "tenant-1",
  agentId: "agent-1",
  customerIdentityId: "cust-1",
  fact: "My email is jane@example.com",
  sourceConversationId: "conv-1",
  sourceMessageId: "msg-1",
  confidence: 0.7,
};

describe("writeCrossConversationFact", () => {
  it("writes the fact tenant/agent/customer-scoped, with no retention set -> no expiresAt", async () => {
    const create = vi.fn(async () => ({ id: "fact-1" }));
    const tx = fakeTx({ create });

    const result = await writeCrossConversationFact(tx, baseParams);

    expect(result).toEqual({ id: "fact-1" });
    expect(create).toHaveBeenCalledTimes(1);
    const callArg = create.mock.calls[0][0];
    expect(callArg.data).toMatchObject({
      tenantId: "tenant-1",
      agentId: "agent-1",
      customerIdentityId: "cust-1",
      fact: baseParams.fact,
      sourceConversationId: "conv-1",
      sourceMessageId: "msg-1",
      confidence: 0.7,
    });
    expect(callArg.data.expiresAt).toBeUndefined();
    expect(typeof callArg.data.id).toBe("string");
  });

  it("computes expiresAt from retentionDays when provided", async () => {
    const create = vi.fn(async () => ({ id: "fact-2" }));
    const tx = fakeTx({ create });
    const before = Date.now();

    await writeCrossConversationFact(tx, { ...baseParams, retentionDays: 30 });

    const callArg = create.mock.calls[0][0];
    const expiresAt: Date = callArg.data.expiresAt;
    expect(expiresAt).toBeInstanceOf(Date);
    const deltaMs = expiresAt.getTime() - before;
    // ~30 days, allow a little slack for test execution time.
    expect(deltaMs).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(deltaMs).toBeLessThan(31 * 24 * 60 * 60 * 1000);
  });
});

describe("getCrossConversationFacts", () => {
  it("queries scoped to tenant/agent/customerIdentity and excludes expired facts", async () => {
    const findMany = vi.fn(async () => [{ fact: "loves espresso", confidence: 0.9, createdAt: new Date() }]);
    const tx = fakeTx({ findMany });

    const facts = await getCrossConversationFacts(tx, {
      tenantId: "tenant-1",
      agentId: "agent-1",
      customerIdentityId: "cust-1",
    });

    expect(facts).toHaveLength(1);
    const callArg = findMany.mock.calls[0][0];
    expect(callArg.where).toMatchObject({
      tenantId: "tenant-1",
      agentId: "agent-1",
      customerIdentityId: "cust-1",
    });
    // OR [{expiresAt: null}, {expiresAt: {gt: now}}] — never-expired-or-still-live facts only.
    expect(callArg.where.OR).toEqual([
      { expiresAt: null },
      { expiresAt: { gt: expect.any(Date) } },
    ]);
  });
});
