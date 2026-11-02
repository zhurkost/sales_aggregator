export type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | JsonScalar[];
export interface Condition {
  all?: Condition[];
  any?: Condition[];
  not?: Condition;
  option_id?: string;
  operator?: string;
  value?: JsonValue;
}
export interface Field {
  id: string;
  name: string;
  description: string;
  type: string;
  options: Field[];
  fill_rule: Record<string, any>;
  uiWhen?: Condition;
  uses?: { platform: string; target: string; when?: Condition }[];
}
export interface Address {
  provider: string;
  label: string;
  countryIso: string;
  settlement: string;
  street: string;
  house: string;
  block?: string;
  blockType?: string;
  region?: string;
  district?: string;
  latitude?: string;
  longitude?: string;
  precision?: string;
  confirmed: boolean;
  level?: string;
}
export interface RentalDraft {
  localPhotoIds?: string[];
  modelVersion?: number;
  aiEvidence?: Record<string, string>;
  legacy?: {platform: string; field: string; source: string; value: JsonValue; candidate?: JsonValue; message: string}[];
  resolvedLegacy?: RentalDraft["legacy"];
  schemaVersion: string;
  values: Record<string, JsonValue>;
  extras: Record<string, Record<string, JsonValue>>;
  platforms: string[];
  address: Address | null;
}
export interface RentalAiResult {
  schemaVersion: string;
  model: string;
  suggestions: {field: string; value: JsonValue; quote: string}[];
  address: Address | null;
  questions: string[];
  ignored: number;
}
export interface EditorSchema {
  card?: {valueLabels?: Record<string, string>; version: number; expandedGroups: string[]; addressDependentFacts: string[]; profileDefaults?: {setting: "phone" | "contactPerson" | "company"; field: string}[]};
  category: { options: Field[] };
  canonicalValues: Record<string, string[]>;
  platforms: Record<
    string,
    {
      name?: string;
      rules?: any[];
      addressBoundFields?: string[];
      deferred?: Record<string, string>;
      extras: Field[];
      labels: Record<string, string>;
      choiceLabels: Record<string, Record<string, string>>;
      constants: Record<string, JsonValue>;
      bindings: {
        source: string;
        target: string;
        pairs: { from: JsonValue; to: JsonValue }[];
      }[];
    }
  >;
  version: string;
  addressSuggestions: boolean;
}
export interface Prepared {
  platform: string;
  values: Record<string, JsonValue>;
  issues: { field: string; source?: string; code: string; message: string }[];
  dataReady: boolean;
  publicationReady: boolean;
}
