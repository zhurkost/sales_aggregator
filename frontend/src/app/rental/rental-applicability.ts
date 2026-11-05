import { rentalApi } from "./rental-api";
import type { RentalCard } from "./rental-models";

type Context = { workspace: string; id: string; version: number; schemaVersion?: string;
  enabled: boolean; destroyed: boolean; card: RentalCard };
type Result = { schemaVersion: string; platforms: Record<string, Record<string, boolean | null>> };

/** Presentation consumes server decisions. It never executes marketplace rules. */
export class RentalApplicability {
  private fields: Result["platforms"] = {};
  private owner?: Context;
  private sequence = 0;
  private timer?: ReturnType<typeof setTimeout>;
  error = "";
  loading = false;
  constructor(private context: () => Context) {}

  field(platform: string, id: string): boolean | null {
    const now = this.context();
    if (!this.owner || this.owner.id !== now.id || this.owner.workspace !== now.workspace ||
        this.owner.schemaVersion !== now.schemaVersion) return null;
    return this.fields[platform]?.[id] ?? null;
  }
  schedule() {
    clearTimeout(this.timer);
    this.sequence++;
    this.loading = false;
    if (!this.context().enabled || this.context().destroyed) return;
    this.timer = setTimeout(() => void this.refresh(), 500);
  }
  clear() {
    clearTimeout(this.timer);
    this.sequence++;
    this.fields = {};
    this.owner = undefined;
    this.error = "";
    this.loading = false;
  }
  async refresh() {
    clearTimeout(this.timer);
    const before = this.context(), request = ++this.sequence;
    if (!before.enabled || before.destroyed) return;
    this.loading = true;
    this.error = "";
    const current = () => {
      const now = this.context();
      return request === this.sequence && !now.destroyed && before.workspace === now.workspace &&
        before.id === now.id && before.version === now.version && before.schemaVersion === now.schemaVersion;
    };
    try {
      const result = await rentalApi<Result>(before.workspace, "applicability", structuredClone(before.card));
      if (!current()) return;
      if (result.schemaVersion !== before.schemaVersion) throw new Error("Правила обновились. Обновите поля карточки.");
      this.fields = result.platforms;
      this.owner = before;
    } catch {
      if (!current()) return;
      this.fields = {};
      this.error = "Не удалось уточнить доступные параметры. Показаны все параметры выбранных площадок.";
    } finally {
      if (request === this.sequence) this.loading = false;
    }
  }
}
