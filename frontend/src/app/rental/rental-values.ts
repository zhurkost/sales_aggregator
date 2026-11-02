import type { JsonValue } from "./rental-models";
export function hasValue(value: JsonValue | undefined) { return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0); }
