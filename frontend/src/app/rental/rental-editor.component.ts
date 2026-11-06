import { APARTMENT_RENT } from "../listing-categories";
import {
  Component,
  Input,
  OnInit,
  OnDestroy,
} from "@angular/core";
import { RentalAiReviewComponent } from "./rental-ai-review.component";
import { NgTemplateOutlet } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { AddressInputComponent } from "./address-input.component";
import { RentalFieldsComponent } from "./rental-fields.component";
import { RentalFormEditor } from "./rental-form.editor";
import { RentalFormStore } from "./rental-form.store";
import { RentalAiAssistant } from "./rental-ai.assistant";
import { RentalViewModel } from "./rental-view.model";
import type { RentalProfile } from "./rental-profile-defaults";
import { RentalPublicationComponent } from "./rental-publication.component";
import {
  Address,
  Field,
  JsonValue,
} from "./rental-models";

@Component({
  selector: "app-rental-editor",
  standalone: true,
  imports: [NgTemplateOutlet, RentalPublicationComponent, RentalAiReviewComponent, FormsModule, AddressInputComponent, RentalFieldsComponent],
  templateUrl: "./rental-editor.component.html",
  styleUrl: "./rental-editor.component.css",
})
export class RentalEditorComponent implements OnInit, OnDestroy {
  @Input({ required: true }) workspaceId = "";
  @Input() category = APARTMENT_RENT;
  @Input() deal: "rent" | "sale" = "rent";
  @Input() profileDefaults: RentalProfile = {};
  readonly store = new RentalFormStore(() => this.workspaceId, () => this.profileDefaults, () => this.category);
  readonly editing = new RentalFormEditor(this.store, address => this.addressChanged(address));
  readonly ai = new RentalAiAssistant(this.store, () => this.workspaceId, address => this.editing.replaceAddress(address), address => this.addressChanged(address));
  readonly view = new RentalViewModel(this.store);
  panel: "parameters" | "result" | null = null;
  private panelTrigger: HTMLElement | null = null;
  private focusTimer?: ReturnType<typeof setTimeout>;
  ngOnInit() { return this.store.load(); }
  addressChanged(address: Address | null) {
    if (this.store.busy) return;
    this.editing.replaceAddress(address);
    this.ai.address = null; this.ai.addressFacts = [];
    const dependent = this.store.schema?.card?.addressDependentFacts || [];
    this.ai.conflicts = this.ai.conflicts.filter(item => !dependent.includes(item.field));
    this.store.changed();
  }
  focusField(id: string) {
    const basic = id === "address" || id === "legacy" || this.view.mainFields.some(f => f.id === id) || id === "listing.description";
    if (!basic) { this.openPanel("parameters"); this.view.parameterSearch = ""; this.view.filledOnly = false; }
    else this.closePanel(false);
    clearTimeout(this.focusTimer);
    this.focusTimer = setTimeout(() => {
      const el = document.getElementById("rental-" + id);
      el?.scrollIntoView({behavior: "smooth", block: "center"});
      (el?.querySelector<HTMLElement>("button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])") || el)?.focus();
    }, 0);
  }
  get description() { return String(this.store.card.values["listing.description"] || ""); }
  setDescription(value: string) {
    if (this.store.busy) return;
    this.store.card.values["listing.description"] = value;
    this.ai.clear();
    this.store.changed();
  }
  editField(event: {field: Field; value: JsonValue}) { this.editing.setTyped(event.field, event.value); }
  openPanel(panel: NonNullable<RentalEditorComponent["panel"]>) {
    this.panelTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.panel = panel;
    clearTimeout(this.focusTimer);
    this.focusTimer = setTimeout(() => document.getElementById("rental-panel-title")?.focus(), 0);
  }
  closePanel(restoreFocus = true) {
    this.panel = null;
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
  ngOnDestroy() { this.store.destroy(); clearTimeout(this.focusTimer); }
}
