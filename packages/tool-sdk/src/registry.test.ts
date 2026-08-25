import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "./registry.js";
import { ToolExecutionDenied } from "./types.js";
import type { ToolHandler } from "./types.js";
import type { ToolExecutionContext } from "@chat-agent/shared-types";

/**
 * Covers the execution-tier enforcement logic in registry.ts — the subject
 * of two recent bug fixes: human_approval used to be indistinguishable from
 * confirmation_required, and `staffApproved` must only bypass human_approval,
 * never confirmation_required (CLAUDE.md principle 5: cancelling
 * appointments / sensitive actions must never be auto-executed, and a
 * human_approval denial must never be resolvable by the customer's own
 * confirmation).
 */

const ctx: ToolExecutionContext = {
  tenantId: "tenant-1",
  agentId: "agent-1",
  conversationId: "conv-1",
  invokedByRole: "agent",
};

// Fake SecretsProvider — the registry only threads it through to handlers,
// none of these test handlers touch it.
const fakeSecrets = {
  getSecret: vi.fn(async () => undefined),
  setSecret: vi.fn(async () => undefined),
};

function makeHandler(
  name: string,
  tier: "automatic" | "confirmation_required" | "human_approval",
  execute = vi.fn(async () => ({
    succeeded: true,
    output: { ok: true },
    confirmedByProvider: true,
    durationMs: 1,
  })),
): ToolHandler {
  return {
    category: "custom",
    name,
    description: `test tool at tier ${tier}`,
    inputSchema: z.object({ value: z.string().optional() }),
    outputSchema: z.object({ ok: z.boolean() }),
    defaultExecutionTier: tier,
    execute,
  };
}

function registryWith(handler: ToolHandler): ToolRegistry {
  const registry = new ToolRegistry(fakeSecrets);
  registry.register({ toolId: `builtin:${handler.name}`, handler, enabled: true });
  return registry;
}

describe("ToolRegistry.execute — execution tier enforcement", () => {
  it("automatic tools execute immediately without any denial", async () => {
    const execute = vi.fn(async () => ({
      succeeded: true,
      output: { ok: true },
      confirmedByProvider: true,
      durationMs: 1,
    }));
    const registry = registryWith(makeHandler("auto_tool", "automatic", execute));

    const result = await registry.execute("auto_tool", {}, ctx);

    expect(result.succeeded).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("confirmation_required tools throw ToolExecutionDenied tagged with tier 'confirmation_required' when not confirmed", async () => {
    const execute = vi.fn();
    const registry = registryWith(makeHandler("confirm_tool", "confirmation_required", execute));

    await expect(registry.execute("confirm_tool", {}, ctx)).rejects.toMatchObject({
      name: "ToolExecutionDenied",
      tier: "confirmation_required",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("confirmation_required tools execute once customerConfirmed is true", async () => {
    const execute = vi.fn(async () => ({
      succeeded: true,
      output: { ok: true },
      confirmedByProvider: true,
      durationMs: 1,
    }));
    const registry = registryWith(makeHandler("confirm_tool", "confirmation_required", execute));

    const result = await registry.execute("confirm_tool", {}, ctx, { customerConfirmed: true });

    expect(result.succeeded).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("confirmation_required tools are NOT bypassed by staffApproved alone", async () => {
    const execute = vi.fn();
    const registry = registryWith(makeHandler("confirm_tool", "confirmation_required", execute));

    await expect(
      registry.execute("confirm_tool", {}, ctx, { staffApproved: true }),
    ).rejects.toMatchObject({
      name: "ToolExecutionDenied",
      tier: "confirmation_required",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("human_approval tools throw ToolExecutionDenied tagged with tier 'human_approval' by default", async () => {
    const execute = vi.fn();
    const registry = registryWith(makeHandler("approval_tool", "human_approval", execute));

    await expect(registry.execute("approval_tool", {}, ctx)).rejects.toMatchObject({
      name: "ToolExecutionDenied",
      tier: "human_approval",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("human_approval tools are NOT bypassed by customerConfirmed alone", async () => {
    const execute = vi.fn();
    const registry = registryWith(makeHandler("approval_tool", "human_approval", execute));

    await expect(
      registry.execute("approval_tool", {}, ctx, { customerConfirmed: true }),
    ).rejects.toMatchObject({
      name: "ToolExecutionDenied",
      tier: "human_approval",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("human_approval tools ARE allowed through with staffApproved: true", async () => {
    const execute = vi.fn(async () => ({
      succeeded: true,
      output: { ok: true },
      confirmedByProvider: true,
      durationMs: 1,
    }));
    const registry = registryWith(makeHandler("approval_tool", "human_approval", execute));

    const result = await registry.execute("approval_tool", {}, ctx, { staffApproved: true });

    expect(result.succeeded).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("refuses to execute a tool that isn't registered/enabled", async () => {
    const registry = new ToolRegistry(fakeSecrets);
    await expect(registry.execute("nonexistent", {}, ctx)).rejects.toThrow(ToolExecutionDenied);
  });

  it("refuses a disabled tool even though it's registered", async () => {
    const registry = new ToolRegistry(fakeSecrets);
    registry.register({ toolId: "builtin:disabled_tool", handler: makeHandler("disabled_tool", "automatic"), enabled: false });
    await expect(registry.execute("disabled_tool", {}, ctx)).rejects.toThrow(ToolExecutionDenied);
  });

  it("returns a non-throwing failure result for invalid input rather than a denial", async () => {
    const execute = vi.fn();
    const registry = registryWith(makeHandler("auto_tool", "automatic", execute));

    const result = await registry.execute("auto_tool", { value: 123 }, ctx);

    expect(result.succeeded).toBe(false);
    expect(result.errorMessage).toMatch(/Invalid input/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("catches a handler throwing and returns a failed (not thrown) result", async () => {
    const execute = vi.fn(async () => {
      throw new Error("downstream boom");
    });
    const registry = registryWith(makeHandler("auto_tool", "automatic", execute));

    const result = await registry.execute("auto_tool", {}, ctx);

    expect(result.succeeded).toBe(false);
    expect(result.errorMessage).toBe("downstream boom");
  });
});

describe("ToolRegistry.buildConfirmationPrompt", () => {
  it("builds a customer-facing confirmation prompt referencing the tool description", () => {
    const registry = registryWith(makeHandler("confirm_tool", "confirmation_required"));
    const pending = registry.buildConfirmationPrompt("confirm_tool", { value: "x" });
    expect(pending.toolName).toBe("confirm_tool");
    expect(pending.confirmationPrompt).toContain("test tool at tier confirmation_required");
    expect(pending.confirmationPrompt.toLowerCase()).toContain("confirm");
  });

  it("throws for an unknown tool name", () => {
    const registry = new ToolRegistry(fakeSecrets);
    expect(() => registry.buildConfirmationPrompt("nope", {})).toThrow(ToolExecutionDenied);
  });
});
