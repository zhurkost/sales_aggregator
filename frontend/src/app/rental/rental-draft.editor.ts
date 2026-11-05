import type { Address, Field, JsonValue } from "./rental-models";
import { RentalDraftStore } from "./rental-draft.store";

/** Card editing rules, independent of templates, focus and HTTP transport. */
export class RentalDraftEditor {
  constructor(private store: RentalDraftStore, private addressChanged: (address: Address | null) => void) {}
  private get draft() { return this.store.draft; }
  private get schema() { return this.store.schema; }
  private get busy() { return this.store.busy; }
  private get platforms() { return this.store.platforms; }
  private changed() { this.store.changed(); }
  setValue(field: Field, value: string) {
    if (this.busy) return;
    delete this.draft.aiEvidence?.[field.id];
    this.draft.values[field.id] =
      field.type === "files"
        ? value
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
        : value;
    this.changed();
  }
  replaceAddress(address: Address | null) {
    this.draft.address = address;
    for (const key of ["location.settlement", "location.street", "location.house_number", "location.latitude", "location.longitude"])
      delete this.draft.values[key];
    for (const key of this.schema?.card?.addressDependentFacts || []) { delete this.draft.values[key]; delete this.draft.aiEvidence?.[key]; }
    for (const p of this.platforms)
      for (const key of this.schema?.platforms[p].addressBoundFields || []) delete this.draft.extras[p]?.[key];
  }
  setTyped(field: Field, value: JsonValue) {
    if (this.busy) return;
    delete this.draft.aiEvidence?.[field.id];
    this.draft.values[field.id] = value;
    this.changed();
  }
  toggleChoice(field: Field, choice: string, selected: boolean) {
    const old = this.draft.values[field.id];
    const values = Array.isArray(old) ? old : [];
    this.setTyped(field, (selected ? [...new Set([...values, choice])] : values.filter(x => x !== choice)) as string[]);
  }
  resolveLegacy(index: number, useOld: boolean) {
    if (this.busy) return;
    const item = this.draft.legacy?.[index];
    if (!item) return;
    if (useOld && item.source && item.candidate !== undefined && item.candidate !== null) {
      if (item.source.startsWith("address.")) {
        const part = item.source.slice(8);
        const address = {...this.draft.address, [part]: item.candidate, confirmed: false, provider: "manual", latitude: "", longitude: ""} as Address;
        address.label = [address.region, address.district, address.settlement, address.street, address.house, address.block].filter(Boolean).join(", ");
        this.addressChanged(address);
      } else this.draft.values[item.source] = item.candidate;
    }
    (this.draft.resolvedLegacy ||= []).push(item);
    this.draft.legacy!.splice(index, 1);
    this.changed();
  }
  togglePlatform(p: string, checked: boolean) {
    if (this.busy) return;
    this.draft.platforms = checked
      ? [...new Set([...this.draft.platforms, p])]
      : this.draft.platforms.filter((x) => x !== p);
    this.changed();
  }
}
