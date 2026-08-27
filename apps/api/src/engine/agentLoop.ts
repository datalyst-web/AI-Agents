import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@chat-agent/db";
import { withTenant, Prisma } from "@chat-agent/db";
import type { ModelRouter, ChatMessage } from "@chat-agent/ai-provider";
import type { SecretsProvider } from "@chat-agent/secrets";
import type { QueueClient } from "@chat-agent/queue";
import { retrieveKnowledge } from "@chat-agent/rag";
import { resolveCustomerIdentity, getCrossConversationFacts, writeCrossConversationFact } from "@chat-agent/memory-engine";
import { ToolExecutionDenied } from "@chat-agent/tool-sdk";
import {
  AgentPersonalitySchema,
  ModelRoutingPreferenceSchema,
  type ToolInvocationRecord,
  type RetrievedKnowledgeChunk,
  type HandoffSummary,
} from "@chat-agent/shared-types";
import { fireWorkflowTrigger } from "@chat-agent/workflow-engine";
import { buildToolRegistryForAgent } from "./toolRegistryForAgent.js";
import { scoreSentiment, shouldEscalateOnSentiment } from "./sentiment.js";
import { writeAuditLog } from "../lib/audit.js";
import { env } from "../env.js";

// Exported so apps/api/src/routes/approvals.routes.ts can build the same
// tenant-scoped ToolRegistry (via buildToolRegistryForAgent) when a staff
// member approves a human_approval-gated tool call outside this loop.
export const EMBEDDING_MODEL = "text-embedding-3-small";
const MAX_TOOL_ITERATIONS = 4;

/**
 * Sentinel actorUserId for audit entries produced by the agent loop itself
 * (a cross-conversation memory write during a live conversation — no human
 * staff member or customer account initiated it, and no User row exists
 * for this id). writeAuditLog's actorIsStaff still resolves to false here
 * since the TenantContext passed in carries no impersonation claim.
 */
const SYSTEM_AGENT_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

export interface IncomingMessage {
  tenantId: string;
  agentId: string;
  conversationId?: string;
  channel: "WIDGET" | "STANDALONE_URL" | "API";
  customerMessage: string;
  customerIdentifier?: { type: "authenticated_account" | "email" | "widget_session_cookie"; value: string };
  /** The server-generated id from a previous PendingConfirmationResponse, echoed back by the client. */
  confirmToolCallId?: string;
}

export interface PendingConfirmationResponse {
  toolCallId: string;
  toolName: string;
  input: unknown;
  confirmationPrompt: string;
}

export interface AgentTurnResult {
  conversationId: string;
  reply: string;
  pendingConfirmation?: PendingConfirmationResponse;
  toolInvocations: ToolInvocationRecord[];
  handoffTriggered: boolean;
  handoffSummary?: HandoffSummary;
}

interface StoredPendingToolCall {
  id: string;
  toolName: string;
  input: unknown;
  confirmationPrompt: string;
}

const GUARDRAIL_SYSTEM_TEXT = `
You must never invent facts, prices, availability, policies, or the outcome of a tool call.
If you don't know something and the knowledge base doesn't have it, say so plainly and offer to
connect the customer with a human — do not guess. Before taking any action that will be acted on
(a booking, a cancellation, an email, an order), describe exactly what you are about to do and wait
for the customer's confirmation unless the tool is explicitly automatic. Never claim an action
succeeded unless the tool result explicitly confirms it.`.trim();

/**
 * The full CLAUDE.md loop: Understand -> Retrieve -> Reason -> Decide ->
 * Act -> Verify -> Respond -> Record. One call handles exactly one
 * customer turn; everything (messages, sentiment, memory writes, usage)
 * is written atomically inside a single withTenant() transaction so a
 * failure partway through never leaves a half-recorded conversation.
 *
 * Confirmation-gated tools (CLAUDE.md principle 4/5) use a server-
 * generated id stored on Conversation.pendingToolCall, resolved by exact
 * id match on the customer's next turn — never by asking the model to
 * re-emit an identical tool call, which isn't guaranteed to reproduce the
 * same arguments (or to happen at all) and would otherwise make
 * confirmation unreliable for the exact actions CLAUDE.md treats as
 * highest-risk.
 */
export async function processCustomerMessage(
  deps: { prisma: PrismaClient; router: ModelRouter; secrets: SecretsProvider; queue: QueueClient },
  input: IncomingMessage,
): Promise<AgentTurnResult> {
  return withTenant(deps.prisma, { tenantId: input.tenantId, agentId: input.agentId }, async (tx) => {
    // ---- UNDERSTAND -------------------------------------------------------
    const agent = await tx.agent.findFirstOrThrow({
      where: { id: input.agentId, tenantId: input.tenantId },
    });
    if (agent.status !== "LIVE" && agent.status !== "TESTING") {
      throw new Error(`Agent ${agent.id} is not reachable in status ${agent.status}.`);
    }
    const personality = AgentPersonalitySchema.parse(agent.personality);
    const modelRouting = ModelRoutingPreferenceSchema.parse(agent.modelRouting);

    let customerIdentityId: string | undefined;
    let priorFacts: { fact: string }[] = [];
    if (input.customerIdentifier) {
      const identity = await resolveCustomerIdentity(tx, {
        tenantId: input.tenantId,
        agentId: input.agentId,
        identifierType: input.customerIdentifier.type,
        identifierValue: input.customerIdentifier.value,
      });
      customerIdentityId = identity.id;
      priorFacts = await getCrossConversationFacts(tx, {
        tenantId: input.tenantId,
        agentId: input.agentId,
        customerIdentityId,
      });
    }

    const conversation = input.conversationId
      ? await tx.conversation.findFirstOrThrow({ where: { id: input.conversationId, tenantId: input.tenantId } })
      : await tx.conversation.create({
          data: {
            id: randomUUID(),
            tenantId: input.tenantId,
            agentId: input.agentId,
            channel: input.channel,
            customerIdentityId,
            outcome: "IN_PROGRESS",
            dropOffPoint: "NONE",
            sentimentTrend: [],
          },
        });

    const history = await tx.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
      take: 40,
    });

    const toolRegistry = await buildToolRegistryForAgent(tx, deps.secrets, {
      tenantId: input.tenantId,
      agentId: input.agentId,
      enabledToolIds: agent.enabledToolIds,
      retrieve: async (query) => {
        const results = await retrieveKnowledge(tx, deps.router, {
          tenantId: input.tenantId,
          agentId: input.agentId,
          query,
          embeddingModel: EMBEDDING_MODEL,
        });
        return results.map((r) => ({
          chunkId: r.chunkId,
          documentId: r.documentId,
          knowledgeSourceId: r.knowledgeSourceId,
          score: r.score,
          text: r.textSnippet,
        }));
      },
    });

    const toolInvocations: ToolInvocationRecord[] = [];
    let pendingConfirmation: PendingConfirmationResponse | undefined;
    // Distinct from pendingConfirmation: a human_approval tool denial never
    // becomes a customer-facing confirmation (CLAUDE.md principle 5 — "never
    // auto-executed... a staff member must approve"). This only stops the
    // tool-calling loop for the current turn; the actual pending state lives
    // in the PendingHumanApproval row created below, not on the conversation.
    let humanApprovalRequested = false;
    let retrievedKnowledge: RetrievedKnowledgeChunk[] = [];
    let finalText = "";

    const storedPending = conversation.pendingToolCall as StoredPendingToolCall | null;
    const resolvingConfirmation = Boolean(storedPending && input.confirmToolCallId === storedPending.id);
    const staleConfirmationAbandoned = Boolean(storedPending && !resolvingConfirmation);

    if (resolvingConfirmation && storedPending) {
      // ---- ACT (deterministic — no model decision needed to resolve a
      // confirmation the customer already explicitly agreed to) -----------
      // Only confirmation_required tools ever reach Conversation.pendingToolCall
      // (see the tool-calling loop below), so storedPending should never
      // name a human_approval tool. Still wrapped in try/catch: a tool's
      // executionTier can be reconfigured between turns (e.g. tenant staff
      // raises it to human_approval after this confirmation was minted), and
      // a ToolExecutionDenied must never propagate uncaught into a 502
      // (CLAUDE.md: a failed action is logged and notifies a configured
      // fallback, never fails silently or fails open).
      try {
        const execResult = await toolRegistry.execute(
          storedPending.toolName,
          storedPending.input,
          { tenantId: input.tenantId, agentId: input.agentId, conversationId: conversation.id, invokedByRole: "agent" },
          { customerConfirmed: true },
        );

        toolInvocations.push({
          toolId: storedPending.id,
          toolName: storedPending.toolName,
          input: storedPending.input,
          output: execResult.output,
          succeeded: execResult.succeeded,
          errorMessage: execResult.errorMessage,
          executionTier: "confirmation_required",
          confirmedByCustomer: true,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });

        // ---- VERIFY / RESPOND — a narrow follow-up call to phrase the
        // outcome in the agent's voice. The model is only ever shown the
        // *actual* succeeded/confirmed flags, so it cannot claim success
        // that didn't happen, per CLAUDE.md principle 4.
        const followUpMessages: ChatMessage[] = [
          {
            role: "system",
            content: [
              personality.systemInstructions,
              GUARDRAIL_SYSTEM_TEXT,
              `You just executed "${storedPending.toolName}" because the customer confirmed it. Result: ${JSON.stringify(
                {
                  succeeded: execResult.succeeded,
                  confirmed: execResult.confirmedByProvider,
                  output: execResult.output,
                  error: execResult.errorMessage,
                },
              )}. In one or two sentences, tell the customer the outcome in your own voice. If "confirmed" is not true, apologize and offer to help another way — never say it succeeded unless "confirmed" is true.`,
            ].join("\n\n"),
          },
          { role: "user", content: input.customerMessage },
        ];
        const followUp = await deps.router.generate({
          messages: followUpMessages,
          failoverChain: modelRouting.failoverChain,
          preferredProvider: modelRouting.preferredProvider,
          anthropicModelTier: modelRouting.anthropicModelTier,
          maxOutputTokens: 300,
        });
        await recordUsage(tx, {
          tenantId: input.tenantId,
          agentId: input.agentId,
          conversationId: conversation.id,
          provider: followUp.provider,
          modelId: followUp.model,
          inputTokens: followUp.usage.inputTokens,
          outputTokens: followUp.usage.outputTokens,
        });
        finalText = followUp.content;
      } catch (err) {
        if (!(err instanceof ToolExecutionDenied)) throw err;
        toolInvocations.push({
          toolId: storedPending.id,
          toolName: storedPending.toolName,
          input: storedPending.input,
          output: undefined,
          succeeded: false,
          errorMessage: err.message,
          executionTier: err.tier ?? "confirmation_required",
          confirmedByCustomer: true,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
        // toolInvocations now contains a failed entry, so the existing
        // TOOL_FAILURE workflow trigger below fires and notifies the
        // tenant's configured fallback — reusing that path rather than
        // inventing a new notification mechanism here.
        finalText =
          "Sorry, I wasn't able to complete that action. Our team has been notified and will follow up.";
      }
    } else {
      // ---- RETRIEVE -----------------------------------------------------
      try {
        retrievedKnowledge = await retrieveKnowledge(tx, deps.router, {
          tenantId: input.tenantId,
          agentId: input.agentId,
          query: input.customerMessage,
          embeddingModel: EMBEDDING_MODEL,
          limit: 5,
        });
      } catch {
        // Knowledge base may be empty/not yet embedded — proceed without
        // grounding rather than failing the whole turn; the guardrail
        // instructs the model to say "I don't know" rather than invent facts.
        retrievedKnowledge = [];
      }

      const systemPrompt = [
        personality.systemInstructions,
        GUARDRAIL_SYSTEM_TEXT,
        priorFacts.length
          ? `Known facts about this returning customer (only reference these if relevant, and never claim they said something they didn't):\n${priorFacts.map((f) => `- ${f.fact}`).join("\n")}`
          : "",
        retrievedKnowledge.length
          ? `Relevant knowledge base excerpts:\n${retrievedKnowledge.map((k) => `- ${k.textSnippet}`).join("\n")}`
          : "No knowledge base excerpts matched this query — do not invent an answer.",
      ]
        .filter(Boolean)
        .join("\n\n");

      const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        ...history.map((m): ChatMessage => ({
          role: m.role === "customer" ? "user" : m.role === "agent" ? "assistant" : "user",
          content: m.content,
        })),
        { role: "user", content: input.customerMessage },
      ];

      // ---- REASON / DECIDE / ACT (agentic tool-calling loop) -------------
      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
        const result = await deps.router.generate({
          messages,
          tools: toolRegistry.listToolSpecs(),
          failoverChain: modelRouting.failoverChain,
          preferredProvider: modelRouting.preferredProvider,
          anthropicModelTier: modelRouting.anthropicModelTier,
          maxOutputTokens: 1024,
        });

        await recordUsage(tx, {
          tenantId: input.tenantId,
          agentId: input.agentId,
          conversationId: conversation.id,
          provider: result.provider,
          modelId: result.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        });

        if (result.finishReason !== "tool_call" || !result.toolCalls?.length) {
          finalText = result.content;
          break;
        }

        messages.push({ role: "assistant", content: result.content, toolCalls: result.toolCalls });

        for (const call of result.toolCalls) {
          try {
            const execResult = await toolRegistry.execute(
              call.name,
              call.arguments,
              { tenantId: input.tenantId, agentId: input.agentId, conversationId: conversation.id, invokedByRole: "agent" },
              { customerConfirmed: false },
            );

            toolInvocations.push({
              toolId: call.id,
              toolName: call.name,
              input: call.arguments,
              output: execResult.output,
              succeeded: execResult.succeeded,
              errorMessage: execResult.errorMessage,
              executionTier: "automatic",
              confirmedByCustomer: false,
              startedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
            });

            messages.push({
              role: "tool",
              toolCallId: call.id,
              toolName: call.name,
              content: JSON.stringify({
                succeeded: execResult.succeeded,
                // VERIFY: the model is only ever shown confirmedByProvider —
                // it cannot report success unless the tool actually confirmed it.
                confirmed: execResult.confirmedByProvider,
                output: execResult.output,
                error: execResult.errorMessage,
              }),
            });
          } catch (err) {
            if (err instanceof ToolExecutionDenied && err.tier === "human_approval") {
              // NEVER minted as a customer-facing pendingConfirmation — a
              // human_approval tool is never resolvable by the customer's
              // own "yes" (CLAUDE.md principle 5). Instead it goes on the
              // staff approval queue; the reply stays neutral and never
              // implies the customer themselves can confirm it.
              const toolCallId = randomUUID();
              await tx.pendingHumanApproval.create({
                data: {
                  id: randomUUID(),
                  tenantId: input.tenantId,
                  agentId: input.agentId,
                  conversationId: conversation.id,
                  toolCallId,
                  toolName: call.name,
                  input: call.arguments as Prisma.InputJsonValue,
                  status: "PENDING",
                },
              });
              toolInvocations.push({
                toolId: call.id,
                toolName: call.name,
                input: call.arguments,
                output: undefined,
                succeeded: false,
                errorMessage: err.message,
                executionTier: "human_approval",
                confirmedByCustomer: false,
                startedAt: new Date().toISOString(),
                completedAt: new Date().toISOString(),
              });
              finalText =
                "That request needs a quick review by our team before we can go ahead — we'll follow up as soon as it's approved.";
              humanApprovalRequested = true;
            } else if (err instanceof ToolExecutionDenied) {
              // confirmation_required — stop the loop, mint a stable
              // server-side id for it, and surface the confirmation prompt.
              // The model's own call.id is NOT used here: it isn't
              // guaranteed stable across turns, so resolving a "yes" against
              // it would be unreliable for exactly the actions CLAUDE.md
              // treats as highest-risk.
              const confirmation = toolRegistry.buildConfirmationPrompt(call.name, call.arguments);
              pendingConfirmation = {
                toolCallId: randomUUID(),
                toolName: call.name,
                input: call.arguments,
                confirmationPrompt: confirmation.confirmationPrompt,
              };
              finalText = confirmation.confirmationPrompt;
            } else {
              throw err;
            }
          }
        }

        if (pendingConfirmation || humanApprovalRequested) break;
      }
    }

    // ---- Handoff / escalation detection ------------------------------------
    const sentimentScore = scoreSentiment(input.customerMessage);
    const sentimentTrend = [...conversation.sentimentTrend, sentimentScore];
    const handoffTriggered =
      shouldEscalateOnSentiment(sentimentTrend) ||
      toolInvocations.some((t) => !t.succeeded) ||
      /\b(human|agent|representative|person)\b/i.test(input.customerMessage);

    let handoffSummary: HandoffSummary | undefined;
    if (handoffTriggered) {
      handoffSummary = {
        customer: customerIdentityId ?? "anonymous",
        request: input.customerMessage,
        problem: finalText,
        informationCollected: { priorFacts: priorFacts.map((f) => f.fact) },
        actionsAttempted: toolInvocations.map((t) => `${t.toolName}: ${t.succeeded ? "succeeded" : "failed"}`),
        recommendedNextStep: toolInvocations.some((t) => !t.succeeded)
          ? "A tool call failed mid-conversation — review before re-attempting the action."
          : "Frustration or explicit human request detected — pick up the conversation directly.",
      };
    }

    // Fire the two triggers this per-turn function can honestly detect —
    // CONVERSATION_ABANDONED/NO_REPLY_TIMEOUT need a time-based view across
    // turns and are fired by apps/workers' conversationTimeoutSweep instead.
    if (shouldEscalateOnSentiment(sentimentTrend)) {
      await fireWorkflowTrigger(tx, deps.queue, {
        tenantId: input.tenantId,
        agentId: input.agentId,
        triggerType: "SENTIMENT_THRESHOLD_CROSSED",
        payload: { conversationId: conversation.id, sentimentScore, sentimentTrend },
        queueTarget: env.SQS_WORKFLOW_RUN_QUEUE_URL,
      });
    }
    const failedTool = toolInvocations.find((t) => !t.succeeded);
    if (failedTool) {
      await fireWorkflowTrigger(tx, deps.queue, {
        tenantId: input.tenantId,
        agentId: input.agentId,
        triggerType: "TOOL_FAILURE",
        payload: { conversationId: conversation.id, toolName: failedTool.toolName, errorMessage: failedTool.errorMessage },
        queueTarget: env.SQS_WORKFLOW_RUN_QUEUE_URL,
      });
    }
    if (handoffTriggered && handoffSummary) {
      // The one trigger a tenant can subscribe to for "notify me whenever
      // this agent hands off to a human," regardless of cause — CLAUDE.md's
      // Human Handoff section expects the summary to actually reach
      // someone, not just get recorded on the conversation row.
      await fireWorkflowTrigger(tx, deps.queue, {
        tenantId: input.tenantId,
        agentId: input.agentId,
        triggerType: "HANDOFF_REQUESTED",
        payload: { conversationId: conversation.id, handoffSummary: handoffSummary as unknown as Record<string, unknown> },
        queueTarget: env.SQS_WORKFLOW_RUN_QUEUE_URL,
      });
    }
    // CRM_FIELD_CHANGE / FORM_SUBMITTED: there's no per-field before/after
    // diff to inspect — a tenant's CRM or webhook/api tool is an opaque
    // integration to us — so "the write actually succeeded" is the
    // honest, correct-altitude signal for both. A tenant that needs
    // finer-grained field-level logic reads it out of the payload's tool
    // output inside the workflow's own condition step.
    for (const invocation of toolInvocations) {
      if (!invocation.succeeded) continue;
      const category = toolRegistry.getCategory(invocation.toolName);
      if (category === "crm") {
        await fireWorkflowTrigger(tx, deps.queue, {
          tenantId: input.tenantId,
          agentId: input.agentId,
          triggerType: "CRM_FIELD_CHANGE",
          payload: { conversationId: conversation.id, toolName: invocation.toolName, output: invocation.output },
          queueTarget: env.SQS_WORKFLOW_RUN_QUEUE_URL,
        });
      } else if (category === "webhook" || category === "api") {
        await fireWorkflowTrigger(tx, deps.queue, {
          tenantId: input.tenantId,
          agentId: input.agentId,
          triggerType: "FORM_SUBMITTED",
          payload: { conversationId: conversation.id, toolName: invocation.toolName, output: invocation.output },
          queueTarget: env.SQS_WORKFLOW_RUN_QUEUE_URL,
        });
      }
    }

    // ---- RESPOND / RECORD ---------------------------------------------------
    await tx.message.create({
      data: {
        id: randomUUID(),
        tenantId: input.tenantId,
        agentId: input.agentId,
        conversationId: conversation.id,
        role: "customer",
        content: input.customerMessage,
        sentimentScore,
      },
    });

    await tx.message.create({
      data: {
        id: randomUUID(),
        tenantId: input.tenantId,
        agentId: input.agentId,
        conversationId: conversation.id,
        role: "agent",
        content: finalText,
        loopTrace: [
          {
            stage: "UNDERSTAND>RETRIEVE>REASON>DECIDE>ACT>VERIFY>RESPOND>RECORD",
            retrievedKnowledge: retrievedKnowledge.map((k) => ({
              chunkId: k.chunkId,
              documentId: k.documentId,
              knowledgeSourceId: k.knowledgeSourceId,
              score: k.score,
              textSnippet: k.textSnippet,
            })),
            toolInvocations,
          },
        ] as unknown as Prisma.InputJsonValue,
      },
    });

    const pendingToolCallForPersist = pendingConfirmation
      ? ({
          id: pendingConfirmation.toolCallId,
          toolName: pendingConfirmation.toolName,
          input: pendingConfirmation.input,
          confirmationPrompt: pendingConfirmation.confirmationPrompt,
        } satisfies StoredPendingToolCall)
      : resolvingConfirmation || staleConfirmationAbandoned
        ? Prisma.DbNull
        : undefined;

    await tx.conversation.update({
      where: { id: conversation.id },
      data: {
        sentimentTrend,
        handoffRequested: handoffTriggered,
        handoffSummary: (handoffSummary as Prisma.InputJsonValue | undefined) ?? undefined,
        pendingToolCall: pendingToolCallForPersist as unknown as Prisma.InputJsonValue | undefined,
        outcome: handoffTriggered ? "ESCALATED_TO_HUMAN" : "IN_PROGRESS",
        dropOffPoint: toolInvocations.some((t) => !t.succeeded) ? "TOOL_EXECUTION" : "NONE",
      },
    });

    // A durable fact is only ever written from something the customer
    // explicitly stated in THIS message, never inferred — kept intentionally
    // conservative (a real implementation would use a small classification
    // pass; wiring that in doesn't change this call site).
    if (customerIdentityId && /\bmy (name|email|phone) is\b/i.test(input.customerMessage)) {
      // priorFacts was fetched at the top of this turn, before this write —
      // zero prior facts means this is the first time we've ever captured
      // real contact info for this identity, i.e. the moment it becomes a
      // lead worth someone following up on. Gated on priorFacts rather than
      // "customerIdentityId is new" so a returning customer who already
      // gave contact info in an earlier conversation doesn't re-fire this
      // every time they restate it.
      if (priorFacts.length === 0) {
        await fireWorkflowTrigger(tx, deps.queue, {
          tenantId: input.tenantId,
          agentId: input.agentId,
          triggerType: "NEW_LEAD",
          payload: { conversationId: conversation.id, customerIdentityId, statedInfo: input.customerMessage },
          queueTarget: env.SQS_WORKFLOW_RUN_QUEUE_URL,
        });
      }
      const fact = await writeCrossConversationFact(tx, {
        tenantId: input.tenantId,
        agentId: input.agentId,
        customerIdentityId,
        fact: input.customerMessage,
        sourceConversationId: conversation.id,
        sourceMessageId: conversation.id,
        confidence: 0.7,
      });
      // Cross-conversation memory writes go through the same audit pipeline
      // as any other agent action (CLAUDE.md Memory Engine section) —
      // there's no human actor for an agent-initiated write mid-conversation,
      // so this uses the well-known system sentinel rather than a real
      // staff/customer user id; actorIsStaff still resolves to false since
      // this TenantContext carries no impersonation claim.
      await writeAuditLog(tx, { tenantId: input.tenantId }, {
        actorUserId: SYSTEM_AGENT_ACTOR_ID,
        agentId: input.agentId,
        action: "memory:cross_conversation_write",
        metadata: {
          factId: fact.id,
          customerIdentityId,
          sourceConversationId: conversation.id,
          confidence: 0.7,
        },
      });
    }

    return {
      conversationId: conversation.id,
      reply: finalText,
      pendingConfirmation,
      toolInvocations,
      handoffTriggered,
      handoffSummary,
    };
  });
}

async function recordUsage(
  tx: Prisma.TransactionClient,
  usage: {
    tenantId: string;
    agentId: string;
    conversationId: string;
    provider: "anthropic" | "openai" | "gemini";
    modelId: string;
    inputTokens: number;
    outputTokens: number;
  },
): Promise<void> {
  await tx.usageRecord.create({
    data: {
      id: randomUUID(),
      tenantId: usage.tenantId,
      agentId: usage.agentId,
      conversationId: usage.conversationId,
      requestId: randomUUID(),
      provider: usage.provider,
      modelId: usage.modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    },
  });
}
