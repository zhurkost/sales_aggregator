export type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | JsonScalar[];
export interface Field {
  id: string;
  name: string;
  description: string;
  type: string;
  options: Field[];
  uses?: { platform: string; target: string }[];
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
  resolution?: "matched" | "not_found" | "ambiguous" | "unavailable";
  sourceId?: string;
  confirmedAt?: string;
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
  addressResolution?: { status: NonNullable<Address["resolution"]>; sourceLabel: string; message: string };
  questions: string[];
  ignored: number;
}
export interface EditorSchema {
  card?: {valueLabels?: Record<string, string>; version: number; addressDependentFacts: string[]; profileDefaults?: {setting: "phone" | "contactPerson" | "company"; field: string}[]};
  category: { options: Field[] };
  canonicalValues: Record<string, string[]>;
  platforms: Record<
    string,
    {
      name?: string;
      addressBoundFields?: string[];
      labels: Record<string, string>;
      choiceLabels: Record<string, Record<string, string>>;
    }
  >;
  version: string;
  serverApplicability?: boolean;
  addressSuggestions: boolean;
}
export interface Prepared {
  platform: string;
  values: Record<string, JsonValue>;
  issues: { field: string; source?: string; code: string; message: string }[];
  dataReady: boolean;
  publicationReady: boolean;
}
