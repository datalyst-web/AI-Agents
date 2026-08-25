import type { WorkflowCondition, WorkflowConditionGroup } from "@chat-agent/shared-types";

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function evaluateCondition(condition: WorkflowCondition, payload: Record<string, unknown>): boolean {
  const value = getByPath(payload, condition.field);
  switch (condition.operator) {
    case "equals":
      return value === condition.value;
    case "not_equals":
      return value !== condition.value;
    case "contains":
      return typeof value === "string" && typeof condition.value === "string"
        ? value.includes(condition.value)
        : Array.isArray(value)
          ? value.includes(condition.value)
          : false;
    case "greater_than":
      return typeof value === "number" && typeof condition.value === "number" && value > condition.value;
    case "less_than":
      return typeof value === "number" && typeof condition.value === "number" && value < condition.value;
    case "exists":
      return value !== undefined && value !== null;
    case "not_exists":
      return value === undefined || value === null;
  }
}

function isGroup(x: WorkflowCondition | WorkflowConditionGroup): x is WorkflowConditionGroup {
  return "logic" in x;
}

/** Recursively evaluates AND/OR condition trees — the "branching, not just linear" logic CLAUDE.md requires. */
export function evaluateConditionGroup(
  group: WorkflowConditionGroup,
  payload: Record<string, unknown>,
): boolean {
  const results = group.conditions.map((c) => (isGroup(c) ? evaluateConditionGroup(c, payload) : evaluateCondition(c, payload)));
  return group.logic === "AND" ? results.every(Boolean) : results.some(Boolean);
}
