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
import {
  Address,
  EditorSchema,
  Field,
  JsonValue,
  Prepared,
  RentalDraft,
  RentalAiResult,
} from "./rental-models";

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
  readonly store = new RentalDraftStore(() => this.workspaceId, () => { this.ai.clear(); this.closePanel(false); this.resetFacts = null; }, () => this.profileDefaults);
  readonly ai = new RentalAiAssistant(this.store, () => this.workspaceId, address => this.replaceAddress(address), address => this.addressChanged(address));
  readonly view = new RentalViewModel(this.store);
  panel: "parameters" | "saved" | "result" | null = null;
  /** Nearby facts removed by the last change of the confirmed house, until the next address change. */
  resetFacts: { names: string[]; values: Record<string, JsonValue>; evidence: Record<string, string> } | null = null;
  // The confirmed house the nearby facts belong to; typing over it does not forget it.
  private house: { id: string; address: Address | null } = { id: "", address: null };
  private panelTrigger: HTMLElement | null = null;
  private focusTimer?: ReturnType<typeof setTimeout>;
  ngOnInit() { return this.store.load(); }
  get schema() { return this.store.schema; }
  set schema(value: RentalDraftStore["schema"]) { this.store.schema = value; }
  get draft() { return this.store.draft; }
  set draft(value: RentalDraftStore["draft"]) { this.store.draft = value; }
  get id() { return this.store.id; }
  set id(value: RentalDraftStore["id"]) { this.store.id = value; }
  get revision() { return this.store.revision; }
  set revision(value: RentalDraftStore["revision"]) { this.store.revision = value; }
  get dirty() { return this.store.dirty; }
  set dirty(value: RentalDraftStore["dirty"]) { this.store.dirty = value; }
  get status() { return this.store.status; }
  set status(value: RentalDraftStore["status"]) { this.store.status = value; }
  get error() { return this.store.error; }
  set error(value: RentalDraftStore["error"]) { this.store.error = value; }
  get busy() { return this.store.busy; }
  set busy(value: RentalDraftStore["busy"]) { this.store.busy = value; }
  get pendingDelete() { return this.store.pendingDelete; }
  set pendingDelete(value: RentalDraftStore["pendingDelete"]) { this.store.pendingDelete = value; }
  get deletingId() { return this.store.deletingId; }
  set deletingId(value: RentalDraftStore["deletingId"]) { this.store.deletingId = value; }
  get drafts() { return this.store.drafts; }
  set drafts(value: RentalDraftStore["drafts"]) { this.store.drafts = value; }
  get results() { return this.store.results; }
  set results(value: RentalDraftStore["results"]) { this.store.results = value; }
  get platforms() { return this.store.platforms; }
  refresh = (...args: Parameters<RentalDraftStore["refresh"]>) => this.store.refresh(...args);
  changed = (...args: Parameters<RentalDraftStore["changed"]>) => this.store.changed(...args);
  save = (...args: Parameters<RentalDraftStore["save"]>) => this.store.save(...args);
  flush = (...args: Parameters<RentalDraftStore["flush"]>) => this.store.flush(...args);
  open = (...args: Parameters<RentalDraftStore["open"]>) => this.store.open(...args);
  fresh = (...args: Parameters<RentalDraftStore["fresh"]>) => this.store.fresh(...args);
  remove = (...args: Parameters<RentalDraftStore["remove"]>) => this.store.remove(...args);
  updateFields = (...args: Parameters<RentalDraftStore["updateFields"]>) => this.store.updateFields(...args);
  saveCopy = (...args: Parameters<RentalDraftStore["saveCopy"]>) => this.store.saveCopy(...args);
  prepare = (...args: Parameters<RentalDraftStore["prepare"]>) => this.store.prepare(...args);
  acceptSchema = (...args: Parameters<RentalDraftStore["acceptSchema"]>) => this.store.acceptSchema(...args);
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
  extra = (...args: Parameters<RentalViewModel["extra"]>) => this.view.extra(...args);
  selected = (...args: Parameters<RentalViewModel["selected"]>) => this.view.selected(...args);
  context = (...args: Parameters<RentalViewModel["context"]>) => this.view.context(...args);
  availableExtras = (...args: Parameters<RentalViewModel["availableExtras"]>) => this.view.availableExtras(...args);
  waitingExtras = (...args: Parameters<RentalViewModel["waitingExtras"]>) => this.view.waitingExtras(...args);
  nativeChoices = (...args: Parameters<RentalViewModel["nativeChoices"]>) => this.view.nativeChoices(...args);
  extraFileText = (...args: Parameters<RentalViewModel["extraFileText"]>) => this.view.extraFileText(...args);
  issueMessages = (...args: Parameters<RentalViewModel["issueMessages"]>) => this.view.issueMessages(...args);
  display = (...args: Parameters<RentalViewModel["display"]>) => this.view.display(...args);
  preparedValues = (...args: Parameters<RentalViewModel["preparedValues"]>) => this.view.preparedValues(...args);
  get parameterSearch() { return this.view.parameterSearch; }
  set parameterSearch(value: RentalViewModel["parameterSearch"]) { this.view.parameterSearch = value; }
  get filledOnly() { return this.view.filledOnly; }
  set filledOnly(value: RentalViewModel["filledOnly"]) { this.view.filledOnly = value; }
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
  addressChanged(address: Address | null) {
    if (this.busy) return;
    this.replaceAddress(address);
    this.aiAddress = null; this.aiAddressFacts = [];
    const dependent = this.schema?.card?.addressDependentFacts || [];
    this.aiConflicts = this.aiConflicts.filter(item => !dependent.includes(item.field));
    this.changed();
  }
  private replaceAddress(address: Address | null) {
    if (this.house.id !== this.id)
      this.house = { id: this.id, address: this.draft.address?.confirmed ? this.draft.address : null };
    const previous = this.house.address, cleared = blankAddress(address);
    this.draft.address = address;
    this.resetFacts = null;
    // Coordinates and native address parts belong to any address text.
    for (const key of ["location.settlement", "location.street", "location.house_number", "location.latitude", "location.longitude"])
      delete this.draft.values[key];
    for (const p of this.platforms)
      for (const key of this.schema?.platforms[p].addressBoundFields || []) delete this.draft.extras[p]?.[key];
    // Nearby facts belong to a confirmed house: typing and manual parts keep them.
    if (cleared || (address?.confirmed && previous && houseKey(previous) !== houseKey(address))) this.dropFacts();
    this.house.address = cleared ? null : address?.confirmed ? address : previous;
  }
  private dropFacts() {
    const values: Record<string, JsonValue> = {}, evidence: Record<string, string> = {};
    for (const key of this.schema?.card?.addressDependentFacts || []) {
      if (hasValue(this.draft.values[key])) {
        values[key] = this.draft.values[key];
        const quote = this.draft.aiEvidence?.[key];
        if (quote !== undefined) evidence[key] = quote;
      }
      delete this.draft.values[key];
      delete this.draft.aiEvidence?.[key];
    }
    const ids = Object.keys(values);
    if (ids.length) this.resetFacts = { names: ids.map(id => this.view.fieldName(id)), values, evidence };
  }
  restoreFacts() {
    const facts = this.resetFacts;
    if (this.busy || !facts) return;
    Object.assign(this.draft.values, facts.values);
    if (Object.keys(facts.evidence).length) Object.assign((this.draft.aiEvidence ||= {}), facts.evidence);
    this.resetFacts = null;
    this.changed();
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
  get description() { return String(this.draft.values["listing.description"] || ""); }
  setDescription(value: string) {
    if (this.busy) return;
    this.draft.values["listing.description"] = value;
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
    this.panel = null; this.pendingDelete = null;
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
  setExtra(p: string, f: Field, raw: JsonValue) {
    // Keep typed decimal text intact until the server's exact BigDecimal conversion.
    this.draft.extras[p] ||= {};
    this.draft.extras[p][f.id] = raw;
    this.changed();
  }
  extraFiles(p: string, field: Field, text: string) {
    this.setExtra(
      p,
      field,
      text
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  toggleExtra(p: string, f: Field, value: JsonValue, checked: boolean) {
    const old = this.extra(p, f.id);
    const values = Array.isArray(old) ? old : [];
    this.setExtra(
      p,
      f,
      (checked
        ? [...values, value]
        : values.filter((x) => x !== value)) as string[],
    );
  }
  @HostListener("window:beforeunload", ["$event"])
  unload(event: BeforeUnloadEvent) {
    if (this.dirty) { event.preventDefault(); event.returnValue = ""; }
  }
  ngOnDestroy() { this.store.destroy(); clearTimeout(this.focusTimer); }
}
