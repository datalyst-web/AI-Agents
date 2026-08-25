import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolExecutionContext, ToolExecutionResult } from "@chat-agent/shared-types";
import type { SecretsProvider } from "@chat-agent/secrets";
import type { ToolHandler, PendingConfirmation } from "./types.js";
import { ToolExecutionDenied } from "./types.js";

export interface RegisteredToolInstance {
  /** The tenant's ToolDefinition.id from packages/db. */
  toolId: string;
  handler: ToolHandler;
  credentialRef?: string;
  enabled: boolean;
}

/**
 * Runtime registry the agent-engine (apps/api) consults per conversation:
 * "which tools is this agent authorized to use, and how do I run them
 * safely." The AI must only ever see tools it is authorized to use for
 * that tenant/agent (CLAUDE.md Tool & Action Engine) — callers build a
 * ToolRegistry scoped to exactly the enabled ToolDefinition rows for one
 * agent, never a global registry handed to the model as-is.
 */
export class ToolRegistry {
  private instances = new Map<string, RegisteredToolInstance>();

  constructor(private secrets: SecretsProvider) {}

  register(instance: RegisteredToolInstance): void {
    this.instances.set(instance.toolId, instance);
  }

  /** JSON-schema tool specs to hand the AIProvider — safe to expose to the model. */
  listToolSpecs(): { name: string; description: string; inputJsonSchema: Record<string, unknown> }[] {
    return [...this.instances.values()]
      .filter((i) => i.enabled)
      .map((i) => ({
        name: i.handler.name,
        description: i.handler.description,
        inputJsonSchema: zodToJsonSchema(i.handler.inputSchema) as Record<string, unknown>,
      }));
  }

  private findByName(name: string): RegisteredToolInstance | undefined {
    return [...this.instances.values()].find((i) => i.handler.name === name);
  }

  /**
   * Executes a tool the model requested, enforcing the execution tier:
   *  - automatic: runs immediately.
   *  - confirmation_required: refuses unless `customerConfirmed` is true —
   *    the caller is responsible for having read the action back to the
   *    customer first (CLAUDE.md principle 4/5).
   *  - human_approval: NEVER auto-executes and NEVER unlocked by
   *    `customerConfirmed` — denies with a ToolExecutionDenied whose `tier`
   *    is "human_approval" so the caller routes it to the staff approval
   *    queue (PendingHumanApproval), never to the customer-facing
   *    confirmation flow. Only `staffApproved: true` — set exclusively by
   *    the staff approvals route after an explicit approve action — bypasses
   *    this gate.
   */
  async execute(
    toolName: string,
    rawInput: unknown,
    ctx: ToolExecutionContext,
    opts: { customerConfirmed?: boolean; staffApproved?: boolean } = {},
  ): Promise<ToolExecutionResult> {
    const instance = this.findByName(toolName);
    if (!instance || !instance.enabled) {
      throw new ToolExecutionDenied(
        `Tool "${toolName}" is not enabled for this agent — refusing to execute an unauthorized tool.`,
      );
    }

    const parsed = instance.handler.inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        succeeded: false,
        errorMessage: `Invalid input: ${parsed.error.message}`,
        confirmedByProvider: false,
        durationMs: 0,
      };
    }

    if (instance.handler.defaultExecutionTier === "human_approval" && !opts.staffApproved) {
      throw new ToolExecutionDenied(
        `Tool "${toolName}" requires human approval and cannot be auto-executed. Route to the approval queue instead.`,
        "human_approval",
      );
    }

    if (instance.handler.defaultExecutionTier === "confirmation_required" && !opts.customerConfirmed) {
      throw new ToolExecutionDenied(
        `Tool "${toolName}" requires customer confirmation before executing. Read the action back to the customer first.`,
        "confirmation_required",
      );
    }

    const started = Date.now();
    try {
      const result = await instance.handler.execute(parsed.data, ctx, {
        secrets: this.secrets,
        credentialRef: instance.credentialRef,
      });
      return result;
    } catch (err) {
      return {
        succeeded: false,
        errorMessage: err instanceof Error ? err.message : String(err),
        confirmedByProvider: false,
        durationMs: Date.now() - started,
      };
    }
  }

  /** Builds the read-back prompt for confirmation-gated tools, per CLAUDE.md principle 4. */
  buildConfirmationPrompt(toolName: string, input: unknown): PendingConfirmation {
    const instance = this.findByName(toolName);
    if (!instance) throw new ToolExecutionDenied(`Unknown tool "${toolName}".`);
    return {
      toolCallId: `${toolName}-${Date.now()}`,
      toolId: instance.toolId,
      toolName,
      input,
      confirmationPrompt: `About to run "${instance.handler.description}" with: ${JSON.stringify(
        input,
      )}. Please confirm before I proceed.`,
      requestedAt: new Date().toISOString(),
    };
  }
}
