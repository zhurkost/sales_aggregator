import {
  Component,
  Input,
  OnInit,
  OnDestroy,
  HostListener,
} from "@angular/core";
import { RentalSavedListComponent } from "./rental-saved-list.component";
import { RentalAiReviewComponent } from "./rental-ai-review.component";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { AddressInputComponent } from "./address-input.component";
import { RentalFieldsComponent } from "./rental-fields.component";
import { RentalDraftStore } from "./rental-draft.store";
import { RentalAiAssistant } from "./rental-ai.assistant";
import { RentalViewModel } from "./rental-view.model";
import { hasValue } from "./rental-values";
import type { RentalProfile } from "./rental-profile-defaults";
import { RentalPublicationComponent } from "./rental-publication.component";
import { Address, Field, JsonValue } from "./rental-models";
import { DESCRIPTION } from "./card-fields.generated";

const blankAddress = (a: Address | null) =>
  !a || ![a.label, a.settlement, a.street, a.house, a.block, a.region, a.district].some(v => v?.trim());
const plain = (v: string | undefined) => (v || "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
// Providers format labels differently; the house is identified by its parts when known.
function houseKey(a: Address) {
  const parts = [a.settlement, a.street, a.house, a.block].map(plain);
  return parts.some(Boolean) ? parts.join("|") : plain(a.label);
}

@Component({
  selector: "app-rental-editor",
  standalone: true,
  imports: [RentalPublicationComponent, RentalSavedListComponent, RentalAiReviewComponent, FormsModule, CommonModule, AddressInputComponent, RentalFieldsComponent],
  templateUrl: "./rental-editor.component.html",
  styleUrl: "./rental-editor.component.css",
})
export class RentalEditorComponent implements OnInit, OnDestroy {
  @Input({ required: true }) workspaceId = "";
  @Input() profileDefaults: RentalProfile = {};
  readonly store = new RentalDraftStore(() => this.workspaceId, () => { this.ai.clear(); this.closePanel(false); this.resetFacts = null; this.confirmLoadSaved = false; }, () => this.profileDefaults);
  readonly ai = new RentalAiAssistant(this.store, () => this.workspaceId, address => this.replaceAddress(address), address => this.addressChanged(address));
  readonly view = new RentalViewModel(this.store);
  panel: "parameters" | "saved" | "result" | null = null;
  confirmLoadSaved = false;
  /** Nearby facts removed by the last change of the confirmed house, until the next address change. */
  resetFacts: { names: string[]; values: Record<string, JsonValue>; evidence: Record<string, string> } | null = null;
  // The confirmed house the nearby facts belong to; typing over it does not forget it.
  private house: { id: string; address: Address | null } = { id: "", address: null };
  private panelTrigger: HTMLElement | null = null;
  private focusTimer?: ReturnType<typeof setTimeout>;
  ngOnInit() { return this.store.load(); }
  loadSaved() { this.confirmLoadSaved = false; return this.store.loadSaved(); }
  setValue(field: Field, value: string) {
    if (this.store.busy) return;
    delete this.store.draft.aiEvidence?.[field.id];
    this.store.draft.values[field.id] =
      field.type === "files"
        ? value
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
        : value;
    this.store.changed();
  }
  addressChanged(address: Address | null) {
    if (this.store.busy) return;
    this.replaceAddress(address);
    this.ai.address = null; this.ai.addressFacts = [];
    const dependent = this.store.schema?.card.addressDependentFacts || [];
    this.ai.conflicts = this.ai.conflicts.filter(item => !dependent.includes(item.field));
    this.store.changed();
  }
  private replaceAddress(address: Address | null) {
    if (this.house.id !== this.store.id)
      this.house = { id: this.store.id, address: this.store.draft.address?.confirmed ? this.store.draft.address : null };
    const previous = this.house.address, cleared = blankAddress(address);
    this.store.draft.address = address;
    this.resetFacts = null;
    // The values derived from the address (parts, coordinates) belong to any address text.
    for (const key of this.store.schema?.card.addressFields || [])
      delete this.store.draft.values[key];
    // Nearby facts belong to a confirmed house: typing and manual parts keep them.
    if (cleared || (address?.confirmed && previous && houseKey(previous) !== houseKey(address))) this.dropFacts();
    this.house.address = cleared ? null : address?.confirmed ? address : previous;
  }
  private dropFacts() {
    const values: Record<string, JsonValue> = {}, evidence: Record<string, string> = {};
    for (const key of this.store.schema?.card.addressDependentFacts || []) {
      if (hasValue(this.store.draft.values[key])) {
        values[key] = this.store.draft.values[key];
        const quote = this.store.draft.aiEvidence?.[key];
        if (quote !== undefined) evidence[key] = quote;
      }
      delete this.store.draft.values[key];
      delete this.store.draft.aiEvidence?.[key];
    }
    const ids = Object.keys(values);
    if (ids.length) this.resetFacts = { names: ids.map(id => this.view.fieldName(id)), values, evidence };
  }
  restoreFacts() {
    const facts = this.resetFacts;
    if (this.store.busy || !facts) return;
    Object.assign(this.store.draft.values, facts.values);
    if (Object.keys(facts.evidence).length) Object.assign((this.store.draft.aiEvidence ||= {}), facts.evidence);
    this.resetFacts = null;
    this.store.changed();
  }
  setTyped(field: Field, value: JsonValue) {
    if (this.store.busy) return;
    delete this.store.draft.aiEvidence?.[field.id];
    this.store.draft.values[field.id] = value;
    this.store.changed();
  }
  focusField(id: string) {
    const basic = id === "address" || id === "legacy" || this.view.mainFields.some(f => f.id === id) || id === DESCRIPTION;
    if (!basic) { this.openPanel("parameters"); this.view.parameterSearch = ""; this.view.filledOnly = false; }
    else this.closePanel(false);
    clearTimeout(this.focusTimer);
    this.focusTimer = setTimeout(() => {
      const el = document.getElementById("rental-" + id);
      el?.scrollIntoView({behavior: "smooth", block: "center"});
      (el?.querySelector<HTMLElement>("button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])") || el)?.focus();
    }, 0);
  }
  get description() { return String(this.store.draft.values[DESCRIPTION] || ""); }
  readonly descriptionId = "rental-" + DESCRIPTION;
  setDescription(value: string) {
    if (this.store.busy) return;
    this.store.draft.values[DESCRIPTION] = value;
    this.ai.clear();
    this.store.changed();
  }
  editField(event: {field: Field; value: JsonValue}) { this.setTyped(event.field, event.value); }
  openPanel(panel: NonNullable<RentalEditorComponent["panel"]>) {
    this.panelTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.panel = panel;
    if (panel === "saved") this.store.refresh().catch(e => { this.store.error = (e as Error).message; });
    clearTimeout(this.focusTimer);
    this.focusTimer = setTimeout(() => document.getElementById("rental-panel-title")?.focus(), 0);
  }
  closePanel(restoreFocus = true) {
    this.panel = null; this.store.pendingDelete = null;
    clearTimeout(this.focusTimer);
    const trigger = this.panelTrigger;
    if (restoreFocus) this.focusTimer = setTimeout(() => trigger?.focus(), 0);
  }
  panelKeys(event: KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); this.closePanel(); }
    if (event.key !== "Tab") return;
    const controls = Array.from(document.querySelectorAll<HTMLElement>(".rental-drawer button:not([disabled]),.rental-drawer input:not([disabled]),.rental-drawer select:not([disabled]),.rental-drawer textarea:not([disabled]),.rental-drawer [tabindex='0']"));
    if (!controls.length) { event.preventDefault(); return; }
    const first = controls[0], last = controls[controls.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const outside = !active || !active.closest(".rental-drawer");
    const beforeFirst = active && !!(active.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING);
    const afterLast = active && !!(last.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (event.shiftKey && (active === first || outside || beforeFirst)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (active === last || outside || afterLast)) { event.preventDefault(); first.focus(); }
  }
  resolveLegacy(index: number, useOld: boolean) {
    if (this.store.busy) return;
    const item = this.store.draft.legacy?.[index];
    if (!item) return;
    if (useOld && item.source && item.candidate !== undefined && item.candidate !== null) {
      if (item.source.startsWith("address.")) {
        const part = item.source.slice(8);
        const address = {...this.store.draft.address, [part]: item.candidate, confirmed: false, provider: "manual", latitude: "", longitude: ""} as Address;
        address.label = [address.region, address.district, address.settlement, address.street, address.house, address.block].filter(Boolean).join(", ");
        this.addressChanged(address);
      } else this.store.draft.values[item.source] = item.candidate;
    }
    (this.store.draft.resolvedLegacy ||= []).push(item);
    this.store.draft.legacy!.splice(index, 1);
    this.store.changed();
  }
  @HostListener("window:beforeunload", ["$event"])
  unload(event: BeforeUnloadEvent) {
    if (this.store.dirty) { event.preventDefault(); event.returnValue = ""; }
  }
  ngOnDestroy() { this.store.destroy(); clearTimeout(this.focusTimer); }
}
