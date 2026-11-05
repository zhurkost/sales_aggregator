import type {
  EditorSchema,
  Prepared,
  RentalDraft,
  RentalListedDraft,
  RentalPhoto,
  RentalPhotos,
  RentalPublication,
} from "./rental-models";
import { inject } from "@angular/core";
import { RentalApi, RentalApiError } from "./rental-api";
import { TITLE } from "./card-fields.generated";
import { RentalCardCheck } from "./rental-card-check";
import { RentalFieldStates } from "./rental-field-states";
import {
  applyProfileDefaults,
  type RentalProfile,
} from "./rental-profile-defaults";
import { forgetLocalRentalPhotos } from "./rental-local-photos";
const CONFLICT =
  "Карточка изменена в другой вкладке. Сохраните копию или загрузите сохранённую версию.";
/** Per-editor session: persistence, revision checks and serialized writes. No DOM. */
export class RentalDraftStore {
  constructor(
    private workspaceId: () => string,
    private onTransition: () => void,
    private profile: () => RentalProfile = () => ({}),
  ) {}
  /** The server's rental API, shared with the parts of this session. */
  readonly api = inject(RentalApi);
  schema: EditorSchema | null = null;
  draft: RentalDraft = {
    cardVersion: "",
    values: {},
    platforms: [],
    address: null,
  };
  id: string = crypto.randomUUID();
  revision = 0;
  /** Photos stored with the card on the server, in their order. */
  photos: RentalPhoto[] = [];
  dirty = false;
  /** The server has a newer revision: autosave stops until a copy is saved or it is loaded. */
  conflict = false;
  status = "";
  error = "";
  busy = false;
  pendingDelete: string | null = null;
  deletingId: string | null = null;
  drafts: RentalListedDraft[] = [];
  readonly check = new RentalCardCheck(this.api, () => ({
    workspace: this.workspaceId(),
    id: this.id,
    version: this.editVersion,
    draft: this.draft,
    destroyed: this.destroyed,
  }));
  /** The card fields to show, as the server answers for this card. */
  readonly fields = new RentalFieldStates(
    this.api,
    () => ({ workspace: this.workspaceId(), draft: this.draft, destroyed: this.destroyed }),
    (message) => (this.error = message),
  );
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
      this.schema = await this.api.request<EditorSchema>(this.workspaceId(), "editor");
      this.draft.cardVersion = this.schema.cardVersion;
      this.draft.modelVersion = this.schema.card.version;
      this.draft.platforms = this.platforms;
      applyProfileDefaults(this.draft, this.schema, this.profile());
      await Promise.all([this.refresh(), this.fields.refresh()]);
    } catch (e) {
      this.error = (e as Error).message;
    }
  }
  get platforms() {
    return Object.keys(this.schema?.platforms || {});
  }
  /** Chooses a platform or leaves it out; the fields it shows come at once. */
  setPlatform(platform: string, chosen: boolean) {
    if (this.busy) return;
    this.draft.platforms = chosen
      ? [...new Set([...this.draft.platforms, platform])]
      : this.draft.platforms.filter((p) => p !== platform);
    this.changed();
    void this.fields.refresh();
  }
  /** Full list from the server: on editor load and when «Мои квартиры» opens. */
  async refresh() {
    await this.queue.catch(() => {});
    this.drafts = (
      await this.api.request<{ drafts: RentalDraftStore["drafts"] }>(
        this.workspaceId(),
        "drafts",
      )
    ).drafts;
  }
  // Same projection and order (latest first) as the server list, without re-reading it.
  private listed(id: string, revision: number, draft: RentalDraft) {
    const title = draft.values[TITLE];
    const item = {
      id,
      revision,
      title: title === null || Array.isArray(title) ? "" : String(title ?? ""),
      address: draft.address?.label || "",
      publications: this.drafts.find((d) => d.id === id)?.publications || [],
    };
    this.drafts = [item, ...this.drafts.filter((d) => d.id !== id)];
  }
  /** The link to the published ad on a platform, which the user copies from it. */
  async setLink(publication: string, url: string) {
    this.error = "";
    try {
      const saved = await this.api.request<RentalPublication>(
        this.workspaceId(),
        "publications/" + publication + "/link",
        { url },
      );
      this.drafts = this.drafts.map((d) => ({
        ...d,
        publications: d.publications.map((p) =>
          p.id === publication ? { ...p, url: saved.url } : p,
        ),
      }));
    } catch (e) {
      this.error = (e as Error).message;
    }
  }
  changed() {
    this.editVersion++;
    this.dirty = true;
    this.check.invalidate();
    this.fields.schedule();
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
      const schema = await this.api.request<EditorSchema>(
        this.workspaceId(),
        "editor",
      );
      const migrated = await this.api.request<RentalDraft>(
        this.workspaceId(),
        "normalize",
        this.draft,
      );
      this.schema = schema;
      this.draft = migrated;
      this.check.clear();
      void this.fields.refresh();
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
      // The photos stay with the card they were added to.
      this.photos = [];
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
    const save = this.queue.catch(() => {}).then(() => this.write());
    this.queue = save;
    return save;
  }
  /** One write of the card; callers run it in the queue. */
  private async write() {
    if (!this.dirty || this.deletingId === this.id || this.conflict) return;
    const version = this.editVersion,
      id = this.id,
      snapshot = structuredClone(this.draft);
    this.status = "Сохраняем…";
    const result = await this.api.request<{ revision: number }>(
      this.workspaceId(),
      "drafts/" + id,
      { revision: this.revision, draft: snapshot },
    ).catch((e: unknown) => this.conflicted(e, id));
    if (this.id === id) {
      this.revision = result.revision;
      this.dirty = this.editVersion !== version;
      this.status = this.dirty ? "Есть новые изменения" : "Сохранено";
    }
    this.listed(id, result.revision, snapshot);
  }
  private conflicted(e: unknown, id: string): never {
    if (e instanceof RentalApiError && e.status === 409 && this.id === id) {
      this.conflict = true;
      this.status = "Не сохранено";
    }
    throw e;
  }
  /** Adds compressed photos (data URLs) to the end of the card. */
  addPhotos(photos: { name: string; dataUrl: string }[]) {
    return this.photoChange("photos", (revision) => ({ revision, photos }));
  }
  removePhoto(photo: string) {
    return this.photoChange("photos/delete", (revision) => ({ revision, photo }));
  }
  /** Moves a photo one place earlier (-1) or later (+1). */
  movePhoto(photo: string, offset: -1 | 1) {
    return this.photoChange("photos/order", (revision) => {
      const order = this.photos.map((p) => p.id),
        from = order.indexOf(photo),
        to = from + offset;
      if (from >= 0 && to >= 0 && to < order.length)
        [order[from], order[to]] = [order[to], order[from]];
      return { revision, order };
    });
  }
  /**
   * A photo change is a new revision of the saved card, so it queues with the saves: it uses the
   * revision the last save produced and the next save uses the one it produced.
   */
  private photoChange(path: string, body: (revision: number) => object) {
    const change = this.queue
      .catch(() => {})
      .then(async () => {
        if (this.conflict) throw new Error(CONFLICT);
        const id = this.id;
        if (!this.revision) {
          // A photo belongs to a card the server has.
          this.dirty = true;
          await this.write();
        }
        if (this.id !== id) return;
        const result = await this.api.request<RentalPhotos>(
          this.workspaceId(),
          "drafts/" + id + "/" + path,
          body(this.revision),
        ).catch((e: unknown) => this.conflicted(e, id));
        if (this.id !== id) return;
        this.revision = result.revision;
        this.photos = result.photos;
        this.drafts = this.drafts.map((d) =>
          d.id === id ? { ...d, revision: result.revision } : d,
        );
        // Whether a platform gets photos is part of the check.
        this.check.invalidate();
        if (this.check.checked && !this.destroyed) void this.check.refresh();
      });
    this.queue = change;
    return change;
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
    const result = await this.api.request<{
      id: string;
      revision: number;
      draft: RentalDraft;
      photos: RentalPhoto[];
    }>(this.workspaceId(), "drafts/" + id);
    if (beforeLoad !== this.editVersion)
      throw new Error(
        "Текущая карточка изменилась. Сначала сохраните её, затем откройте другую.",
      );
    this.id = result.id;
    this.revision = result.revision;
    this.draft = result.draft;
    this.photos = result.photos;
    this.onTransition();
    this.check.clear();
    this.dirty = false;
    this.conflict = false;
    this.status = status;
    if (applyProfileDefaults(this.draft, this.schema, this.profile()))
      this.changed();
    void this.fields.refresh();
    if (this.schema && this.draft.cardVersion !== this.schema.cardVersion)
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
    this.photos = [];
    this.check.clear();
    this.draft = {
      modelVersion: this.schema?.card.version,
      cardVersion: this.schema?.cardVersion || "",
      values: {},
        platforms: this.platforms,
      address: null,
    };
    applyProfileDefaults(this.draft, this.schema, this.profile());
    this.dirty = false;
    this.conflict = false;
    this.pendingDelete = null;
    void this.fields.refresh();
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
        await this.api.request(this.workspaceId(), "drafts/" + id + "/delete", {
          revision,
        });
        // Copies an older release kept in this browser go with the card.
        await forgetLocalRentalPhotos(this.workspaceId(), id).catch(() => {});
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
    this.fields.clear();
  }
}
