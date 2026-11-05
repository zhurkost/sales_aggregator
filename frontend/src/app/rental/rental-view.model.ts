import type { Field, JsonValue, Prepared, RentalDraft } from "./rental-models";
import { hasValue } from "./rental-values";
import { RentalDraftStore } from "./rental-draft.store";

/** Read-only projection of the current draft for presentation. Never saves or calls APIs. */
export class RentalViewModel {
  parameterSearch = "";
  filledOnly = false;
  constructor(private store: RentalDraftStore) {}
  value(field: Field) {
    const v = this.store.draft.values[field.id];
    return Array.isArray(v) ? v.join("\n") : String(v ?? "");
  }
  choices(field: Field) {
    return this.store.schema?.canonicalValues[field.id] || [];
  }
  label(value: string) { return this.store.schema?.card?.valueLabels?.[value] || value; }
  platformName(p: string) { return this.store.schema?.platforms[p]?.name || p; }
  groupFields(group: Field) {
    return group.options.filter(f => !f.uses?.length || f.uses.some(u => this.store.draft.platforms.includes(u.platform) && this.store.applicability.field(u.platform, u.target) !== false));
  }
  usedBy(field: Field) {
    return [...new Set(field.uses?.map(u => u.platform).filter(p => this.store.draft.platforms.includes(p)) || [])];
  }
  hasChoice(field: Field, choice: string) {
    const value = this.store.draft.values[field.id];
    return Array.isArray(value) && value.includes(choice);
  }
  filled(group: Field) {
    return this.groupFields(group).filter(f => {
      const value = this.store.draft.values[f.id];
      return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0);
    }).length;
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
      (!query || (g.name + " " + f.name + " " + this.valueLabel(this.store.draft.values[f.id])).toLocaleLowerCase().includes(query))
    )})).filter(g => g.options.length);
  }
  get additionalFilled() {
    return (this.store.schema?.category.options || []).filter(g => g.id !== "group.main").flatMap(g => this.groupFields(g))
      .filter(f => f.id !== "listing.description" && hasValue(this.store.draft.values[f.id]));
  }
  fieldName(id: string) { return this.store.schema?.category.options.flatMap(g => g.options).find(f => f.id === id)?.name || id; }
  valueLabel(value: JsonValue | undefined) {
    if (value === true) return "Да"; if (value === false) return "Нет";
    if (Array.isArray(value)) return value.map(v => this.label(String(v))).join(", ");
    return this.label(String(value ?? ""));
  }
  legacyLabel(item: NonNullable<RentalDraft["legacy"]>[number]) {
    return this.store.schema?.category.options.flatMap(g => g.options).find(f => f.id === item.source)?.name ||
      this.store.schema?.platforms[item.platform]?.labels[item.field] || "Сохранённое значение";
  }
  issueMessages(result: Prepared) {
    return [...new Set(result.issues.map((issue) => issue.message))];
  }
  display(value: JsonValue) {
    return typeof value === "string" ? value : JSON.stringify(value);
  }
  preparedValues(result: Prepared) {
    const schema = this.store.schema?.platforms[result.platform];
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
          this.display(value),
    }));
  }
}
