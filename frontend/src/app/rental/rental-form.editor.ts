import type { Address, Field, JsonValue } from "./rental-models";
import { RentalFormStore } from "./rental-form.store";

/** Card editing rules, independent of templates, focus and HTTP transport. */
export class RentalFormEditor {
  constructor(private store: RentalFormStore, private addressChanged: (address: Address | null) => void) {}
  private get card() { return this.store.card; }
  private get schema() { return this.store.schema; }
  private get busy() { return this.store.busy; }
  private get platforms() { return this.store.platforms; }
  private changed() { this.store.changed(); }
  setValue(field: Field, value: string) {
    if (this.busy) return;
    delete this.card.aiEvidence?.[field.id];
    this.card.values[field.id] =
      field.type === "files"
        ? value
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
        : value;
    this.changed();
  }
  replaceAddress(address: Address | null) {
    this.card.address = address;
    for (const key of ["location.settlement", "location.street", "location.house_number", "location.latitude", "location.longitude"])
      delete this.card.values[key];
    for (const key of this.schema?.card?.addressDependentFacts || []) { delete this.card.values[key]; delete this.card.aiEvidence?.[key]; }
    for (const p of this.platforms)
      for (const key of this.schema?.platforms[p].addressBoundFields || []) delete this.card.extras[p]?.[key];
  }
  setTyped(field: Field, value: JsonValue) {
    if (this.busy) return;
    delete this.card.aiEvidence?.[field.id];
    this.card.values[field.id] = value;
    this.changed();
  }
  toggleChoice(field: Field, choice: string, selected: boolean) {
    const old = this.card.values[field.id];
    const values = Array.isArray(old) ? old : [];
    this.setTyped(field, (selected ? [...new Set([...values, choice])] : values.filter(x => x !== choice)) as string[]);
  }
  resolveLegacy(index: number, useOld: boolean) {
    if (this.busy) return;
    const item = this.card.legacy?.[index];
    if (!item) return;
    if (useOld && item.source && item.candidate !== undefined && item.candidate !== null) {
      if (item.source.startsWith("address.")) {
        const part = item.source.slice(8);
        const address = {...this.card.address, [part]: item.candidate, confirmed: false, provider: "manual", latitude: "", longitude: ""} as Address;
        if (part === "street") { delete address.streetType; delete address.streetWithType; }
        address.label = [address.region, address.district, address.settlement, address.street, address.house, address.block].filter(Boolean).join(", ");
        this.addressChanged(address);
      } else this.card.values[item.source] = item.candidate;
    }
    (this.card.resolvedLegacy ||= []).push(item);
    this.card.legacy!.splice(index, 1);
    this.changed();
  }
  togglePlatform(p: string, checked: boolean) {
    if (this.busy) return;
    this.card.platforms = checked
      ? [...new Set([...this.card.platforms, p])]
      : this.card.platforms.filter((x) => x !== p);
    this.changed();
  }
}
