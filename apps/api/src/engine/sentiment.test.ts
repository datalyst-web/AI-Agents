import { describe, it, expect } from "vitest";
import { scoreSentiment, shouldEscalateOnSentiment, FRUSTRATION_ESCALATION_THRESHOLD } from "./sentiment.js";

describe("scoreSentiment", () => {
  it("scores neutral text as 0", () => {
    expect(scoreSentiment("What are your business hours?")).toBe(0);
  });

  it("scores a single negative phrase negative", () => {
    expect(scoreSentiment("This is unacceptable.")).toBeCloseTo(-0.3);
  });

  it("scores a single positive phrase positive", () => {
    expect(scoreSentiment("Thanks, that's great!")).toBeCloseTo(0.2 + 0.2); // "thanks" + "great"
  });

  it("is case-insensitive", () => {
    expect(scoreSentiment("THIS IS RIDICULOUS")).toBeLessThan(0);
  });

  it("clamps the score at -1 for very negative text", () => {
    const text = "angry frustrated terrible awful useless unacceptable refund worst scam";
    expect(scoreSentiment(text)).toBe(-1);
  });

  it("clamps the score at 1 for very positive text", () => {
    const text = "thanks thank you great awesome perfect love it appreciate";
    expect(scoreSentiment(text)).toBe(1);
  });
});

describe("shouldEscalateOnSentiment", () => {
  it("returns false for an empty trend", () => {
    expect(shouldEscalateOnSentiment([])).toBe(false);
  });

  it("returns false when the latest score is above the frustration threshold", () => {
    expect(shouldEscalateOnSentiment([0.5, 0, -0.3])).toBe(false);
  });

  it("returns true when the latest score is at or below the frustration threshold", () => {
    expect(shouldEscalateOnSentiment([0.5, FRUSTRATION_ESCALATION_THRESHOLD])).toBe(true);
    expect(shouldEscalateOnSentiment([0.5, -1])).toBe(true);
  });

  it("only looks at the latest score, not the trend average", () => {
    // Trend dips very negative earlier but recovers — should NOT escalate.
    expect(shouldEscalateOnSentiment([-1, -1, -1, 0.5])).toBe(false);
  });
});
