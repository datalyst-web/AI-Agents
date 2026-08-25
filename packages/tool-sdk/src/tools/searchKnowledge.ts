import { z } from "zod";
import type { ToolExecutionContext } from "@chat-agent/shared-types";
import type { ToolHandler } from "../types.js";

const InputSchema = z.object({
  query: z.string().min(1).describe("The customer's question, rephrased as a search query."),
});
const OutputSchema = z.object({
  chunks: z.array(
    z.object({
      chunkId: z.string(),
      documentId: z.string(),
      knowledgeSourceId: z.string(),
      score: z.number(),
      text: z.string(),
    }),
  ),
});

export type RetrieveFn = (
  query: string,
  ctx: ToolExecutionContext,
) => Promise<z.infer<typeof OutputSchema>["chunks"]>;

/**
 * The Retrieve step of the agent loop, exposed as a tool so the model
 * decides when it needs to look something up rather than always front-
 * loading full-corpus context. `retrieve` is injected by apps/api (backed
 * by packages/rag's searchChunks(), already tenant+agent scoped) to avoid
 * a circular dependency between tool-sdk and rag.
 */
export function createSearchKnowledgeTool(retrieve: RetrieveFn): ToolHandler<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  return {
    category: "search_knowledge",
    name: "search_knowledge",
    description:
      "Searches this business's knowledge base (docs, FAQs, policies, prices) for information relevant to the customer's question. Always prefer this over guessing.",
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    defaultExecutionTier: "automatic",
    async execute(input, ctx) {
      const started = Date.now();
      try {
        const chunks = await retrieve(input.query, ctx);
        return {
          succeeded: true,
          output: { chunks },
          confirmedByProvider: true,
          durationMs: Date.now() - started,
        };
      } catch (err) {
        return {
          succeeded: false,
          errorMessage: err instanceof Error ? err.message : String(err),
          confirmedByProvider: false,
          durationMs: Date.now() - started,
        };
      }
    },
  };
}
