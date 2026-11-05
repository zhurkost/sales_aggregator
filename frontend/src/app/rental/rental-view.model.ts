import { computed, signal } from "@angular/core";
import type { Field, FieldGroup, JsonValue, Prepared, RentalDraft } from "./rental-models";
import { hasValue } from "./rental-values";
import { RentalDraftStore } from "./rental-draft.store";
import { DESCRIPTION, MAIN_GROUP } from "./card-fields.generated";

/**
 * Read-only projection of the current draft for presentation. Never saves or calls APIs. The lists
 * the editor draws are computed from the store's signals, once per change, not on every cycle.
 */
export class RentalViewModel {
  private readonly search = signal("");
  private readonly filled = signal(false);
  get parameterSearch() { return this.search(); }
  set parameterSearch(value: string) { this.search.set(value); }
  get filledOnly() { return this.filled(); }
  set filledOnly(value: boolean) { this.filled.set(value); }
  constructor(private store: RentalDraftStore) {}
  label(value: string) { return this.store.schema?.card.valueLabels[value] || value; }
  platformName(p: string) { return this.store.schema?.platforms[p]?.name || p; }
  private get groups(): FieldGroup[] { return this.store.schema?.groups || []; }
  private get allFields(): Field[] { return this.groups.flatMap(g => g.fields); }
  /** The fields of a group the server shows for this card and its platforms. */
  groupFields(group: FieldGroup) {
    return group.fields.filter(f => this.store.fields.fields.has(f.id));
  }
  /** Shown card fields that no chosen platform's form receives yet, as the server says. */
  readonly untransferredFields = computed(() =>
    [...this.store.fields.fields.values()].filter(f => !f.transferred).map(f => f.id));
  get untransferred() { return this.untransferredFields(); }
  readonly issues = computed(() => {
    const groups = new Map<string, {source: string; message: string; platforms: string[]}>();
    const fields = this.allFields;
    for (const result of this.store.results) for (const issue of result.issues) {
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
  });
  get groupedIssues() { return this.issues(); }
  canFocus(source: string) {
    return source === "legacy" || source === "address" && !this.store.draft.address?.label ||
      this.groups.some(g => g.id === source || g.fields.some(f => f.id === source));
  }
  readonly main = computed(() => {
    const main = this.groups.find(g => g.id === MAIN_GROUP);
    return main ? this.groupFields(main) : [];
  });
  get mainFields() { return this.main(); }
  readonly additional = computed(() => {
    const query = this.parameterSearch.trim().toLocaleLowerCase();
    return this.groups.filter(g => g.id !== MAIN_GROUP).map(g => ({...g, fields:this.groupFields(g).filter(f =>
      f.id !== DESCRIPTION && (!this.filledOnly || hasValue(this.store.draft.values[f.id])) &&
      (!query || (g.name + " " + f.name + " " + this.valueLabel(f.id, this.store.draft.values[f.id])).toLocaleLowerCase().includes(query))
    )})).filter(g => g.fields.length);
  });
  get additionalGroups() { return this.additional(); }
  readonly filledFields = computed(() =>
    this.groups.filter(g => g.id !== MAIN_GROUP).flatMap(g => this.groupFields(g))
      .filter(f => f.id !== DESCRIPTION && hasValue(this.store.draft.values[f.id])));
  get additionalFilled() { return this.filledFields(); }
  fieldName(id: string) { return this.allFields.find(f => f.id === id)?.name || id; }
  valueLabel(id: string, value: JsonValue | undefined) {
    if (value === true) return "Да"; if (value === false) return "Нет";
    if (Array.isArray(value)) return value.map(v => this.label(String(v))).join(", ");
    return this.label(String(value ?? ""));
  }
  legacyLabel(item: NonNullable<RentalDraft["legacy"]>[number]) {
    return this.allFields.find(f => f.id === item.source)?.name ||
      this.store.schema?.platforms[item.platform]?.labels[item.field] || "Сохранённое значение";
  }
  display(value: JsonValue) {
    return typeof value === "string" ? value : JSON.stringify(value);
  }
  /**
   * The platform's state in the check: never «Подготовлено» while fields stay manual. The server's
   * manual_fields remark only says so; any other remark asks to check the card.
   */
  checkStatus(result: Prepared) {
    if (this.store.check.stale) return "Ожидает проверки";
    if (result.issues.some((issue) => issue.code !== "manual_fields")) return "Нужна проверка";
    if (result.manual.length) return "Часть вручную";
    return result.checksPassed ? "Подготовлено" : "Нужна проверка";
  }
  transferLine(result: Prepared) {
    const n = result.form.length, tens = n % 100, ones = n % 10;
    const fields = tens >= 11 && tens <= 14 ? "полей" : ones === 1 ? "поле" : ones >= 2 && ones <= 4 ? "поля" : "полей";
    return `Уйдёт в форму: ${n} ${fields} · Вручную на площадке: ${result.manual.length}`;
  }
}
