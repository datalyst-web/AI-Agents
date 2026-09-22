import { describe, expect, it } from "vitest";
import { sameConfig, stableStringify } from "./publishedAgentConfig.js";

describe("stableStringify / sameConfig", () => {
  it("ignores key order, so a merged edit that changes nothing isn't a pending change", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
    const base = { personality: { name: "Ava", greeting: "Hi" }, modelRouting: { reasoningEffort: "low" }, enabledToolIds: ["t2", "t1"] };
    expect(sameConfig(base, { personality: { greeting: "Hi", name: "Ava" }, modelRouting: { reasoningEffort: "low" }, enabledToolIds: ["t1", "t2"] })).toBe(true);
  });

  it("detects a real change in any of the three parts", () => {
    const base = { personality: { greeting: "Hi" }, modelRouting: { reasoningEffort: "low" }, enabledToolIds: ["t1"] };
    expect(sameConfig(base, { ...base, personality: { greeting: "Hello" } })).toBe(false);
    expect(sameConfig(base, { ...base, modelRouting: { reasoningEffort: "high" } })).toBe(false);
    expect(sameConfig(base, { ...base, enabledToolIds: [] })).toBe(false);
  });

  it("treats an undefined field the same as a missing one", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });
});
