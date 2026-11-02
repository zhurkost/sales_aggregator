import type { Address, RentalAiResult } from "./rental-models";
import { rentalApi } from "./rental-api";
import { RentalDraftStore } from "./rental-draft.store";
import { hasValue } from "./rental-values";
/** Proposes facts and resolves conflicts. It cannot publish or confirm a provider address. */
export class RentalAiAssistant {
  constructor(private store: RentalDraftStore, private workspaceId: () => string,
    private replaceAddress: (address: Address | null) => void,
    private addressChanged: (address: Address | null) => void) {}
  private description() { return String(this.store.draft.values["listing.description"] || ""); }
  busy = false;
  message = "";
  questions: string[] = [];
  conflicts: RentalAiResult["suggestions"] = [];
  address: Address | null = null;
  addressFacts: RentalAiResult["suggestions"] = [];
  async fillFromDescription() {
    if (this.store.busy || this.description().trim().length < 10 || !this.store.schema) return;
    this.store.busy = true; this.busy = true; this.store.error = ""; this.message = "";
    this.conflicts = []; this.address = null; this.addressFacts = []; this.questions = [];
    const id = this.store.id, version = this.store.editVersion, schemaVersion = this.store.schema.version;
    try {
      await this.store.flush();
      const result = await rentalApi<RentalAiResult>(this.workspaceId(), "analyze", {text:this.description(), schemaVersion});
      if (this.store.destroyed || this.store.id !== id || this.store.editVersion !== version || this.store.schema?.version !== result.schemaVersion) return;
      let count = 0;
      if (result.address && !this.store.draft.address?.label) { this.replaceAddress(result.address); count++; }
      else if (result.address && result.address.label !== this.store.draft.address?.label) this.address = result.address;
      const fields = this.store.schema.category.options.flatMap(g => g.options);
      for (const item of result.suggestions) {
        if (!fields.some(f => f.id === item.field)) continue;
        if (this.address && this.store.schema.card?.addressDependentFacts.includes(item.field)) { this.addressFacts.push(item); continue; }
        const existing = this.store.draft.values[item.field];
        if (!hasValue(existing)) {
          this.store.draft.values[item.field] = item.value;
          (this.store.draft.aiEvidence ||= {})[item.field] = item.quote; count++;
        } else if (JSON.stringify(existing) !== JSON.stringify(item.value)) this.conflicts.push(item);
      }
      this.questions = result.questions;
      this.message = count ? `Заполнено: ${count}. Проверьте карточку.` : this.conflicts.length || this.address ? "Есть отличия от заполненной карточки." : "Новых сведений не найдено.";
      if (count) { this.store.changed(); await this.store.flush(); }
    } catch (e) { this.store.error = (e as Error).message; }
    finally { this.store.busy = false; this.busy = false; }
  }
  acceptAiField(index: number) {
    if (this.store.busy) return;
    const item = this.conflicts[index]; if (!item) return;
    this.store.draft.values[item.field] = item.value;
    (this.store.draft.aiEvidence ||= {})[item.field] = item.quote;
    this.conflicts.splice(index, 1); this.store.changed();
  }
  acceptAiAddress() {
    if (this.store.busy || !this.address) return;
    const facts = this.addressFacts;
    this.addressChanged(this.address);
    for (const item of facts) {
      this.store.draft.values[item.field] = item.value;
      (this.store.draft.aiEvidence ||= {})[item.field] = item.quote;
    }
    this.store.changed();
  }
  clear() { this.conflicts = []; this.address = null; this.addressFacts = []; this.message = ""; this.questions = []; }
}
