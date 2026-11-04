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
  /** Platform rows fed by this field; `transferred`: that platform's form needs the value. */
  uses?: { platform: string; target: string; when?: Condition; transferred: boolean }[];
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
  modelVersion?: number;
  aiEvidence?: Record<string, string>;
  legacy?: {platform: string; field: string; source: string; value: JsonValue; candidate?: JsonValue; message: string}[];
  resolvedLegacy?: RentalDraft["legacy"];
  /** Version of the card model the card was last edited under; the server compares it. */
  cardVersion: string;
  values: Record<string, JsonValue>;
  platforms: string[];
  address: Address | null;
}
export interface RentalAiResult {
  cardVersion: string;
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
      rules?: any[];
      deferred?: Record<string, string>;
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
  /** Version of the card model (common and card.json); selectors and plans do not change it. */
  cardVersion: string;
  addressSuggestions: boolean;
  /** How many photos a card may have; the server enforces it. */
  photoLimit: number;
}
/** A photo stored with the card on the server. */
export interface RentalPhoto {
  id: string;
  name: string;
  type: string;
  size: number;
}
/** The photos after a change and the revision of the card the change produced. */
export interface RentalPhotos {
  revision: number;
  photos: RentalPhoto[];
}
/** A value the extension fills in the platform's form. */
export interface FormValue {
  field: string;
  name: string;
  value: JsonValue;
}
/** A prepared value the form does not receive: the user enters it on the platform. */
export interface ManualValue extends FormValue {
  reason: string;
}
export interface Prepared {
  platform: string;
  values: Record<string, JsonValue>;
  issues: { field: string; source?: string; code: string; message: string }[];
  /** No issues on this platform; only then may an automatic launch press the final button. */
  checksPassed: boolean;
  /** What the extension fills, computed by the server from the coverage of the plan. */
  form: FormValue[];
  /** What the user enters on the platform by hand, with the reason. */
  manual: ManualValue[];
  publicationReady: boolean;
}
