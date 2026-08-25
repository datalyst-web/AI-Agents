import { describe, it, expect, vi } from "vitest";
import { buildToolRegistryForAgent } from "./toolRegistryForAgent.js";
import { EnvSecretsProvider } from "@chat-agent/secrets";
import type { Prisma } from "@chat-agent/db";

/**
 * Covers resolveExecutionTier()'s tier-floor/override behavior (not
 * exported directly, so exercised through buildToolRegistryForAgent +
 * ToolRegistry.execute, which is the actual runtime seam apps/api relies
 * on). This is the fix that made a tenant's dashboard-configured
 * executionTier actually take effect at runtime, while still enforcing
 * that `cancel_appointment` can never be configured below
 * "confirmation_required" (CLAUDE.md: cancelling appointments must never
 * be auto-executed) — no live DB needed, just a fake Prisma
 * TransactionClient whose toolDefinition.findMany returns fixed rows.
 */

function fakeTx(rows: Record<string, unknown>[]): Prisma.TransactionClient {
  return {
    toolDefinition: {
      findMany: vi.fn(async () => rows),
    },
  } as unknown as Prisma.TransactionClient;
}

const baseParams = {
  tenantId: "tenant-1",
  agentId: "agent-1",
  retrieve: vi.fn(async () => []),
};

describe("buildToolRegistryForAgent — tenant-configured tier floors/overrides", () => {
  it("clamps cancel_appointment UP to its confirmation_required floor even if a tenant configures 'automatic'", async () => {
    const tx = fakeTx([
      {
        id: "tool-1",
        tenantId: "tenant-1",
        agentId: null,
        name: "cancel_appointment",
        category: "calendar",
        config: { action: "cancel", baseUrl: "https://example.com" },
        executionTier: "automatic", // attempted downgrade
        credentialRef: null,
        enabled: true,
      },
    ]);

    const registry = await buildToolRegistryForAgent(tx, new EnvSecretsProvider(), {
      ...baseParams,
      enabledToolIds: ["tool-1"],
    });

    // automatic (no confirmation) execution must still be denied for cancel_appointment.
    await expect(
      registry.execute(
        "cancel_appointment",
        { bookingId: "b1" },
        { tenantId: "tenant-1", agentId: "agent-1", conversationId: "c1", invokedByRole: "agent" },
      ),
    ).rejects.toMatchObject({ name: "ToolExecutionDenied", tier: "confirmation_required" });
  });

  it("honors a tenant raising a tool's tier above its factory default (webhook -> human_approval)", async () => {
    const tx = fakeTx([
      {
        id: "tool-2",
        tenantId: "tenant-1",
        agentId: null,
        name: "call_webhook",
        category: "webhook",
        config: { url: "https://example.com/hook" },
        executionTier: "human_approval", // raised above the factory default of confirmation_required
        credentialRef: null,
        enabled: true,
      },
    ]);

    const registry = await buildToolRegistryForAgent(tx, new EnvSecretsProvider(), {
      ...baseParams,
      enabledToolIds: ["tool-2"],
    });

    await expect(
      registry.execute(
        "call_webhook",
        { payload: {} },
        { tenantId: "tenant-1", agentId: "agent-1", conversationId: "c1", invokedByRole: "agent" },
        { customerConfirmed: true }, // a customer confirmation must NOT be enough now that it's human_approval
      ),
    ).rejects.toMatchObject({ name: "ToolExecutionDenied", tier: "human_approval" });
  });

  it("honors a tenant lowering a non-floored tool's tier (webhook -> automatic)", async () => {
    const tx = fakeTx([
      {
        id: "tool-3",
        tenantId: "tenant-1",
        agentId: null,
        name: "call_webhook",
        category: "webhook",
        // Loopback + a closed port so the fetch fails fast (connection
        // refused) instead of waiting on a real DNS/network round trip in
        // a sandboxed test environment — we only care that execute()
        // doesn't throw a denial, not that the webhook call itself succeeds.
        config: { url: "http://127.0.0.1:1/hook" },
        executionTier: "automatic",
        credentialRef: null,
        enabled: true,
      },
    ]);

    const registry = await buildToolRegistryForAgent(tx, new EnvSecretsProvider(), {
      ...baseParams,
      enabledToolIds: ["tool-3"],
    });

    // Executes without throwing a denial (it will still fail at the network
    // fetch since https://example.com/hook isn't real, but it must not be
    // denied for lack of confirmation).
    const result = await registry.execute(
      "call_webhook",
      { payload: {} },
      { tenantId: "tenant-1", agentId: "agent-1", conversationId: "c1", invokedByRole: "agent" },
    );
    // succeeded may be false (network failure in test env), but the point
    // is execute() didn't throw ToolExecutionDenied for missing confirmation.
    expect(result).toHaveProperty("succeeded");
  });

  it("always registers search_knowledge as enabled regardless of enabledToolIds", async () => {
    const tx = fakeTx([]);
    const registry = await buildToolRegistryForAgent(tx, new EnvSecretsProvider(), {
      ...baseParams,
      enabledToolIds: [],
    });
    const specs = registry.listToolSpecs();
    expect(specs.map((s) => s.name)).toContain("search_knowledge");
  });
});
