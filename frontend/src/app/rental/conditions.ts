import { Condition, JsonValue } from "./rental-api";

// null means unknown, including through negation. Never coerce codes to strings.
export function applicable(
  condition: Condition | undefined,
  values: Record<string, JsonValue>,
): boolean | null {
  if (!condition) return true;
  if (condition.not) {
    const result = applicable(condition.not, values);
    return result === null ? null : !result;
  }
  if (condition.all) {
    const results = condition.all.map((c) => applicable(c, values));
    return results.includes(false)
      ? false
      : results.includes(null)
        ? null
        : true;
  }
  if (condition.any) {
    const results = condition.any.map((c) => applicable(c, values));
    return results.includes(true)
      ? true
      : results.includes(null)
        ? null
        : false;
  }
  const actual = values[condition.option_id || ""];
  const missing =
    actual == null ||
    actual === "" ||
    (Array.isArray(actual) && !actual.length);
  if (condition.operator === "exists") return !missing;
  if (missing) return null;
  const expected = condition.value;
  switch (condition.operator) {
    case "equals":
      return actual === expected;
    case "not_equals":
      return actual !== expected;
    case "in":
    case "not_in": {
      if (!Array.isArray(expected)) return null;
      const found = expected.some((v) => v === actual);
      return condition.operator === "in" ? found : !found;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (typeof actual !== "number" || typeof expected !== "number")
        return null;
      return condition.operator === "gt"
        ? actual > expected
        : condition.operator === "gte"
          ? actual >= expected
          : condition.operator === "lt"
            ? actual < expected
            : actual <= expected;
    }
    default:
      return null;
  }
}
