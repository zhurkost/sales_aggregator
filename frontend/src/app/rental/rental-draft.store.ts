import type { EditorSchema, Prepared, RentalDraft } from "./rental-models";
import { RentalApiError, rentalApi } from "./rental-api";
import { RentalCardCheck } from "./rental-card-check";
import {
  applyProfileDefaults,
  type RentalProfile,
} from "./rental-profile-defaults";
import { rentalPhotos } from "./rental-photos";
const CONFLICT =
  "Карточка изменена в другой вкладке. Сохраните копию или загрузите сохранённую версию.";
/** Per-editor session: persistence, revision checks and serialized writes. No DOM. */
export class RentalDraftStore {
  constructor(
    private workspaceId: () => string,
    private onTransition: () => void,
    private profile: () => RentalProfile = () => ({}),
  ) {}
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
  /** The server has a newer revision: autosave stops until a copy is saved or it is loaded. */
  conflict = false;
  status = "";
  error = "";
  busy = false;
  pendingDelete: string | null = null;
  deletingId: string | null = null;
  drafts: { id: string; title: string; address: string; revision: number }[] =
    [];
  readonly check = new RentalCardCheck(() => ({
    workspace: this.workspaceId(),
    id: this.id,
    version: this.editVersion,
    draft: this.draft,
    destroyed: this.destroyed,
  }));
  get results() {
    return this.check.results;
  }
  set results(value: Prepared[]) {
    this.check.results = value;
  }
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
      applyProfileDefaults(this.draft, this.schema, this.profile());
      await this.refresh();
    } catch (e) {
      this.error = (e as Error).message;
    }
  }
  get platforms() {
    return Object.keys(this.schema?.platforms || {});
  }
  /** Full list from the server: on editor load and when «Мои квартиры» opens. */
  async refresh() {
    await this.queue.catch(() => {});
    this.drafts = (
      await rentalApi<{ drafts: RentalDraftStore["drafts"] }>(
        this.workspaceId(),
        "drafts",
      )
    ).drafts;
  }
  // Same projection and order (latest first) as the server list, without re-reading it.
  private listed(id: string, revision: number, draft: RentalDraft) {
    const title = draft.values["listing.title"];
    const item = {
      id,
      revision,
      title: title === null || Array.isArray(title) ? "" : String(title ?? ""),
      address: draft.address?.label || "",
    };
    this.drafts = [item, ...this.drafts.filter((d) => d.id !== id)];
  }
  changed() {
    this.editVersion++;
    this.dirty = true;
    this.check.invalidate();
    this.status = "Есть изменения";
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      try {
        await this.save();
        if (
          !this.destroyed &&
          !this.dirty &&
          !this.busy &&
          this.check.checked &&
          this.check.stale
        )
          await this.check.refresh();
      } catch (e) {
        this.error = (e as Error).message;
      }
    }, 1200);
  }
  async updateFields() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.flush();
      const schema = await rentalApi<EditorSchema>(
        this.workspaceId(),
        "editor",
      );
      const migrated = await rentalApi<RentalDraft>(
        this.workspaceId(),
        "normalize",
        this.draft,
      );
      this.schema = schema;
      this.draft = migrated;
      this.check.clear();
      this.onTransition();
      this.changed();
      this.error = "";
      await this.save();
      this.status = "Поля обновлены. Сведения сохранены";
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }
  async saveCopy() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.queue.catch(() => {});
      this.id = crypto.randomUUID();
      this.revision = 0;
      this.dirty = true;
      this.conflict = false;
      await this.save();
      this.error = "";
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }
  save(): Promise<void> {
    clearTimeout(this.timer);
    const save = this.queue
      .catch(() => {})
      .then(async () => {
        if (!this.dirty || this.deletingId === this.id || this.conflict) return;
        const version = this.editVersion,
          id = this.id,
          snapshot = structuredClone(this.draft);
        this.status = "Сохраняем…";
        const result = await rentalApi<{ revision: number }>(
          this.workspaceId(),
          "drafts/" + id,
          { revision: this.revision, draft: snapshot },
        ).catch((e: unknown) => {
          if (e instanceof RentalApiError && e.status === 409 && this.id === id) {
            this.conflict = true;
            this.status = "Не сохранено";
          }
          throw e;
        });
        if (this.id === id) {
          this.revision = result.revision;
          this.dirty = this.editVersion !== version;
          this.status = this.dirty ? "Есть новые изменения" : "Сохранено";
        }
        this.listed(id, result.revision, snapshot);
      });
    this.queue = save;
    return save;
  }
  async flush() {
    // Leaving the editor must also save changes typed while a prior request was running.
    do {
      await this.save();
      if (this.conflict) throw new Error(CONFLICT);
    } while (this.dirty);
  }
  async open(id: string) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    this.pendingDelete = null;
    try {
      await this.flush();
      await this.read(id, "Карточка открыта");
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }
  /** Leaves a revision conflict by discarding local edits and opening the server revision. */
  async loadSaved() {
    if (this.busy || !this.conflict) return;
    this.busy = true;
    this.error = "";
    try {
      await this.queue.catch(() => {});
      clearTimeout(this.timer);
      this.editVersion++;
      await this.read(this.id, "Открыта сохранённая версия");
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }
  private async read(id: string, status: string) {
    const beforeLoad = this.editVersion;
    const result = await rentalApi<{
      id: string;
      revision: number;
      draft: RentalDraft;
    }>(this.workspaceId(), "drafts/" + id);
    if (beforeLoad !== this.editVersion)
      throw new Error(
        "Текущая карточка изменилась. Сначала сохраните её, затем откройте другую.",
      );
    this.id = result.id;
    this.revision = result.revision;
    this.draft = result.draft;
    this.onTransition();
    this.check.clear();
    this.dirty = false;
    this.conflict = false;
    this.status = status;
    if (applyProfileDefaults(this.draft, this.schema, this.profile()))
      this.changed();
    if (this.schema && this.draft.schemaVersion !== this.schema.version)
      this.error =
        "Правила обновились. Нажмите «Обновить поля карточки» — введённые сведения сохранятся.";
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
    this.check.clear();
    this.draft = {
      modelVersion: this.schema?.card?.version,
      schemaVersion: this.schema?.version || "",
      values: {},
      extras: {},
      platforms: this.platforms,
      address: null,
    };
    applyProfileDefaults(this.draft, this.schema, this.profile());
    this.dirty = false;
    this.conflict = false;
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
    const removal = this.queue
      .catch(() => {})
      .then(async () => {
        const item = this.drafts.find((draft) => draft.id === id);
        if (!item) throw new Error("Квартира не найдена. Обновите список.");
        const revision = this.id === id ? this.revision : item.revision;
        await rentalApi(this.workspaceId(), "drafts/" + id + "/delete", {
          revision,
        });
        await rentalPhotos(this.workspaceId(), id, []).catch(() => {});
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
    if (this.busy || this.check.checking) return;
    this.error = "";
    await Promise.all([
      this.save().catch((e) => {
        this.error = e.message;
      }),
      this.check.refresh(),
    ]);
  }
  destroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
    this.check.clear();
  }
}
