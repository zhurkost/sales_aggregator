import type { Address, RentalAiResult } from "./rental-models";
import { rentalApi } from "./rental-api";
import { RentalDraftStore } from "./rental-draft.store";
import { hasValue } from "./rental-values";
/** Applies server-verified proposals while preserving manual edits and address conflicts. */
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
      let appliedAddress = false;
      const current = this.store.draft.address;
      const plainLabel = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
      // Upgrade older AI cards that contain only the same literal address, without replacing edits.
      const enrichLiteral = current && !current.confirmed && current.provider === "manual" &&
        ![current.settlement, current.street, current.house, current.block, current.region, current.district, current.latitude, current.longitude].some(Boolean) &&
        plainLabel(current.label) === plainLabel(result.addressResolution?.sourceLabel || "");
      if (result.address && (!current?.label || enrichLiteral)) {
        this.replaceAddress(result.address); count++; appliedAddress = true;
      } else if (result.address && (result.address.label !== current?.label ||
        (!current?.confirmed && JSON.stringify(result.address) !== JSON.stringify(current)))) this.address = result.address;
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
      if (appliedAddress && result.addressResolution) this.message += ` ${result.addressResolution.message}`;
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
