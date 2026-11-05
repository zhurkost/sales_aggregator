import {
  Component,
  Input,
  OnInit,
  OnDestroy,
} from "@angular/core";
import { RentalAiReviewComponent } from "./rental-ai-review.component";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { AddressInputComponent } from "./address-input.component";
import { RentalFieldsComponent } from "./rental-fields.component";
import { RentalFormEditor } from "./rental-form.editor";
import { RentalFormStore } from "./rental-form.store";
import { RentalAiAssistant } from "./rental-ai.assistant";
import { RentalViewModel } from "./rental-view.model";
import { hasValue } from "./rental-values";
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
  imports: [RentalPublicationComponent, RentalAiReviewComponent, FormsModule, CommonModule, AddressInputComponent, RentalFieldsComponent],
  templateUrl: "./rental-editor.component.html",
  styleUrl: "./rental-editor.component.css",
})
export class RentalEditorComponent implements OnInit, OnDestroy {
  @Input({ required: true }) workspaceId = "";
  @Input() profileDefaults: RentalProfile = {};
  readonly store = new RentalFormStore(() => this.workspaceId, () => this.profileDefaults);
  readonly editing = new RentalFormEditor(this.store, address => this.addressChanged(address));
  readonly ai = new RentalAiAssistant(this.store, () => this.workspaceId, address => this.replaceAddress(address), address => this.addressChanged(address));
  readonly view = new RentalViewModel(this.store);
  panel: "parameters" | "result" | null = null;
  private panelTrigger: HTMLElement | null = null;
  private focusTimer?: ReturnType<typeof setTimeout>;
  ngOnInit() { return this.store.load(); }
  get schema() { return this.store.schema; }
  set schema(value: RentalFormStore["schema"]) { this.store.schema = value; }
  get card() { return this.store.card; }
  set card(value: RentalFormStore["card"]) { this.store.card = value; }
  get id() { return this.store.id; }
  set id(value: RentalFormStore["id"]) { this.store.id = value; }
  get error() { return this.store.error; }
  set error(value: RentalFormStore["error"]) { this.store.error = value; }
  get busy() { return this.store.busy; }
  set busy(value: RentalFormStore["busy"]) { this.store.busy = value; }
  get results() { return this.store.results; }
  set results(value: RentalFormStore["results"]) { this.store.results = value; }
  get platforms() { return this.store.platforms; }
  changed = (...args: Parameters<RentalFormStore["changed"]>) => this.store.changed(...args);
  updateFields = (...args: Parameters<RentalFormStore["updateFields"]>) => this.store.updateFields(...args);
  prepare = (...args: Parameters<RentalFormStore["prepare"]>) => this.store.prepare(...args);
  acceptSchema = (...args: Parameters<RentalFormStore["acceptSchema"]>) => this.store.acceptSchema(...args);
  get aiBusy() { return this.ai.busy; }
  set aiBusy(value: RentalAiAssistant["busy"]) { this.ai.busy = value; }
  get aiMessage() { return this.ai.message; }
  set aiMessage(value: RentalAiAssistant["message"]) { this.ai.message = value; }
  get aiQuestions() { return this.ai.questions; }
  set aiQuestions(value: RentalAiAssistant["questions"]) { this.ai.questions = value; }
  get aiConflicts() { return this.ai.conflicts; }
  set aiConflicts(value: RentalAiAssistant["conflicts"]) { this.ai.conflicts = value; }
  get aiAddress() { return this.ai.address; }
  set aiAddress(value: RentalAiAssistant["address"]) { this.ai.address = value; }
  get aiAddressFacts() { return this.ai.addressFacts; }
  set aiAddressFacts(value: RentalAiAssistant["addressFacts"]) { this.ai.addressFacts = value; }
  fillFromDescription = (...args: Parameters<RentalAiAssistant["fillFromDescription"]>) => this.ai.fillFromDescription(...args);
  acceptAiField = (...args: Parameters<RentalAiAssistant["acceptAiField"]>) => this.ai.acceptAiField(...args);
  acceptAiAddress = (...args: Parameters<RentalAiAssistant["acceptAiAddress"]>) => this.ai.acceptAiAddress(...args);
  private clearAi() { this.ai.clear(); }
  hasValue = hasValue;
  value = (...args: Parameters<RentalViewModel["value"]>) => this.view.value(...args);
  choices = (...args: Parameters<RentalViewModel["choices"]>) => this.view.choices(...args);
  label = (...args: Parameters<RentalViewModel["label"]>) => this.view.label(...args);
  platformName = (...args: Parameters<RentalViewModel["platformName"]>) => this.view.platformName(...args);
  groupFields = (...args: Parameters<RentalViewModel["groupFields"]>) => this.view.groupFields(...args);
  usedBy = (...args: Parameters<RentalViewModel["usedBy"]>) => this.view.usedBy(...args);
  hasChoice = (...args: Parameters<RentalViewModel["hasChoice"]>) => this.view.hasChoice(...args);
  filled = (...args: Parameters<RentalViewModel["filled"]>) => this.view.filled(...args);
  get groupedIssues() { return this.view.groupedIssues; }
  canFocus = (...args: Parameters<RentalViewModel["canFocus"]>) => this.view.canFocus(...args);
  get mainFields() { return this.view.mainFields; }
  get additionalGroups() { return this.view.additionalGroups; }
  get additionalFilled() { return this.view.additionalFilled; }
  fieldName = (...args: Parameters<RentalViewModel["fieldName"]>) => this.view.fieldName(...args);
  valueLabel = (...args: Parameters<RentalViewModel["valueLabel"]>) => this.view.valueLabel(...args);
  legacyLabel = (...args: Parameters<RentalViewModel["legacyLabel"]>) => this.view.legacyLabel(...args);
  issueMessages = (...args: Parameters<RentalViewModel["issueMessages"]>) => this.view.issueMessages(...args);
  display = (...args: Parameters<RentalViewModel["display"]>) => this.view.display(...args);
  preparedValues = (...args: Parameters<RentalViewModel["preparedValues"]>) => this.view.preparedValues(...args);
  get parameterSearch() { return this.view.parameterSearch; }
  set parameterSearch(value: RentalViewModel["parameterSearch"]) { this.view.parameterSearch = value; }
  get filledOnly() { return this.view.filledOnly; }
  set filledOnly(value: RentalViewModel["filledOnly"]) { this.view.filledOnly = value; }
  setValue = (...args: Parameters<RentalFormEditor["setValue"]>) => this.editing.setValue(...args);
  addressChanged(address: Address | null) {
    if (this.busy) return;
    this.replaceAddress(address);
    this.aiAddress = null; this.aiAddressFacts = [];
    const dependent = this.schema?.card?.addressDependentFacts || [];
    this.aiConflicts = this.aiConflicts.filter(item => !dependent.includes(item.field));
    this.changed();
  }
  replaceAddress = (...args: Parameters<RentalFormEditor["replaceAddress"]>) => this.editing.replaceAddress(...args);
  setTyped = (...args: Parameters<RentalFormEditor["setTyped"]>) => this.editing.setTyped(...args);
  toggleChoice = (...args: Parameters<RentalFormEditor["toggleChoice"]>) => this.editing.toggleChoice(...args);
  focusField(id: string) {
    const basic = id === "address" || id === "legacy" || this.mainFields.some(f => f.id === id) || id === "listing.description";
    if (!basic) { this.openPanel("parameters"); this.parameterSearch = ""; this.filledOnly = false; }
    else this.closePanel(false);
    clearTimeout(this.focusTimer);
    this.focusTimer = setTimeout(() => {
      const el = document.getElementById("rental-" + id);
      el?.scrollIntoView({behavior: "smooth", block: "center"});
      (el?.querySelector<HTMLElement>("button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])") || el)?.focus();
    }, 0);
  }
  get description() { return String(this.card.values["listing.description"] || ""); }
  setDescription(value: string) {
    if (this.busy) return;
    this.card.values["listing.description"] = value;
    this.clearAi();
    this.changed();
  }
  editField(event: {field: Field; value: JsonValue}) { this.setTyped(event.field, event.value); }
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
  resolveLegacy = (...args: Parameters<RentalFormEditor["resolveLegacy"]>) => this.editing.resolveLegacy(...args);
  togglePlatform = (...args: Parameters<RentalFormEditor["togglePlatform"]>) => this.editing.togglePlatform(...args);
  ngOnDestroy() { this.store.destroy(); clearTimeout(this.focusTimer); }
}
