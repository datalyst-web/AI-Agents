const NEGATIVE_WORDS = [
  "angry",
  "frustrated",
  "terrible",
  "awful",
  "useless",
  "unacceptable",
  "refund",
  "cancel my",
  "speak to a human",
  "speak to someone",
  "this is ridiculous",
  "worst",
  "scam",
];
const POSITIVE_WORDS = ["thanks", "thank you", "great", "awesome", "perfect", "love it", "appreciate"];

/**
 * Lightweight lexical heuristic used as the default sentiment signal so
 * the escalation/workflow triggers in CLAUDE.md ("sentiment threshold
 * crossed") have something to run against without a hard dependency on a
 * paid classification call per turn. Swap for a proper model-based
 * classifier (routed through AIProvider, never a bespoke SDK) once volume
 * justifies the added latency/cost — the interface (string in, -1..1 out)
 * is deliberately model-agnostic so that swap doesn't touch call sites.
 */
export function scoreSentiment(text: string): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const w of NEGATIVE_WORDS) if (lower.includes(w)) score -= 0.3;
  for (const w of POSITIVE_WORDS) if (lower.includes(w)) score += 0.2;
  return Math.max(-1, Math.min(1, score));
}

export const FRUSTRATION_ESCALATION_THRESHOLD = -0.5;

export function shouldEscalateOnSentiment(trend: number[]): boolean {
  if (trend.length === 0) return false;
  const last = trend.at(-1) ?? 0;
  return last <= FRUSTRATION_ESCALATION_THRESHOLD;
}
