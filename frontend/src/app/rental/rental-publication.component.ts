import { APARTMENT_RENT } from "../listing-categories";
import { Component, HostListener, Input, OnChanges, OnDestroy } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { EXTENSION_VERSION, type Photo } from "../../../../lib/workspace";
import { RentalFormStore } from "./rental-form.store";
import { RentalPublicationGateway } from "./rental-publication.gateway";

type Job = {
  id: string;
  platform: string;
  status: string;
  message: string;
  filled: number;
  remaining: string[];
  mode: string;
};
@Component({
  selector: "app-rental-publication",
  standalone: true,
  imports: [FormsModule],
  templateUrl: "./rental-publication.component.html",
  styleUrl: "./rental-publication.component.css",
})
export class RentalPublicationComponent implements OnChanges, OnDestroy {
  constructor(private gateway: RentalPublicationGateway) {}
  @Input({ required: true }) store!: RentalFormStore;
  @Input({ required: true }) workspaceId = "";
  @Input({ required: true }) sessionId = "";
  @Input() publicationEnabled = true;
  mode: "automatic" | "assist" = "automatic";
  readonly extensionVersion = EXTENSION_VERSION;
  busy = false;
  photosBusy = false;
  error = "";
  ready = false;
  connectionMessage = "";
  photos: Photo[] = [];
  jobs: Job[] = [];
  private generation = 0;
  private probe = 0;
  private timer?: ReturnType<typeof setInterval>;
  private destroyed = false;
  async ngOnChanges() {
    const generation = ++this.generation;
    clearInterval(this.timer);
    this.timer = undefined;
    this.jobs = [];
    this.photos = [];
    this.error = "";
    this.ready = false;
    this.connectionMessage = "";
    if (!this.publicationEnabled || !this.workspaceId || !this.sessionId) return;
    await this.checkConnection();
  }
  @HostListener("window:focus")
  async checkConnection() {
    if (this.destroyed || !this.publicationEnabled || !this.workspaceId || !this.sessionId) return;
    const generation = this.generation;
    const probe = ++this.probe;
    try {
      const ping = await this.gateway.request("PING", undefined, 4000);
      if (generation !== this.generation || probe !== this.probe) return;
      this.ready =
        Array.isArray(ping["capabilities"]) &&
        ping["capabilities"].includes("rental-publishing") &&
        ping["capabilities"].includes("rental-address-suggestions") &&
        ping["capabilities"].includes("rental-form-session") &&
        ping["capabilities"].includes("rental-field-transfer-v2") &&
        ping["capabilities"].includes("rental-address-type-then-first") &&
        ping["capabilities"].includes("rental-onliner-city-menu") &&
        ping["capabilities"].includes("rental-localized-price") &&
        (this.store.category() === APARTMENT_RENT || (ping["capabilities"].includes("listing-category-path") && ping["capabilities"].includes("sale-scoped-controls")));
      this.connectionMessage = this.ready ? "" :
        `Подключённый помощник ${ping["version"] || ""} не поддерживает заполнение этой категории. Загрузите расширение ${this.extensionVersion} и перезагрузите его в Chrome.`;
      if (this.ready && this.timer === undefined) {
        this.timer = setInterval(() => void this.refresh(), 2500);
        await this.refresh();
      }
    } catch (e) {
      if (generation !== this.generation || probe !== this.probe) return;
      this.ready = false;
      this.connectionMessage = (e as Error).message;
    }
    if (!this.ready) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
  @HostListener("window:message", ["$event"])
  onExtensionReady(event: MessageEvent) {
    if (event.source === window && event.origin === location.origin &&
        event.data?.source === "autopost-extension" && event.data.type === "READY")
      void this.checkConnection();
  }
  async refresh() {
    const generation = this.generation;
    try {
      const result = await this.gateway.request(
        "RENTAL_STATUS",
        { categoryId: this.store.category(), profileId: this.workspaceId, id: this.sessionId },
        4000,
      );
      if (generation === this.generation && !this.destroyed)
        this.jobs = (result["jobs"] || []) as Job[];
    } catch {
      /* Keep last known progress when browser is disconnected. */
    }
  }
  async publish() {
    if (!this.publicationEnabled || this.busy || this.store.busy || !this.store.card.platforms.length)
      return;
    this.busy = true;
    this.error = "";
    const generation = this.generation;
    const payload = {
      id: this.sessionId,
      revision: this.store.editVersion + 1,
      categoryId: this.store.category(), profileId: this.workspaceId,
      card: structuredClone(this.store.card),
      mode: this.mode,
      photos: this.photos,
    };
    try {
      if (!this.ready) {
        await this.checkConnection();
        if (generation !== this.generation || !this.ready) return;
      }
      const result = await this.gateway.request("RENTAL_RUN", payload, 25000);
      if (generation === this.generation)
        this.jobs = (result["jobs"] || []) as Job[];
    } catch (e) {
      if (generation === this.generation) this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }
  async open(job: Job) {
    try {
      await this.gateway.request("RENTAL_OPEN", {
        id: this.sessionId,
        categoryId: this.store.category(), profileId: this.workspaceId,
        jobId: job.id,
      });
    } catch (e) {
      this.error = (e as Error).message;
    }
  }
  async stop() {
    try {
      await this.gateway.request("RENTAL_STOP", {
        id: this.sessionId,
        categoryId: this.store.category(), profileId: this.workspaceId,
      });
      await this.refresh();
    } catch (e) {
      this.error = (e as Error).message;
    }
  }
  name(platform: string) {
    return this.store.schema?.platforms[platform]?.name || platform;
  }
  async add(files: File[]) {
    if (this.photosBusy) return;
    this.photosBusy = true;
    this.error = "";
    const generation = this.generation;
    try {
      const photos = await this.gateway.add(this.photos, files);
      if (generation === this.generation) {
        this.photos = photos;
        this.store.changed();
      }
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.photosBusy = false;
    }
  }
  paste(event: ClipboardEvent) {
    const files = Array.from(event.clipboardData?.files || []).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length) {
      event.preventDefault();
      void this.add(files);
    }
  }
  files(event: Event) {
    const input = event.target as HTMLInputElement;
    void this.add(Array.from(input.files || []));
    input.value = "";
  }
  async remove(photo: Photo) {
    const generation = this.generation;
    const photos = this.photos.filter((p) => p.id !== photo.id);
    try {
      if (generation === this.generation) {
        this.photos = photos;
        this.store.changed();
      }
    } catch (e) {
      this.error = (e as Error).message;
    }
  }
  ngOnDestroy() {
    this.destroyed = true;
    this.generation++;
    clearInterval(this.timer);
  }
}
