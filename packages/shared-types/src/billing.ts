export interface UsageRecord {
  id: string;
  tenantId: string;
  agentId: string;
  conversationId?: string;
  requestId: string;
  provider: "anthropic" | "openai" | "gemini";
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd?: number;
  timestamp: string;
}

export const BillingSkuTypeSchema_values = [
  "SUBSCRIPTION",
  "AI_INFERENCE_OVERAGE",
  "MANAGED_SETUP_ONE_TIME",
  "MANAGED_SETUP_RECURRING_MAINTENANCE",
] as const;
export type BillingSkuType = (typeof BillingSkuTypeSchema_values)[number];

export interface BillingLineItem {
  id: string;
  tenantId: string;
  skuType: BillingSkuType;
  description: string;
  amountUsd: number;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
}

export interface UsageLimits {
  tenantId: string;
  includedConversationsPerMonth: number;
  includedTokensPerMonth: number;
  overageRatePerThousandTokensUsd: number;
  hardCapTokensPerMonth?: number;
}
