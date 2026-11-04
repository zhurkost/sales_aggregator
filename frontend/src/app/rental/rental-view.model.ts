import type { Field, JsonValue, Prepared, RentalDraft } from "./rental-models";
import { hasValue } from "./rental-values";
import { RentalDraftStore } from "./rental-draft.store";
import { applicable } from "./conditions";

/** Read-only projection of the current draft for presentation. Never saves or calls APIs. */
export class RentalViewModel {
  parameterSearch = "";
  filledOnly = false;
  constructor(private store: RentalDraftStore) {}
  label(value: string) { return this.store.schema?.card?.valueLabels?.[value] || value; }
  platformName(p: string) { return this.store.schema?.platforms[p]?.name || p; }
  groupFields(group: Field) {
    return group.options.filter(f => !f.uses?.length || f.uses.some(u => this.store.draft.platforms.includes(u.platform) && applicable(u.when, this.context(u.platform)) !== false));
  }
  get groupedIssues() {
    const groups = new Map<string, {source: string; message: string; platforms: string[]}>();
    const fields = this.store.schema?.category.options.flatMap(g => g.options) || [];
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
  }
  canFocus(source: string) {
    return source === "legacy" || source === "address" && !this.store.draft.address?.label ||
      !!this.store.schema?.category.options.some(g => g.id === source || g.options.some(f => f.id === source));
  }
  get mainFields() {
    const main = this.store.schema?.category.options.find(g => g.id === "group.main");
    return main ? this.groupFields(main) : [];
  }
  get additionalGroups() {
    const query = this.parameterSearch.trim().toLocaleLowerCase();
    return (this.store.schema?.category.options || []).filter(g => g.id !== "group.main").map(g => ({...g, options:this.groupFields(g).filter(f =>
      f.id !== "listing.description" && (!this.filledOnly || hasValue(this.store.draft.values[f.id])) &&
      (!query || (g.name + " " + f.name + " " + this.valueLabel(f.id, this.store.draft.values[f.id])).toLocaleLowerCase().includes(query))
    )})).filter(g => g.options.length);
  }
  get additionalFilled() {
    return (this.store.schema?.category.options || []).filter(g => g.id !== "group.main").flatMap(g => this.groupFields(g))
      .filter(f => f.id !== "listing.description" && hasValue(this.store.draft.values[f.id]));
  }
  fieldName(id: string) { return this.store.schema?.category.options.flatMap(g => g.options).find(f => f.id === id)?.name || id; }
  valueLabel(id: string, value: JsonValue | undefined) {
    if (value === true) return "Да"; if (value === false) return "Нет";
    if (Array.isArray(value)) return value.map(v => this.label(String(v))).join(", ");
    return this.label(String(value ?? ""));
  }
  legacyLabel(item: NonNullable<RentalDraft["legacy"]>[number]) {
    return this.store.schema?.category.options.flatMap(g => g.options).find(f => f.id === item.source)?.name ||
      this.store.schema?.platforms[item.platform]?.labels[item.field] || "Сохранённое значение";
  }
  context(p: string) {
    const schema = this.store.schema?.platforms[p];
    const values: Record<string, JsonValue> = { ...schema?.constants };
    for (const binding of schema?.bindings || []) {
      const pair = binding.pairs.find(
        (pair) => pair.from === this.store.draft.values[binding.source],
      );
      if (pair && values[binding.target] == null)
        values[binding.target] = pair.to;
      else if (pair && values[binding.target] === "")
        values[binding.target] = pair.to;
    }
    for (const row of schema?.rules || []) {
      const input = this.store.draft.values[row.common_option_id];
      if (input === undefined || input === null || input === "") continue;
      const cv = row.conversion;
      if (cv.kind === "identity") values[row.platform_option_id] = input;
      if (cv.kind === "decimal" && typeof input === "string" && /^-?\d+([,.]\d+)?$/.test(input)) values[row.platform_option_id] = Number(input.replace(",", "."));
    }
    return values;
  }
  display(value: JsonValue) {
    return typeof value === "string" ? value : JSON.stringify(value);
  }
  /** The platform's state in the check: never «Подготовлено» while fields stay manual. */
  checkStatus(result: Prepared) {
    if (this.store.check.stale) return "Ожидает проверки";
    if (!result.checksPassed) return "Нужна проверка";
    return result.manual.length ? "Часть вручную" : "Подготовлено";
  }
  transferLine(result: Prepared) {
    const n = result.form.length, tens = n % 100, ones = n % 10;
    const fields = tens >= 11 && tens <= 14 ? "полей" : ones === 1 ? "поле" : ones >= 2 && ones <= 4 ? "поля" : "полей";
    return `Уйдёт в форму: ${n} ${fields} · Вручную на площадке: ${result.manual.length}`;
  }
  formValues(result: Prepared) {
    return result.form.map((v) => ({ id: v.field, name: v.name, value: this.prepared(result.platform, v.field, v.value) }));
  }
  manualValues(result: Prepared) {
    return result.manual.map((v) => ({ id: v.field, name: v.name, value: this.prepared(result.platform, v.field, v.value), reason: v.reason }));
  }
  private prepared(platform: string, id: string, value: JsonValue) {
    const choices = this.store.schema?.platforms[platform]?.choiceLabels[id];
    if (Array.isArray(value)) return value.map((v) => choices?.[JSON.stringify(v)] || this.display(v)).join(", ");
    return choices?.[JSON.stringify(value)] ||
      (id.endsWith(".description")
        ? String(this.store.draft.values["listing.description"] || value)
        : this.display(value));
  }
}
