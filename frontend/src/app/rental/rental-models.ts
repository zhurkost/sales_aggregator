export type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | JsonScalar[];
/** A card field as the editor draws it; which fields apply is a {@link FieldState}. */
export interface Field {
  id: string;
  name: string;
  type: string;
  /** Added to the label, such as «м²». */
  unit?: string;
  /** How the editor styles the field: `price`. */
  role?: string;
}
export interface FieldGroup {
  id: string;
  name: string;
  fields: Field[];
}
/**
 * A card field the server shows for the current card and its chosen platforms. Fields without a
 * state are not shown.
 */
export interface FieldState {
  id: string;
  /** A chosen platform requires the value. */
  required: boolean;
  /** False: no chosen platform's form receives the value yet. */
  transferred: boolean;
  /** The options of the field; empty for a field without options. */
  choices: string[];
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
  card: {
    version: number;
    valueLabels: Record<string, string>;
    addressDependentFacts: string[];
    /** Card fields derived from the address: any change of the address drops them. */
    addressFields: string[];
    profileDefaults: {setting: "phone" | "contactPerson" | "company"; field: string}[];
  };
  groups: FieldGroup[];
  /** Names of the platforms and of their form fields; no rule of a platform. */
  platforms: Record<string, { name: string; labels: Record<string, string> }>;
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
/** Where a card stands on a platform: its latest launch there, and the link to the ad if given. */
export interface RentalPublication {
  id: string;
  platform: string;
  status: "opened" | "filled" | "submitted" | "needs_action" | "stopped";
  message: string;
  url: string;
  updated: string;
}
/** A row of «Мои квартиры». */
export interface RentalListedDraft {
  id: string;
  title: string;
  address: string;
  revision: number;
  publications: RentalPublication[];
}
/** The photos after a change and the revision of the card the change produced. */
export interface RentalPhotos {
  revision: number;
  photos: RentalPhoto[];
}
/** A value the extension fills in the platform's form, as the server words it. */
export interface FormValue {
  field: string;
  name: string;
  text: string;
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
}
