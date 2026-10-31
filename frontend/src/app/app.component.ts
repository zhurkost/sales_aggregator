import {
  Component,
  OnInit,
  OnDestroy,
  HostListener,
  ChangeDetectionStrategy,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { IconComponent } from "./icon.component";
import {
  emptyListing,
  fields,
  partFields,
  generalFields,
  listingTitle,
  parseLocally,
  sample,
  partsSample,
  sanitizeListing,
  validateListing,
  Listing,
  listingText,
} from "../../../lib/listing";
import {
  categories,
  categoryById,
  suggestCategories,
  categoryMapping,
  mappingOptions,
  mappingLabel,
  taxonomy,
  CategoryOverrides,
  Candidate,
} from "../../../lib/taxonomy";
import {
  api,
  setWorkspaceContext,
  download,
  extension,
  EXTENSION_VERSION,
  extensionVersionOK,
  withSellerContacts,
  newRecord,
  optimizePhoto,
  AdRecord,
  AdSummary,
  Profile,
} from "../../../lib/workspace";
import {
  getPlatforms,
  defaultPlatforms,
  platformValidation,
  statusLabel,
  remoteStatusLabel,
  safePublicationUrl,
  cleanRemoteStatus,
  Job,
} from "../../../lib/platforms";
import {
  categoryFields,
  cleanAttributes,
  descriptionWithAttributes,
  describeAttributes,
} from "../../../lib/attributes";
import {
  availablePlatforms,
  readiness,
  queueGroup,
} from "../../../lib/readiness";
import { emptyBatchEdit, editListing } from "../../../lib/batch-edit";
import {
  emptyTemplate,
  templateText,
  SellerTemplate,
} from "../../../lib/seller-template";
import {
  csvExport,
  flagmaXlsx,
  readImport,
  guessColumns,
  importFields,
  normalizeImport,
  ImportTable,
  ImportPreview,
  matchingPhotos,
} from "../../../lib/bulk";
import { readYml, ImportPreset } from "../../../lib/catalog-import";
import { legacyDrafts } from "../../../lib/legacy";
import { ProductIdentity } from "../../../lib/price-identification";

type Settings = {
  company?: string;
  contactPerson?: string;
  phone?: string;
  city?: string;
  templates?: SellerTemplate[];
  importPresets?: ImportPreset[];
  integrations?: Record<string, { enabled: boolean; notes: string }>;
};
type Member = { id: string; name: string; login: string; role: string };
type Team = {
  role: string;
  accountId: string;
  workspaceId: string;
  members: Member[];
  workspaces: { id: string; name: string }[];
};
type Notification = {
  id: number;
  recordId: string;
  platformId: string;
  message: string;
  created: string;
  seen: number;
};
type PriceResult = {
  name: string;
  id: string;
  url: string;
  status: string;
  error?: string;
  scanned?: number;
  matched?: number;
  groups?: {
    currency: string;
    count: number;
    min: number;
    max: number;
    median: number;
  }[];
  offers?: {
    url: string;
    title: string;
    price: number | null;
    currency: string;
  }[];
};
@Component({
  selector: "app-root",
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  templateUrl: "./app.component.html",
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AppComponent implements OnInit, OnDestroy {
  ready = false;
  unavailable = false;
  profile: Profile | null = null;
  profiles: Profile[] = [];
  authMode = "login";
  login = "";
  password = "";
  name = "";
  busy = "";
  toast = "";
  view = "editor";
  ad = newRecord({ ...emptyListing });
  ads: AdSummary[] = [];
  dirty = false;
  saveState = "Новая карточка";
  checked = false;
  publishMode: "manual" | "automatic" = "manual";
  ext = false;
  extensionStatus = "Проверяем подключение…";
  showExtension = false;
  serverAI = false;
  categoryId = "";
  categoryQuery = "";
  pendingOverrides: CategoryOverrides = {};
  candidates: Candidate[] = [];
  errors: string[] = [];
  photoSuggestion: {
    description: string;
    candidates: Candidate[];
    questions: string[];
  } | null = null;
  settings: Settings = {};
  team: Team = {
    role: "",
    accountId: "",
    workspaceId: "",
    members: [],
    workspaces: [],
  };
  memberLogin = "";
  notifications: Notification[] = [];
  queuePaused = false;
  pendingChecks = 0;
  queueFilter = "all";
  search = "";
  archiveFilter = "active";
  selectedIds = new Set<string>();
  batchEdit = { ...emptyBatchEdit };
  batchPreview: { record: AdSummary; listing: Listing }[] = [];
  versions: { version: number; created: string; data: unknown }[] = [];
  showHistory = false;
  template: SellerTemplate = { ...emptyTemplate, platformText: {} };
  templateId = "";
  table: ImportTable | null = null;
  columns: Record<string, string> = {};
  importCategory = "";
  importSource = "";
  importName = "";
  feedUrl = "";
  importPreview: ImportPreview[] = [];
  importProgress = "";
  preparedQueue: AdRecord[] = [];
  flagmaCategory = "";
  identity: ProductIdentity | null = null;
  priceResults: PriceResult[] = [];
  priceCheckedAt = "";
  taxonomySearch = "";
  readonly nav = [
    ["editor", "Новое объявление", "plus"],
    ["cabinet", "Мои объявления", "file"],
    ["queue", "Очередь и уведомления", "layers"],
    ["profile", "Мой профиль", "user"],
    ["team", "Команда", "user"],
    ["bulk", "Массовая загрузка", "upload"],
    ["edit-many", "Массовые изменения", "settings"],
    ["taxonomy", "Справочник площадок", "globe"],
    ["integrations", "Интеграции", "settings"],
  ];
  readonly categories = categories;
  readonly listingTitle = listingTitle;
  readonly categoryById = categoryById;
  readonly mappingLabel = mappingLabel;
  readonly statusLabel = statusLabel;
  readonly remoteStatusLabel = remoteStatusLabel;
  readonly getPlatforms = getPlatforms;
  readonly importFields = importFields;
  readonly version = EXTENSION_VERSION;
  readonly sample = sample;
  readonly partsSample = partsSample;
  readonly platformNames = [
    "kufar",
    "onliner",
    "bamper",
    "av",
    "abw",
    "flagma",
    "drom",
  ];
  private autosave?: ReturnType<typeof setTimeout>;
  private poll?: ReturnType<typeof setInterval>;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private saveQueue: Promise<unknown> = Promise.resolve();
  private progressQueue: Promise<unknown> = Promise.resolve();
  private revisions = new Map<string, number>();
  private received = new Map<string, string>();
  private alive = true;
  private epoch = 0;
  ngOnInit() {
    void this.session();
    window.addEventListener("message", this.onMessage);
    window.addEventListener("focus", this.onFocus);
  }
  ngOnDestroy() {
    this.alive = false;
    this.epoch++;
    clearTimeout(this.autosave);
    clearTimeout(this.toastTimer);
    clearInterval(this.poll);
    window.removeEventListener("message", this.onMessage);
    window.removeEventListener("focus", this.onFocus);
    setWorkspaceContext("");
  }
  notify(message: string) {
    this.toast = message;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = ""), 9000);
  }
  async guard(action: () => Promise<unknown>, label = "Подождите…") {
    if (this.busy) return;
    this.busy = label;
    try {
      await action();
    } catch (e) {
      this.notify(
        e instanceof Error ? e.message : "Не удалось выполнить действие.",
      );
    } finally {
      this.busy = "";
    }
  }
  async session() {
    try {
      const r = await api<{ profile: Profile | null; profiles: Profile[] }>(
        "workspace/session",
      );
      this.profiles = r.profiles;
      this.profile = r.profile;
      this.login = r.profiles[0]?.login || "";
      this.authMode = r.profiles.length ? "login" : "register";
      this.unavailable = false;
      if (r.profile) await this.enter(r.profile);
    } catch {
      this.unavailable = true;
    } finally {
      this.ready = true;
    }
  }
  async authenticate() {
    await this.guard(async () => {
      const r = await api<{ profile: Profile }>("workspace/" + this.authMode, {
        login: this.login,
        password: this.password,
        name: this.name,
      });
      this.password = "";
      await this.enter(r.profile);
    }, "Входим…");
  }
  private async enter(profile: Profile) {
    this.epoch++;
    this.profile = profile;
    setWorkspaceContext(profile.id);
    this.revisions.clear();
    this.received.clear();
    this.dirty = false;
    this.view = "editor";
    this.selectedIds.clear();
    const [settings] = await Promise.all([
      api<{ settings: Settings }>("workspace/settings"),
      this.refresh(),
      this.loadTeam(),
      this.loadNotifications(),
    ]);
    this.settings = settings.settings;
    this.ad = newRecord(withSellerContacts({ ...emptyListing }, this.settings));
    this.categoryId = "";
    this.pendingOverrides = {};
    this.saveState = "Новая карточка";
    this.serverAI = (
      await api<{ serverConfigured: boolean }>("ai-settings").catch(() => ({
        serverConfigured: false,
      }))
    ).serverConfigured;
    void this.checkExtension();
    clearInterval(this.poll);
    this.poll = setInterval(() => void this.pollExtension(), 6000);
  }
  async logout() {
    await this.guard(async () => {
      if (this.ext) await extension("PAUSE", { profileId: this.profile!.id });
      if (this.dirty) await this.persist();
      await api("workspace/logout", {});
      clearInterval(this.poll);
      clearTimeout(this.autosave);
      setWorkspaceContext("");
      this.profile = null;
      this.epoch++;
      await this.session();
    }, "Выходим…");
  }
  async refresh() {
    const r = await api<{ ads: AdSummary[] }>("workspace/ads");
    this.ads = r.ads;
  }
  change(next: AdRecord) {
    this.ad = next;
    this.dirty = true;
    this.checked = false;
    this.identity = null;
    this.priceResults = [];
    this.saveState = "Есть несохранённые изменения";
    clearTimeout(this.autosave);
    this.autosave = setTimeout(
      () =>
        void this.persist().catch((e) => {
          this.saveState = "Не удалось сохранить";
          this.notify(e.message);
        }),
      700,
    );
  }
  field(key: keyof Listing, value: string) {
    const listing = { ...this.ad.listing, [key]: value };
    this.change({
      ...this.ad,
      listing,
      attributes: cleanAttributes(
        listing,
        this.ad.attributes,
        this.ad.categoryOverrides,
      ),
    });
  }
  persist(snapshot = this.ad): Promise<AdRecord> {
    const epoch = this.epoch;
    const operation = this.saveQueue.then(async () => {
      if (!this.profile || epoch !== this.epoch)
        throw new Error("Профиль закрыт.");
      this.saveState = "Сохраняем…";
      const r = await api<{ ad: AdRecord }>("workspace/ads", {
        ...snapshot,
        profileId: this.profile.id,
        revision: this.revisions.get(snapshot.id) ?? snapshot.revision,
      });
      if (epoch !== this.epoch) throw new Error("Профиль изменился.");
      this.revisions.set(snapshot.id, r.ad.revision);
      if (this.ad.id === snapshot.id) {
        const unchanged = this.ad === snapshot;
        this.ad = unchanged
          ? r.ad
          : {
              ...this.ad,
              revision: r.ad.revision,
              contentVersion: r.ad.contentVersion,
              updatedAt: r.ad.updatedAt,
              events: r.ad.events,
            };
        if (unchanged) this.dirty = false;
        this.saveState = unchanged
          ? "Сохранено в профиле"
          : "Есть несохранённые изменения";
      }
      this.ads = [
        { ...r.ad, photoCount: r.ad.photos.length },
        ...this.ads.filter((a) => a.id !== r.ad.id),
      ];
      return r.ad;
    });
    this.saveQueue = operation.catch(() => undefined);
    return operation;
  }
  @HostListener("window:beforeunload", ["$event"]) beforeUnload(
    event: BeforeUnloadEvent,
  ) {
    if (this.dirty || this.saveState === "Сохраняем…") {
      event.preventDefault();
      event.returnValue = "";
    }
  }
  @HostListener("document:paste", ["$event"]) paste(event: ClipboardEvent) {
    if (this.view !== "editor" || this.showExtension || !this.profile) return;
    const files = Array.from(event.clipboardData?.files || []).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length) {
      event.preventDefault();
      void this.upload(files);
    }
  }
  async navigate(view: string) {
    await this.guard(async () => {
      if (this.dirty) await this.persist();
      this.view = view;
      if (["cabinet", "queue", "edit-many"].includes(view))
        await this.refresh();
      if (view === "team") await this.loadTeam();
      if (view === "queue") await this.loadNotifications();
    }, "Открываем…");
  }
  async fresh() {
    await this.guard(async () => {
      if (this.dirty) await this.persist();
      this.resetEditor(
        newRecord(withSellerContacts({ ...emptyListing }, this.settings)),
      );
    }, "Открываем…");
  }
  private resetEditor(ad: AdRecord) {
    clearTimeout(this.autosave);
    this.ad = ad;
    this.revisions.set(ad.id, ad.revision);
    this.dirty = false;
    this.categoryId = ad.listing.taxonomyId;
    this.pendingOverrides = ad.categoryOverrides || {};
    this.candidates = [];
    this.photoSuggestion = null;
    this.identity = null;
    this.priceResults = [];
    this.checked = false;
    this.errors = [];
    this.view = "editor";
    this.showHistory = false;
    this.saveState = ad.revision ? "Сохранено в профиле" : "Новая карточка";
  }
  async openRecord(id: string) {
    await this.guard(async () => {
      if (this.dirty) await this.persist();
      this.resetEditor((await api<{ ad: AdRecord }>("workspace/ads/" + id)).ad);
    }, "Открываем…");
  }
  get definitions() {
    return this.ad.listing.category === "parts"
      ? partFields
      : this.ad.listing.category === "general"
        ? generalFields
        : fields;
  }
  get platforms() {
    return getPlatforms(this.ad.listing.category, this.ad.listing.taxonomyId);
  }
  get attributes() {
    return categoryFields(
      this.ad.listing,
      this.ad.attributes,
      this.ad.categoryOverrides,
    );
  }
  get readiness() {
    return readiness(this.ad, this.ext);
  }
  get categoryOptions() {
    const q = this.categoryQuery.toLowerCase();
    return categories.filter(
      (c) => !q || (c.parent + " " + c.name).toLowerCase().includes(q),
    );
  }
  get filteredAds() {
    return this.ads.filter(
      (a) =>
        (this.archiveFilter === "all" ||
          (this.archiveFilter === "archived") === !!a.archived) &&
        (!this.search ||
          (
            listingTitle(a.listing) +
            " " +
            a.listing.description +
            " " +
            a.externalId
          )
            .toLowerCase()
            .includes(this.search.toLowerCase())),
    );
  }
  get queue() {
    return this.ads
      .flatMap((record) =>
        record.jobs.map((job) => ({ record, job, group: queueGroup(job) })),
      )
      .filter(
        (r) => this.queueFilter === "all" || r.group === this.queueFilter,
      );
  }
  get catalogResults() {
    return categories.filter((c) =>
      (c.name + " " + c.parent)
        .toLowerCase()
        .includes(this.taxonomySearch.toLowerCase()),
    );
  }
  mappings(platform: string) {
    return mappingOptions(platform);
  }
  mapping(category: string, platform: string) {
    return categoryMapping(category, platform, this.pendingOverrides);
  }
  selectCategory(id: string) {
    this.categoryId = id;
    this.pendingOverrides =
      id === this.ad.listing.taxonomyId ? this.ad.categoryOverrides || {} : {};
    if (this.ad.prepared && id !== this.ad.listing.taxonomyId)
      this.change({ ...this.ad, categoryConfirmed: false });
  }
  async classify() {
    await this.guard(async () => {
      if (this.ad.text.trim().length < 3)
        throw new Error("Опишите товар хотя бы в 3 символах.");
      const r = this.serverAI
        ? await api<{ candidates: Candidate[]; question?: string }>("analyze", {
            task: "classify",
            text: this.ad.text,
          })
        : {
            candidates: suggestCategories(this.ad.text),
            question: "Выберите категорию из справочника.",
          };
      this.candidates = r.candidates;
      this.selectCategory(r.candidates[0]?.id || "");
      if (r.question) this.notify(r.question);
    }, "Определяем категорию…");
  }
  async prepare() {
    await this.guard(async () => {
      const cat = categoryById(this.categoryId);
      if (!cat) throw new Error("Выберите категорию.");
      const source = this.ad;
      let listing = this.serverAI
        ? sanitizeListing(
            (
              await api<{ listing: Listing }>("analyze", {
                text: source.text,
                category: cat.group,
                taxonomyId: cat.id,
              })
            ).listing,
            cat.group,
          )
        : parseLocally(source.text, cat.group);
      listing.taxonomyId = cat.id;
      const explicit = parseLocally(source.text, cat.group);
      listing = withSellerContacts(listing, {
        phone: explicit.phone || source.listing.phone || this.settings.phone,
        city: explicit.city || source.listing.city || this.settings.city,
      });
      this.change({
        ...source,
        listing,
        attributes: cleanAttributes(
          listing,
          source.attributes,
          this.pendingOverrides,
        ),
        categoryConfirmed: true,
        categoryOverrides: { ...this.pendingOverrides },
        prepared: true,
        selected: defaultPlatforms(cat.group, cat.id, this.pendingOverrides),
      });
      await this.persist();
      this.notify(
        "Карточка подготовлена. Проверьте характеристики и контакты.",
      );
    }, "Готовим карточку…");
  }
  manualCategory() {
    const cat = categoryById(this.categoryId);
    if (!cat) {
      this.notify("Выберите категорию.");
      return;
    }
    const listing = sanitizeListing({
      ...this.ad.listing,
      category: cat.group,
      taxonomyId: cat.id,
    });
    this.change({
      ...this.ad,
      listing,
      prepared: true,
      categoryConfirmed: true,
      categoryOverrides: { ...this.pendingOverrides },
      selected: defaultPlatforms(cat.group, cat.id, this.pendingOverrides),
      attributes: cleanAttributes(
        listing,
        this.ad.attributes,
        this.pendingOverrides,
      ),
    });
  }
  textChange(text: string) {
    this.change({ ...this.ad, text });
  }
  attribute(key: string, value: string) {
    this.change({
      ...this.ad,
      attributes: cleanAttributes(
        this.ad.listing,
        { ...this.ad.attributes, [key]: value },
        this.ad.categoryOverrides,
      ),
    });
  }
  togglePlatform(id: string) {
    this.change({
      ...this.ad,
      selected: this.ad.selected.includes(id)
        ? this.ad.selected.filter((p) => p !== id)
        : [...this.ad.selected, id],
    });
  }
  fileList(event: Event) {
    return (event.target as HTMLInputElement).files;
  }
  async upload(files: FileList | File[] | null) {
    if (!files?.length) return;
    await this.guard(async () => {
      const room = 12 - this.ad.photos.length;
      if (room <= 0) throw new Error("Можно добавить до 12 фотографий.");
      const photos = [];
      for (const file of Array.from(files).slice(0, room))
        photos.push(await optimizePhoto(file));
      this.change({ ...this.ad, photos: [...this.ad.photos, ...photos] });
    }, "Обрабатываем фото…");
  }
  removePhoto(id: string) {
    this.change({
      ...this.ad,
      photos: this.ad.photos.filter((p) => p.id !== id),
    });
  }
  movePhoto(index: number, delta: number) {
    const photos = [...this.ad.photos],
      target = index + delta;
    if (target < 0 || target >= photos.length) return;
    [photos[index], photos[target]] = [photos[target], photos[index]];
    this.change({ ...this.ad, photos });
  }
  async analyzePhotos() {
    await this.guard(async () => {
      if (!this.ad.photos.length) throw new Error("Добавьте фото.");
      this.photoSuggestion = await api("analyze", {
        task: "photos",
        text: this.ad.text || "Опишите товар по фото.",
        photos: this.ad.photos.slice(0, 3).map((p) => p.dataUrl),
        category: this.ad.listing.category,
      });
    }, "Анализируем фото…");
  }
  applyPhotoSuggestion() {
    if (!this.photoSuggestion) return;
    this.change({
      ...this.ad,
      text: [this.ad.text, this.photoSuggestion.description]
        .filter(Boolean)
        .join("\n\n"),
    });
    this.candidates = this.photoSuggestion.candidates;
    if (this.candidates[0]) this.selectCategory(this.candidates[0].id);
    this.photoSuggestion = null;
  }
  async checkExtension() {
    try {
      const r = await extension("PING");
      this.ext = extensionVersionOK(r.version);
      this.extensionStatus = this.ext
        ? `Расширение ${r.version} подключено.`
        : `Обновите расширение до ${EXTENSION_VERSION}.`;
    } catch (e) {
      this.ext = false;
      this.extensionStatus =
        e instanceof Error ? e.message : "Нет связи с расширением.";
    }
  }
  private onFocus = () => {
    if (this.profile) void this.checkExtension();
  };
  private onMessage = (event: MessageEvent) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.source !== "autopost-extension" ||
      !this.profile
    )
      return;
    if (event.data.type === "READY") {
      void this.checkExtension();
      return;
    }
    if (["PROGRESS", "REMOTE_STATUS"].includes(event.data.type))
      this.progressQueue = this.progressQueue
        .then(() =>
          this.receive(event.data.payload, event.data.type === "REMOTE_STATUS"),
        )
        .catch((e) => this.notify(e.message));
  };
  private async pollExtension() {
    if (!this.ext || !this.profile) return;
    const epoch = this.epoch;
    try {
      const r = await extension("STATUS", { profileId: this.profile.id }, 5000);
      if (epoch !== this.epoch) return;
      this.pendingChecks = Number(r.pendingChecks) || 0;
      const batches = Array.isArray(r.batches) ? r.batches : [];
      this.queuePaused = batches.length > 0 && batches.every((b) => b.paused);
      for (const receipt of Array.isArray(r.receipts) ? r.receipts : [])
        this.progressQueue = this.progressQueue
          .then(() => this.receive(receipt, receipt.kind === "status"))
          .catch(() => undefined);
      for (const batch of batches)
        this.progressQueue = this.progressQueue
          .then(() => this.receive(batch))
          .catch(() => undefined);
    } catch {
      /* Extension can be asleep or restarting. */
    }
  }
  private async receive(batch: Record<string, any>, remote = false) {
    if (
      !this.profile ||
      (batch["profileId"] && batch["profileId"] !== this.profile.id) ||
      !batch["recordId"]
    )
      return;
    let record =
      this.ad.id === batch["recordId"]
        ? this.ad
        : (await api<{ ad: AdRecord }>("workspace/ads/" + batch["recordId"]))
            .ad;
    const ack = async () => {
      if (batch["receiptId"])
        await extension("ACK_RECEIPT", {
          profileId: this.profile!.id,
          receiptId: batch["receiptId"],
        });
    };
    if (remote) {
      const status = cleanRemoteStatus(batch["remoteStatus"]);
      if (!status) return;
      const job = record.jobs.find(
        (j) => j.platformId === batch["platformId"] && j.url === batch["url"],
      );
      if (!job) {
        await ack();
        return;
      }
      if (
        !job.remoteStatus ||
        Date.parse(job.remoteStatus.checkedAt) < Date.parse(status.checkedAt)
      )
        record = {
          ...record,
          jobs: record.jobs.map((j) =>
            j === job ? { ...j, remoteStatus: status } : j,
          ),
        };
    } else {
      if (
        !Array.isArray(batch["jobs"]) ||
        (record.batchId !== batch["batchId"] &&
          !record.jobs.some((j) => j.batchId === batch["batchId"]))
      )
        return;
      const signature = JSON.stringify(batch["jobs"]);
      if (this.received.get(batch["batchId"]) === signature) {
        await ack();
        return;
      }
      record = {
        ...record,
        jobs: record.jobs.map((job) => {
          const next =
            (job.batchId || record.batchId) === batch["batchId"] &&
            batch["jobs"].find((j: Job) => j.platformId === job.platformId);
          return next ? { ...job, ...next, batchId: batch["batchId"] } : job;
        }),
      };
      await this.persist(record);
      this.received.set(batch["batchId"], signature);
      if (this.ad.id === record.id)
        this.ad = { ...record, revision: this.revisions.get(record.id)! };
      await ack();
      return;
    }
    await this.persist(record);
    if (this.ad.id === record.id)
      this.ad = { ...record, revision: this.revisions.get(record.id)! };
    await ack();
  }
  private launchPayload(record: AdRecord) {
    const listing = sanitizeListing(record.listing);
    return {
      publishMode: this.publishMode,
      batchId: record.batchId,
      recordId: record.id,
      profileId: this.profile!.id,
      categoryOverrides: record.categoryOverrides || {},
      attributes: record.attributes || {},
      platformText: record.platformText || {},
      photoIds: record.photos.map((p) => p.id),
      listing: {
        ...listing,
        title: listingTitle(listing),
        description: descriptionWithAttributes(
          listing,
          record.attributes,
          record.categoryOverrides,
        ),
      },
      photos: record.photos.map(({ name, type, dataUrl }) => ({
        name,
        type,
        dataUrl,
      })),
      platforms: record.selected.map((id) => ({ id })),
    };
  }
  async start() {
    const r = this.ad,
      targets = availablePlatforms(r);
    this.errors = [
      ...validateListing(r.listing),
      ...platformValidation(r.listing, r.selected, r.categoryOverrides),
      ...(!r.categoryConfirmed ? ["Подтвердите категорию"] : []),
      ...(!r.prepared ? ["Подготовьте карточку"] : []),
      ...(!r.photos.length ? ["Добавьте фотографии"] : []),
      ...(!targets.length
        ? ["Выберите площадки без существующих заданий"]
        : []),
      ...(!this.checked ? ["Подтвердите проверку данных"] : []),
      ...(r.sold ||
      r.archived ||
      r.listing.quantity === "0" ||
      r.listing.availability === "Нет в наличии"
        ? ["Товар продан, в архиве или отсутствует в наличии"]
        : []),
    ];
    if (this.errors.length) return;
    if (!this.ext) {
      this.showExtension = true;
      return;
    }
    await this.guard(async () => {
      const batchId = crypto.randomUUID();
      const launched = {
        ...r,
        batchId,
        jobs: [
          ...r.jobs
            .filter((j) => !targets.includes(j.platformId))
            .map((j) => ({ ...j, batchId: j.batchId || r.batchId })),
          ...targets.map((platformId) => ({
            batchId,
            platformId,
            status: "opening",
            message: "Открываем выбранную площадку.",
          })),
        ],
      };
      this.ad = launched;
      await this.persist(launched);
      try {
        const result = await extension(
          "RUN",
          this.launchPayload({ ...this.ad, selected: targets }),
          25000,
        );
        if (Array.isArray(result.jobs))
          await this.receive({ batchId, recordId: r.id, jobs: result.jobs });
      } catch (e) {
        this.change({
          ...this.ad,
          jobs: this.ad.jobs.map((j) =>
            targets.includes(j.platformId)
              ? {
                  ...j,
                  status: "error",
                  message:
                    e instanceof Error
                      ? e.message
                      : "Не удалось открыть площадку.",
                }
              : j,
          ),
        });
        throw e;
      }
    }, "Открываем площадки…");
  }
  async openJob(job: Job, record: AdSummary | AdRecord = this.ad) {
    if (!this.ext) {
      this.showExtension = true;
      return;
    }
    await this.guard(async () => {
      const batchId = job.batchId || record.batchId || crypto.randomUUID();
      const response = await extension("OPEN_JOB", {
        profileId: this.profile!.id,
        batchId,
        recordId: record.id,
        platformId: job.platformId,
      });
      if (typeof response.resumeToken === "string") {
        let full =
          this.ad.id === record.id
            ? this.ad
            : (await api<{ ad: AdRecord }>("workspace/ads/" + record.id)).ad;
        if (!job.batchId && full.batchId !== batchId)
          full = await this.persist({
            ...full,
            batchId,
            jobs: full.jobs.map((j) =>
              j.platformId === job.platformId ? { ...j, batchId } : j,
            ),
          });
        const result = await extension(
          "RESTORE_JOB",
          {
            profileId: this.profile!.id,
            resumeToken: response.resumeToken,
            item: {
              ...this.launchPayload({ ...full, batchId }),
              publishMode: "manual",
              platforms: [{ id: job.platformId }],
            },
          },
          25000,
        );
        if (Array.isArray(result.jobs))
          await this.receive({
            batchId,
            recordId: record.id,
            jobs: result.jobs,
          });
      } else if (Array.isArray(response.jobs))
        await this.receive({
          batchId,
          recordId: record.id,
          jobs: response.jobs,
        });
    }, "Открываем…");
  }
  async queueAction(type: string) {
    await this.guard(async () => {
      await extension(type, {
        profileId: this.profile!.id,
        ...(type === "SET_MODE" ? { publishMode: this.publishMode } : {}),
      });
      this.queuePaused = type === "PAUSE";
    }, "Обновляем очередь…");
  }
  async checkStatuses(records: AdSummary[] = [this.adSummary]) {
    if (!this.ext) {
      this.showExtension = true;
      return;
    }
    await this.guard(async () => {
      const items = records.flatMap((r) =>
        r.jobs
          .filter((j) => j.url)
          .map((j) => ({
            recordId: r.id,
            platformId: j.platformId,
            url: j.url,
            title: listingTitle(r.listing),
          })),
      );
      if (!items.length)
        throw new Error("Сначала сохраните ссылку на объявление.");
      const r = await extension(
        "CHECK_STATUS",
        { profileId: this.profile!.id, items },
        25000,
      );
      this.pendingChecks = Number(r.pendingChecks) || 0;
    }, "Проверяем ссылки…");
  }
  get adSummary(): AdSummary {
    return { ...this.ad, photoCount: this.ad.photos.length };
  }
  setJobLink(job: Job, url: string) {
    const safe = safePublicationUrl(job.platformId, url);
    if (url && !safe) {
      this.notify("Укажите HTTPS-ссылку на этой площадке.");
      return;
    }
    this.change({
      ...this.ad,
      jobs: this.ad.jobs.map((j) =>
        j === job
          ? {
              ...j,
              url: safe,
              status: safe ? "link_recorded" : j.status,
              remoteStatus: undefined,
            }
          : j,
      ),
    });
  }
  setJobStatus(job: Job, status: string) {
    this.change({
      ...this.ad,
      jobs: this.ad.jobs.map((j) => (j === job ? { ...j, status } : j)),
    });
  }
  async archive(record: AdSummary, sold = false) {
    await this.guard(async () => {
      if (sold && this.ext)
        await extension("CANCEL_RECORD", {
          profileId: this.profile!.id,
          recordId: record.id,
        });
      let full =
        this.ad.id === record.id
          ? this.ad
          : (await api<{ ad: AdRecord }>("workspace/ads/" + record.id)).ad;
      full = sold
        ? { ...full, sold: !full.sold }
        : { ...full, archived: !full.archived };
      await this.persist(full);
      if (this.ad.id === full.id)
        this.ad = { ...full, revision: this.revisions.get(full.id)! };
    }, "Сохраняем…");
  }
  toggleRecord(id: string) {
    const next = new Set(this.selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    this.selectedIds = next;
    this.batchPreview = [];
  }
  async previewBatch() {
    await this.guard(async () => {
      const selected = this.ads.filter((a) => this.selectedIds.has(a.id));
      if (!selected.length || selected.length > 100)
        throw new Error("Выберите от 1 до 100 карточек.");
      this.batchPreview = selected.map((record) => ({
        record,
        listing: editListing(record.listing, this.batchEdit),
      }));
    }, "Предпросмотр…");
  }
  async applyBatch() {
    await this.guard(async () => {
      if (!this.batchPreview.length)
        throw new Error("Сначала обновите предпросмотр.");
      await api("workspace/batch-edit", {
        items: this.batchPreview.map((p) => ({
          id: p.record.id,
          revision: p.record.revision,
        })),
        edit: this.batchEdit,
      });
      this.batchPreview = [];
      await this.refresh();
      this.notify("Изменения сохранены в кабинете.");
    }, "Сохраняем…");
  }
  async history() {
    await this.guard(async () => {
      if (this.dirty) await this.persist();
      this.versions = (
        await api<{
          versions: { version: number; created: string; data: unknown }[];
        }>("workspace/ads/" + this.ad.id + "/versions")
      ).versions;
      this.showHistory = true;
    }, "Загружаем историю…");
  }
  async restore(version: number) {
    await this.guard(async () => {
      const r = await api<{ ad: AdRecord }>(
        "workspace/ads/" + this.ad.id + "/versions",
        { version, revision: this.ad.revision },
      );
      this.resetEditor(r.ad);
      await this.refresh();
    }, "Восстанавливаем…");
  }
  async loadTeam() {
    this.team = await api<Team>("workspace/team");
  }
  async teamAction(action: string, memberId = "") {
    await this.guard(async () => {
      this.team = await api<Team>("workspace/team", {
        action,
        memberId,
        login: this.memberLogin,
      });
      this.memberLogin = "";
    }, "Обновляем команду…");
  }
  async switchWorkspace(workspaceId: string) {
    await this.guard(async () => {
      if (this.dirty) await this.persist();
      if (this.ext) await extension("PAUSE", { profileId: this.profile!.id });
      await api("workspace/team", { action: "switch", workspaceId });
      setWorkspaceContext("");
      await this.session();
    }, "Меняем кабинет…");
  }
  async loadNotifications() {
    this.notifications = (
      await api<{ notifications: Notification[] }>("workspace/notifications")
    ).notifications;
  }
  async markSeen() {
    await this.guard(async () => {
      this.notifications = (
        await api<{ notifications: Notification[] }>(
          "workspace/notifications",
          { ids: this.notifications.filter((n) => !n.seen).map((n) => n.id) },
        )
      ).notifications;
    });
  }
  async saveSettings() {
    await this.guard(async () => {
      this.settings = (
        await api<{ settings: Settings }>("workspace/settings", this.settings)
      ).settings;
      this.notify("Настройки сохранены.");
    }, "Сохраняем настройки…");
  }
  integration(id: string) {
    this.settings.integrations ??= {};
    return (this.settings.integrations[id] ??= { enabled: false, notes: "" });
  }
  async saveTemplate() {
    if (!this.template.name.trim()) {
      this.notify("Укажите название шаблона.");
      return;
    }
    this.settings.templates = [
      ...(this.settings.templates || []).filter(
        (t) => t.id !== this.template.id,
      ),
      { ...this.template, id: this.template.id || crypto.randomUUID() },
    ];
    await this.saveSettings();
    this.template = { ...emptyTemplate, platformText: {} };
  }
  editTemplate(template: SellerTemplate) {
    this.template = structuredClone(template);
  }
  async removeTemplate(id: string) {
    this.settings.templates = (this.settings.templates || []).filter(
      (t) => t.id !== id,
    );
    await this.saveSettings();
  }
  applyTemplate() {
    const template = this.settings.templates?.find(
      (t) => t.id === this.templateId,
    );
    if (!template) return;
    this.change({
      ...this.ad,
      listing: {
        ...this.ad.listing,
        description: [this.ad.listing.description, templateText(template)]
          .filter(Boolean)
          .join("\n\n"),
      },
      platformText: { ...this.ad.platformText, ...template.platformText },
    });
  }
  async readFile(event: Event) {
    const file = this.fileList(event)?.[0];
    if (!file) return;
    await this.guard(async () => {
      this.table = await readImport(file);
      this.columns = guessColumns(this.table.headers);
      this.importPreview = [];
      this.importName ||= file.name;
      this.importSource ||= crypto.randomUUID();
    }, "Читаем файл…");
  }
  async loadFeed() {
    await this.guard(async () => {
      this.table = readYml(
        (await api<{ text: string }>("workspace/feed", { url: this.feedUrl }))
          .text,
      );
      this.columns = guessColumns(this.table.headers);
      this.importSource ||= crypto.randomUUID();
      this.importName ||= "YML-каталог";
      this.importPreview = [];
    }, "Загружаем каталог…");
  }
  previewImport() {
    if (!this.table) return;
    try {
      this.importPreview = normalizeImport(
        this.table,
        this.columns,
        this.importCategory,
        this.settings,
      );
      this.importProgress = "";
    } catch (e) {
      this.notify((e as Error).message);
    }
  }
  async attachImportPhotos(event: Event) {
    const files = Array.from(this.fileList(event) || []);
    if (!files.length) return;
    await this.guard(async () => {
      for (const item of this.importPreview) {
        const matched = matchingPhotos(item.record, files);
        const photos = [];
        for (const file of matched.slice(0, 12))
          photos.push(await optimizePhoto(file));
        if (photos.length) item.record.photos = photos;
      }
    }, "Добавляем фото…");
  }
  async importRecords() {
    await this.guard(async () => {
      if (!this.importSource) throw new Error("Укажите источник импорта.");
      let count = 0;
      for (const item of this.importPreview) {
        if (item.duplicate) continue;
        const previous = this.ads.find(
          (a) =>
            a.sourceId === this.importSource &&
            !!item.record.externalId &&
            a.externalId === item.record.externalId,
        );
        await api("workspace/import", {
          sourceId: this.importSource,
          record: item.record,
          fields: Object.values(this.columns).filter(Boolean),
          expectedRevision: previous?.revision,
        });
        count++;
        this.importProgress = `Сохранено: ${count}`;
      }
      await this.refresh();
      this.notify(
        `Импортировано: ${count}. Проверьте карточки перед размещением.`,
      );
    }, "Импортируем…");
  }
  async savePreset() {
    if (!this.importName.trim()) {
      this.notify("Укажите название источника.");
      return;
    }
    this.importSource ||= crypto.randomUUID();
    const preset = {
      id: this.importSource,
      name: this.importName,
      columns: { ...this.columns },
      categoryId: this.importCategory,
      url: this.feedUrl,
    };
    this.settings.importPresets = [
      ...(this.settings.importPresets || []).filter((p) => p.id !== preset.id),
      preset,
    ];
    await this.saveSettings();
  }
  loadPreset(id: string) {
    const p = this.settings.importPresets?.find((p) => p.id === id);
    if (p) {
      this.importSource = p.id;
      this.importName = p.name;
      this.columns = { ...p.columns };
      this.importCategory = p.categoryId;
      this.feedUrl = p.url;
      this.importPreview = [];
    }
  }
  async exportRecords(kind: string) {
    await this.guard(async () => {
      const selected = this.ads.filter(
        (a) => !this.selectedIds.size || this.selectedIds.has(a.id),
      );
      const records: AdRecord[] = [];
      for (const ad of selected)
        records.push(
          (await api<{ ad: AdRecord }>("workspace/ads/" + ad.id)).ad,
        );
      if (kind === "csv")
        download("autopost.csv", csvExport(records), "text/csv;charset=utf-8");
      else if (kind === "xlsx")
        download(
          "flagma.xlsx",
          await flagmaXlsx(
            records,
            Object.fromEntries(records.map((r) => [r.id, this.flagmaCategory])),
          ),
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
      else
        download(
          "autopost.json",
          JSON.stringify(records, null, 2),
          "application/json",
        );
    }, "Готовим выгрузку…");
  }
  async legacy() {
    await this.guard(async () => {
      const drafts = await legacyDrafts();
      for (const draft of drafts) await this.persist(draft);
      await this.refresh();
      this.notify(`Перенесено черновиков: ${drafts.length}`);
    }, "Переносим черновики…");
  }
  async identify() {
    await this.guard(async () => {
      const source =
        JSON.stringify(
          Object.fromEntries(
            [
              "title",
              "description",
              "brand",
              "model",
              "year",
              "partName",
              "partNumber",
              "manufacturer",
              "condition",
              "compatibility",
              "fitYears",
              "priceUnit",
            ].map((k) => [k, this.ad.listing[k as keyof Listing]]),
          ),
        ) +
        describeAttributes(
          this.ad.listing,
          this.ad.attributes,
          this.ad.categoryOverrides,
        );
      this.identity = (
        await api<{ identity: ProductIdentity }>("analyze", {
          task: "identify",
          text: source
            .replace(/\+?375[\s()\d-]{9,18}/g, "[телефон удалён]")
            .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email удалён]")
            .slice(0, 8000),
          category: this.ad.listing.category,
          taxonomyId: this.ad.listing.taxonomyId,
        })
      ).identity;
      this.priceResults = [];
    }, "Определяем товар…");
  }
  async searchPrices() {
    if (!this.ext) {
      this.showExtension = true;
      return;
    }
    await this.guard(async () => {
      if (this.identity?.status !== "identified")
        throw new Error("Сначала определите товар.");
      const result = await extension(
        "PRICE_SEARCH",
        { ...this.identity, taxonomyId: this.ad.listing.taxonomyId },
        25000,
      );
      this.priceResults = (result.results || []) as PriceResult[];
      this.priceCheckedAt = String(result.checkedAt || "");
    }, "Ищем цены…");
  }
  safeSearchLink(value: string) {
    try {
      const u = new URL(value);
      return u.protocol === "https:" &&
        !u.username &&
        !u.password &&
        !u.port &&
        ["www.kufar.by", "baraholka.onliner.by"].includes(u.hostname)
        ? u.href
        : null;
    } catch {
      return null;
    }
  }
  async copyText() {
    await this.guard(() =>
      navigator.clipboard.writeText(listingText(this.ad.listing)),
    );
  }
  platformName(id: string) {
    return (
      [
        ...getPlatforms("cars"),
        ...getPlatforms("parts"),
        ...getPlatforms("general"),
      ].find((p) => p.id === id)?.name || id
    );
  }
  platformTextChange(id: string, value: string) {
    this.change({
      ...this.ad,
      platformText: { ...this.ad.platformText, [id]: value },
    });
  }
  assignee(id: string) {
    this.change({ ...this.ad, assigneeId: id });
  }
  async saveCurrent() {
    await this.guard(() => this.persist(), "Сохраняем…");
  }
  @HostListener("document:keydown.escape") closeDialog() {
    this.showExtension = false;
    this.showHistory = false;
  }
  async prepareQueue() {
    await this.guard(async () => {
      if (!this.ext) throw new Error("Подключите расширение.");
      const selected = this.ads.filter((a) => this.selectedIds.has(a.id));
      if (!selected.length || selected.length > 20)
        throw new Error("Выберите от 1 до 20 карточек.");
      const records: AdRecord[] = [];
      for (const row of selected) {
        const full = (await api<{ ad: AdRecord }>("workspace/ads/" + row.id))
          .ad;
        const targets = availablePlatforms(full);
        const issues = [
          ...validateListing(full.listing),
          ...platformValidation(full.listing, targets, full.categoryOverrides),
          ...(!full.categoryConfirmed ? ["Подтвердите категорию"] : []),
          ...(!full.photos.length ? ["Добавьте фото"] : []),
          ...(!targets.length ? ["Нет новых площадок"] : []),
          ...(full.sold ||
          full.archived ||
          full.listing.quantity === "0" ||
          full.listing.availability === "Нет в наличии"
            ? ["Товар недоступен"]
            : []),
        ];
        if (issues.length)
          throw new Error(
            listingTitle(full.listing) + ": " + issues.join(", "),
          );
        records.push({ ...full, selected: targets });
      }
      this.preparedQueue = [];
      for (const r of records) {
        const batchId = crypto.randomUUID();
        const jobs = [
          ...r.jobs
            .filter((j) => !r.selected.includes(j.platformId))
            .map((j) => ({ ...j, batchId: j.batchId || r.batchId })),
          ...r.selected.map((platformId) => ({
            platformId,
            batchId,
            status: "ready",
            message: "Проверено. Ожидает запуска очереди пользователем.",
          })),
        ];
        this.preparedQueue.push(await this.persist({ ...r, batchId, jobs }));
      }
      this.notify("Проверьте режим и запустите подготовленную очередь.");
    }, "Проверяем карточки…");
  }
  async startQueue() {
    await this.guard(async () => {
      if (!this.preparedQueue.length) return;
      const response = await extension(
        "RUN_QUEUE",
        {
          profileId: this.profile!.id,
          items: this.preparedQueue.map((r) => this.launchPayload(r)),
        },
        30000,
      );
      this.preparedQueue = [];
      if (Array.isArray(response.batches))
        for (const batch of response.batches) await this.receive(batch);
      this.notify("Очередь запущена. Оставьте вкладку Автопоста открытой.");
    }, "Запускаем очередь…");
  }
}
