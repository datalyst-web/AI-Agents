import { createCrmCreateRecordTool, createEmailTool, createWebhookTool } from "@chat-agent/tool-sdk";
import type { ActionExecutorMap } from "@chat-agent/workflow-engine";
import type { WorkerContext } from "../context.js";
import { resolveNotifyRecipientEmail } from "../lib/notifyRecipient.js";

/**
 * Maps WorkflowActionType -> a concrete executor, reusing packages/tool-sdk
 * handlers so a workflow's "send an email" and an in-conversation tool
 * call's "send an email" go through identical, already-hardened code
 * rather than a second implementation.
 */
export function buildWorkflowActionExecutors(ctx: WorkerContext): ActionExecutorMap {
  return {
    CALL_WEBHOOK: async (action, execCtx) => {
      const config = action.config as { url?: string; headers?: Record<string, string>; payload?: Record<string, unknown> };
      if (!config.url) return { succeeded: false, errorMessage: "CALL_WEBHOOK action missing config.url" };
      const tool = createWebhookTool({ url: config.url, headers: config.headers });
      const result = await tool.execute(
        { payload: { ...config.payload, trigger: execCtx.triggerPayload } },
        { tenantId: execCtx.tenantId, agentId: execCtx.agentId ?? "", conversationId: "", invokedByRole: "workflow" },
        { secrets: ctx.secrets, credentialRef: undefined },
      );
      return { succeeded: result.succeeded, output: result.output, errorMessage: result.errorMessage };
    },

    SEND_EMAIL: async (action, execCtx) => {
      const config = action.config as { to?: string; subject?: string; body?: string; sendUrl?: string; authHeaderName?: string; fromAddress?: string; credentialRef?: string };
      if (!config.to || !config.subject || !config.body || !config.sendUrl) {
        return { succeeded: false, errorMessage: "SEND_EMAIL action missing to/subject/body/sendUrl config." };
      }
      const tool = createEmailTool({
        sendUrl: config.sendUrl,
        authHeaderName: config.authHeaderName ?? "Authorization",
        fromAddress: config.fromAddress ?? "no-reply@platform.local",
      });
      const result = await tool.execute(
        { to: config.to, subject: config.subject, body: config.body },
        { tenantId: execCtx.tenantId, agentId: execCtx.agentId ?? "", conversationId: "", invokedByRole: "workflow" },
        { secrets: ctx.secrets, credentialRef: config.credentialRef },
      );
      return { succeeded: result.succeeded, output: result.output, errorMessage: result.errorMessage };
    },

    CREATE_CRM_RECORD: async (action, execCtx) => {
      const config = action.config as {
        baseUrl?: string;
        authHeaderName?: string;
        objectTypeToPath?: Record<string, string>;
        objectType?: "lead" | "contact" | "deal";
        fields?: Record<string, unknown>;
        credentialRef?: string;
      };
      if (!config.baseUrl || !config.objectTypeToPath || !config.objectType) {
        return { succeeded: false, errorMessage: "CREATE_CRM_RECORD action missing baseUrl/objectTypeToPath/objectType config." };
      }
      const tool = createCrmCreateRecordTool({
        baseUrl: config.baseUrl,
        authHeaderName: config.authHeaderName ?? "Authorization",
        objectTypeToPath: config.objectTypeToPath,
      });
      const result = await tool.execute(
        { objectType: config.objectType, fields: { ...config.fields, ...execCtx.triggerPayload } },
        { tenantId: execCtx.tenantId, agentId: execCtx.agentId ?? "", conversationId: "", invokedByRole: "workflow" },
        { secrets: ctx.secrets, credentialRef: config.credentialRef },
      );
      return { succeeded: result.succeeded, output: result.output, errorMessage: result.errorMessage };
    },

    SCORE_LEAD: async (action, execCtx) => {
      // Deterministic scoring against tenant-configured field weights —
      // knowledge-driven per CLAUDE.md, not a hard-coded scoring model.
      const weights = (action.config.fieldWeights as Record<string, number>) ?? {};
      let score = 0;
      for (const [field, weight] of Object.entries(weights)) {
        if (execCtx.triggerPayload[field]) score += weight;
      }
      return { succeeded: true, output: { score } };
    },

    CREATE_TICKET: async () => ({ succeeded: false, errorMessage: "CREATE_TICKET requires a tenant-configured ticketing tool credentialRef; wire via TRIGGER_TOOL instead." }),

    // An explicit "notify someone" workflow step (e.g. "New lead -> score
    // -> if HOT -> SEND_NOTIFICATION to sales") — distinct from
    // onFailureNotify, which is the executor's own safety net when ANY
    // action (including this one) fails. Shares the same delivery path
    // (resolveNotifyRecipientEmail + EmailProvider) so there's one real
    // notification mechanism, not two.
    SEND_NOTIFICATION: async (action, execCtx) => {
      const config = action.config as {
        target?: "tenant_owner" | "tenant_admin" | "staff_fallback";
        message?: string;
      };
      const target = config.target ?? "tenant_owner";
      const message = config.message ?? `Workflow notification for tenant ${execCtx.tenantId}: ${JSON.stringify(execCtx.triggerPayload)}`;
      const to = await resolveNotifyRecipientEmail(ctx.prisma, execCtx.tenantId, target);
      if (!to) return { succeeded: false, errorMessage: `No ${target} contact found to notify for this tenant.` };
      const result = await ctx.email.send({ to, subject: "Notification from your AI agent", text: message });
      if (!result.sent) return { succeeded: false, errorMessage: result.error ?? "Email delivery failed." };
      return { succeeded: true, output: { deliveredTo: to } };
    },
    TRIGGER_TOOL: async () => ({ succeeded: false, errorMessage: "TRIGGER_TOOL requires conversation context — not available outside an active conversation." }),
  };
}
