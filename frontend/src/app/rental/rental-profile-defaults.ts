import type { EditorSchema, RentalDraft } from "./rental-models";

export type RentalProfile = {
  phone?: string;
  contactPerson?: string;
  company?: string;
};

/** Copy only declared defaults, preserving even an explicitly cleared card field. */
export function applyProfileDefaults(
  draft: RentalDraft,
  schema: EditorSchema | null,
  profile: RentalProfile,
): boolean {
  let changed = false;
  const fields = new Set(
    schema?.category.options.flatMap((group) =>
      group.options.map((field) => field.id),
    ),
  );
  for (const rule of schema?.card?.profileDefaults || []) {
    if (!fields.has(rule.field) || Object.hasOwn(draft.values, rule.field))
      continue;
    const value = profile[rule.setting]?.trim();
    if (!value) continue;
    draft.values[rule.field] =
      rule.setting === "phone" ? value.replace(/[\s()-]/g, "") : value;
    changed = true;
  }
  return changed;
}
