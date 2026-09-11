import { describe, it, expect } from "vitest";
import { allowanceFor, trialEndDate, TRIAL_DAYS } from "./planLimits.js";

/**
 * These guard revenue directly: if the trial branch regresses, every trial
 * silently gets a paid plan's allowance, and if a hard cap goes missing the
 * platform absorbs unbounded provider cost on a fixed monthly fee. Both
 * failures are invisible until an invoice or a bill arrives.
 */
describe("plan allowances", () => {
  it("gives a TRIAL tenant the trial allowance regardless of which tier it is nominally on", () => {
    const tiers = ["STARTER", "GROWTH", "SCALE", "ENTERPRISE"] as const;
    for (const tier of tiers) {
      expect(allowanceFor(tier, "TRIAL")).toEqual(allowanceFor("STARTER", "TRIAL"));
    }
  });

  it("hard-caps a trial at exactly its included allowance, so it stops rather than accruing overage", () => {
    const trial = allowanceFor("STARTER", "TRIAL");
    expect(trial.hardCapTokensPerMonth).toBe(trial.includedTokensPerMonth);
  });

  it("gives every paid tier a hard cap above its included allowance, so overage bills before anything blocks", () => {
    for (const tier of ["STARTER", "GROWTH", "SCALE"] as const) {
      const plan = allowanceFor(tier, "ACTIVE");
      expect(plan.hardCapTokensPerMonth).not.toBeNull();
      expect(plan.hardCapTokensPerMonth!).toBeGreaterThan(plan.includedTokensPerMonth);
    }
  });

  it("leaves ENTERPRISE uncapped — those are negotiated contracts that must never be auto-cut off", () => {
    expect(allowanceFor("ENTERPRISE", "ACTIVE").hardCapTokensPerMonth).toBeNull();
  });

  it("increases the included allowance with each paid tier", () => {
    const order = ["STARTER", "GROWTH", "SCALE", "ENTERPRISE"] as const;
    const included = order.map((t) => allowanceFor(t, "ACTIVE").includedTokensPerMonth);
    expect(included).toEqual([...included].sort((a, b) => a - b));
    expect(new Set(included).size).toBe(included.length);
  });

  it("charges a lower overage rate at each higher tier", () => {
    const order = ["STARTER", "GROWTH", "SCALE", "ENTERPRISE"] as const;
    const rates = order.map((t) => Number(allowanceFor(t, "ACTIVE").overageRatePerThousandTokensUsd));
    expect(rates).toEqual([...rates].sort((a, b) => b - a));
  });

  it("quotes every overage rate as a parseable positive decimal string", () => {
    for (const tier of ["STARTER", "GROWTH", "SCALE", "ENTERPRISE"] as const) {
      const raw = allowanceFor(tier, "ACTIVE").overageRatePerThousandTokensUsd;
      expect(raw).toMatch(/^\d+\.\d+$/);
      expect(Number(raw)).toBeGreaterThan(0);
    }
  });
});

describe("trial length", () => {
  it("ends TRIAL_DAYS after it starts", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = trialEndDate(start);
    expect((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)).toBe(TRIAL_DAYS);
  });

  it("is the 14 days the marketing page and signup flow both advertise", () => {
    expect(TRIAL_DAYS).toBe(14);
  });
});
