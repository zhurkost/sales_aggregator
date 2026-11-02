import {
  Component,
  Input,
  OnInit,
  OnDestroy,
  HostListener,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { AddressInputComponent } from "./address-input.component";
import { applicable } from "./conditions";
import {
  Address,
  EditorSchema,
  Field,
  JsonValue,
  Prepared,
  RentalDraft,
  rentalApi,
} from "./rental-api";

@Component({
  selector: "app-rental-editor",
  standalone: true,
  imports: [FormsModule, CommonModule, AddressInputComponent],
  templateUrl: "./rental-editor.component.html",
  styleUrl: "./rental-editor.component.css",
})
export class RentalEditorComponent implements OnInit, OnDestroy {
  @Input({ required: true }) workspaceId = "";
  schema: EditorSchema | null = null;
  draft: RentalDraft = {
    schemaVersion: "",
    values: {},
    extras: {},
    platforms: [],
    address: null,
  };
  id: string = crypto.randomUUID();
  revision = 0;
  dirty = false;
  status = "";
  error = "";
  busy = false;
  pendingDelete: string | null = null;
  deletingId: string | null = null;
  drafts: { id: string; title: string; address: string; revision: number }[] =
    [];
  results: Prepared[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private queue: Promise<void> = Promise.resolve();
  private editVersion = 0;
  private destroyed = false;
  async ngOnInit() {
    try {
      this.schema = await rentalApi<EditorSchema>(this.workspaceId, "editor");
      this.draft.schemaVersion = this.schema.version;
      this.draft.modelVersion = this.schema.card?.version;
      this.draft.platforms = this.platforms;
      await this.refresh();
    } catch (e) {
      this.error = (e as Error).message;
    }
  }
  get platforms() {
    return Object.keys(this.schema?.platforms || {});
  }
  async refresh() {
    this.drafts = (
      await rentalApi<{ drafts: RentalEditorComponent["drafts"] }>(
        this.workspaceId,
        "drafts",
      )
    ).drafts;
  }
  changed() {
    this.editVersion++;
    this.dirty = true;
    this.results = [];
    this.status = "Есть изменения";
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.save().catch((e) => (this.error = e.message));
    }, 900);
  }
  setValue(field: Field, value: string) {
    if (this.busy) return;
    this.draft.values[field.id] =
      field.type === "files"
        ? value
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
        : value;
    this.changed();
  }
  value(field: Field) {
    const v = this.draft.values[field.id];
    return Array.isArray(v) ? v.join("\n") : String(v ?? "");
  }
  choices(field: Field) {
    return this.schema?.canonicalValues[field.id] || [];
  }
  label(value: string) { return this.schema?.card?.valueLabels?.[value] || value; }
  addressChanged(address: Address | null) {
    if (this.busy) return;
    this.draft.address = address;
    for (const key of ["location.settlement", "location.street", "location.house_number", "location.latitude", "location.longitude"])
      delete this.draft.values[key];
    for (const key of this.schema?.card?.addressDependentFacts || []) delete this.draft.values[key];
    for (const p of this.platforms)
      for (const key of this.schema?.platforms[p].addressBoundFields || []) delete this.draft.extras[p]?.[key];
    this.changed();
  }
  platformName(p: string) { return this.schema?.platforms[p]?.name || p; }
  groupFields(group: Field) {
    return group.options.filter(f => !f.uses?.length || f.uses.some(u => this.draft.platforms.includes(u.platform) && applicable(u.when, this.context(u.platform)) !== false));
  }
  usedBy(field: Field) {
    return [...new Set(field.uses?.map(u => u.platform).filter(p => this.draft.platforms.includes(p)) || [])];
  }
  setTyped(field: Field, value: JsonValue) {
    if (this.busy) return;
    this.draft.values[field.id] = value;
    this.changed();
  }
  toggleChoice(field: Field, choice: string, selected: boolean) {
    const old = this.draft.values[field.id];
    const values = Array.isArray(old) ? old : [];
    this.setTyped(field, (selected ? [...new Set([...values, choice])] : values.filter(x => x !== choice)) as string[]);
  }
  hasChoice(field: Field, choice: string) {
    const value = this.draft.values[field.id];
    return Array.isArray(value) && value.includes(choice);
  }
  filled(group: Field) {
    return this.groupFields(group).filter(f => {
      const value = this.draft.values[f.id];
      return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0);
    }).length;
  }
  get groupedIssues() {
    const groups = new Map<string, {source: string; message: string; platforms: string[]}>();
    const fields = this.schema?.category.options.flatMap(g => g.options) || [];
    for (const result of this.results) for (const issue of result.issues) {
      const source = issue.source || "";
      const name = fields.find(f => f.id === source)?.name;
      const shared = ["required", "condition", "legacy"].includes(issue.code);
      const key = source === "address" ? "address" : (source || issue.field) + ":" + issue.code + (shared ? "" : ":" + issue.message);
      let message = issue.message;
      if (issue.code === "required" && name) message = `Заполните «${name}».`;
      if (issue.code === "condition" && name) message = `«${name}»: сначала уточните связанные параметры.`;
      const entry = groups.get(key) || {source, message, platforms: []};
      if (!entry.platforms.includes(result.platform)) entry.platforms.push(result.platform);
      groups.set(key, entry);
    }
    return [...groups.values()];
  }
  canFocus(source: string) {
    return source === "legacy" || source === "address" && !this.draft.address?.label ||
      !!this.schema?.category.options.some(g => g.id === source || g.options.some(f => f.id === source));
  }
  async updateFields() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.flush();
      const schema = await rentalApi<EditorSchema>(this.workspaceId, "editor");
      const migrated = await rentalApi<RentalDraft>(this.workspaceId, "normalize", this.draft);
      this.schema = schema; this.draft = migrated; this.changed(); this.error = ""; await this.save();
      this.status = "Поля обновлены. Сведения сохранены";
    } catch (e) { this.error = (e as Error).message; } finally { this.busy = false; }
  }
  focusField(id: string) {
    const el = document.getElementById("rental-" + id);
    if (!el) return;
    if (el instanceof HTMLDetailsElement) el.open = true;
    let parent = el.parentElement;
    while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; }
    el.scrollIntoView({behavior: "smooth", block: "center"}); el.focus();
  }
  legacyLabel(item: NonNullable<RentalDraft["legacy"]>[number]) {
    return this.schema?.category.options.flatMap(g => g.options).find(f => f.id === item.source)?.name ||
      this.schema?.platforms[item.platform]?.labels[item.field] || "Сохранённое значение";
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
  async saveCopy() {
    if (this.busy) return;
    this.busy = true;
    try { await this.queue.catch(() => {}); this.id = crypto.randomUUID(); this.revision = 0; this.dirty = true; await this.save(); this.error = ""; }
    catch (e) { this.error = (e as Error).message; } finally { this.busy = false; }
  }
  togglePlatform(p: string, checked: boolean) {
    if (this.busy) return;
    this.draft.platforms = checked
      ? [...new Set([...this.draft.platforms, p])]
      : this.draft.platforms.filter((x) => x !== p);
    this.changed();
  }
  extra(p: string, id: string) {
    return this.draft.extras[p]?.[id] ?? "";
  }
  setExtra(p: string, f: Field, raw: JsonValue) {
    // Keep typed decimal text intact until the server's exact BigDecimal conversion.
    this.draft.extras[p] ||= {};
    this.draft.extras[p][f.id] = raw;
    this.changed();
  }
  selected(p: string, f: Field, value: JsonValue) {
    const xs = this.extra(p, f.id);
    return Array.isArray(xs) && xs.some((x) => x === value);
  }
  context(p: string) {
    const schema = this.schema?.platforms[p];
    const values = { ...this.draft.extras[p], ...schema?.constants };
    for (const binding of schema?.bindings || []) {
      const pair = binding.pairs.find(
        (pair) => pair.from === this.draft.values[binding.source],
      );
      if (pair && values[binding.target] == null)
        values[binding.target] = pair.to;
      else if (pair && values[binding.target] === "")
        values[binding.target] = pair.to;
    }
    for (const row of schema?.rules || []) {
      const input = this.draft.values[row.common_option_id];
      if (input === undefined || input === null || input === "") continue;
      const cv = row.conversion;
      if (cv.kind === "identity") values[row.platform_option_id] = input;
      if (cv.kind === "decimal" && typeof input === "string" && /^-?\d+([,.]\d+)?$/.test(input)) values[row.platform_option_id] = Number(input.replace(",", "."));
    }
    return values;
  }
  availableExtras(p: string) {
    const values = this.context(p);
    return (
      this.schema?.platforms[p].extras.filter(
        (f) => applicable(f.uiWhen, values) === true,
      ) || []
    );
  }
  waitingExtras(p: string) {
    const values = this.context(p);
    return this.schema?.platforms[p].extras.some(
      (f) => applicable(f.uiWhen, values) === null,
    );
  }
  nativeChoices(p: string, field: Field) {
    const values = this.context(p);
    return field.options.filter(
      (option) => applicable(option.fill_rule["when"], values) === true,
    );
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
  extraFileText(p: string, field: Field) {
    const value = this.extra(p, field.id);
    return Array.isArray(value) ? value.join("\n") : String(value);
  }
  issueMessages(result: Prepared) {
    return [...new Set(result.issues.map((issue) => issue.message))];
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
  save(): Promise<void> {
    clearTimeout(this.timer);
    const save = this.queue
      .catch(() => {})
      .then(async () => {
        if (!this.dirty || this.deletingId === this.id) return;
        const version = this.editVersion,
          id = this.id,
          snapshot = structuredClone(this.draft);
        this.status = "Сохраняем…";
        const result = await rentalApi<{ revision: number }>(
          this.workspaceId,
          "drafts/" + id,
          { revision: this.revision, draft: snapshot },
        );
        if (this.id === id) {
          this.revision = result.revision;
          this.dirty = this.editVersion !== version;
          this.status = this.dirty
            ? "Есть новые изменения"
            : "Сохранено в кабинете";
        }
        if (!this.destroyed) await this.refresh();
      });
    this.queue = save;
    return save;
  }
  async flush() {
    // Leaving the editor must also save changes typed while a prior request was running.
    do {
      await this.save();
    } while (this.dirty);
  }
  async open(id: string) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    this.pendingDelete = null;
    try {
      await this.flush();
      const beforeLoad = this.editVersion;
      const result = await rentalApi<{
        id: string;
        revision: number;
        draft: RentalDraft;
      }>(this.workspaceId, "drafts/" + id);
      if (beforeLoad !== this.editVersion) throw new Error("Текущая карточка изменилась. Сначала сохраните её, затем откройте другую.");
      this.id = result.id;
      this.revision = result.revision;
      this.draft = result.draft;
      this.results = [];
      this.dirty = false;
      this.status = "Карточка открыта";
      if (this.schema && this.draft.schemaVersion !== this.schema.version)
        this.error =
          "Правила обновились. Нажмите «Обновить поля карточки» — введённые сведения сохранятся.";
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }
  async fresh() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.flush();
      this.resetDraft();
      this.status = "Новая карточка";
      this.error = "";
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }
  private resetDraft() {
    clearTimeout(this.timer);
    this.editVersion++;
    this.id = crypto.randomUUID();
    this.revision = 0;
    this.results = [];
    this.draft = {
      modelVersion: this.schema?.card?.version,
      schemaVersion: this.schema?.version || "",
      values: {},
      extras: {},
      platforms: this.platforms,
      address: null,
    };
    this.dirty = false;
    this.pendingDelete = null;
  }
  async remove(id: string) {
    if (this.busy || this.pendingDelete !== id) return;
    this.busy = true;
    this.deletingId = id;
    this.error = "";
    if (this.id === id) clearTimeout(this.timer);
    // Finish an already-running save first; queued saves of this card are skipped.
    // Later saves stay behind deletion and cannot recreate the removed card.
    const removal = this.queue.catch(() => {}).then(async () => {
      const item = this.drafts.find((draft) => draft.id === id);
      if (!item) throw new Error("Квартира не найдена. Обновите список.");
      const revision = this.id === id ? this.revision : item.revision;
      await rentalApi(this.workspaceId, "drafts/" + id + "/delete", { revision });
      this.drafts = this.drafts.filter((draft) => draft.id !== id);
      if (this.id === id) this.resetDraft();
      this.pendingDelete = null;
      this.status = "Квартира удалена";
    });
    this.queue = removal;
    try {
      await removal;
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.deletingId = null;
      this.busy = false;
    }
  }
  acceptSchema() {
    if (this.schema) {
      this.draft.schemaVersion = this.schema.version;
      this.error = "";
      this.changed();
    }
  }
  async prepare() {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    const version = this.editVersion;
    try {
      await this.flush();
      const result = await rentalApi<{ platforms: Prepared[] }>(
        this.workspaceId,
        "prepare",
        structuredClone(this.draft),
      );
      if (version === this.editVersion) this.results = result.platforms;
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }
  display(value: JsonValue) {
    return typeof value === "string" ? value : JSON.stringify(value);
  }
  preparedValues(result: Prepared) {
    const schema = this.schema?.platforms[result.platform];
    return Object.entries(result.values).map(([id, value]) => ({
      id,
      name: schema?.labels[id] || id,
      value: Array.isArray(value)
        ? value
            .map(
              (v) =>
                schema?.choiceLabels[id]?.[JSON.stringify(v)] ||
                this.display(v),
            )
            .join(", ")
        : schema?.choiceLabels[id]?.[JSON.stringify(value)] ||
          (id.endsWith(".description")
            ? String(this.draft.values["listing.description"] || value)
            : this.display(value)),
    }));
  }
  @HostListener("window:beforeunload", ["$event"]) unload(
    event: BeforeUnloadEvent,
  ) {
    if (this.dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  }
  ngOnDestroy() {
    this.destroyed = true;
    clearTimeout(this.timer);

  }
}
