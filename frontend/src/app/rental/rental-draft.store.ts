import type { EditorSchema, Prepared, RentalDraft } from "./rental-models";
import { rentalApi } from "./rental-api";
/** Per-editor session: persistence, revision checks and serialized writes. No DOM. */
export class RentalDraftStore {
  constructor(private workspaceId: () => string, private onTransition: () => void) {}
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
  editVersion = 0;
  destroyed = false;
  async load() {
    try {
      this.schema = await rentalApi<EditorSchema>(this.workspaceId(), "editor");
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
      await rentalApi<{ drafts: RentalDraftStore["drafts"] }>(
        this.workspaceId(),
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
  async updateFields() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.flush();
      const schema = await rentalApi<EditorSchema>(this.workspaceId(), "editor");
      const migrated = await rentalApi<RentalDraft>(this.workspaceId(), "normalize", this.draft);
      this.schema = schema; this.draft = migrated; this.onTransition(); this.changed(); this.error = ""; await this.save();
      this.status = "Поля обновлены. Сведения сохранены";
    } catch (e) { this.error = (e as Error).message; } finally { this.busy = false; }
  }
  async saveCopy() {
    if (this.busy) return;
    this.busy = true;
    try { await this.queue.catch(() => {}); this.id = crypto.randomUUID(); this.revision = 0; this.dirty = true; await this.save(); this.error = ""; }
    catch (e) { this.error = (e as Error).message; } finally { this.busy = false; }
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
          this.workspaceId(),
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
      }>(this.workspaceId(), "drafts/" + id);
      if (beforeLoad !== this.editVersion) throw new Error("Текущая карточка изменилась. Сначала сохраните её, затем откройте другую.");
      this.id = result.id;
      this.revision = result.revision;
      this.draft = result.draft;
      this.onTransition();
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
    this.onTransition();
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
      await rentalApi(this.workspaceId(), "drafts/" + id + "/delete", { revision });
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
        this.workspaceId(),
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
  destroy() { this.destroyed = true; clearTimeout(this.timer); }
}
