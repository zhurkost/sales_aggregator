import { Component, Input, OnChanges, OnDestroy } from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { Photo } from "../../../../lib/workspace";
import { rentalPhotoUrl } from "./rental-api";
import { RentalDraftStore } from "./rental-draft.store";
import type { RentalPhoto } from "./rental-models";
import { RentalPublicationGateway } from "./rental-publication.gateway";

/** Версия расширения, которую требует аренда; её же предлагает ссылка на ZIP. */
export const REQUIRED_EXTENSION_VERSION = "0.9.6";

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
  @Input({ required: true }) store!: RentalDraftStore;
  @Input({ required: true }) workspaceId = "";
  @Input({ required: true }) draftId = "";
  readonly requiredVersion = REQUIRED_EXTENSION_VERSION;
  // Final submission is never the default: the user opts in per launch and confirms it.
  mode: "automatic" | "assist" = "assist";
  confirmingAutomatic = false;
  busy = false;
  photosBusy = false;
  error = "";
  ready = false;
  jobs: Job[] = [];
  /** Photos an older release kept in this browser for this card, while the server has none. */
  localPhotos: Photo[] = [];
  private generation = 0;
  private timer?: ReturnType<typeof setInterval>;
  private destroyed = false;
  async ngOnChanges() {
    const generation = ++this.generation;
    clearInterval(this.timer);
    this.jobs = [];
    this.localPhotos = [];
    this.error = "";
    if (!this.workspaceId || !this.draftId) return;
    void this.findLocalPhotos(generation);
    try {
      const ping = await this.gateway.request("PING", undefined, 4000);
      if (generation !== this.generation) return;
      this.ready =
        Array.isArray(ping["capabilities"]) &&
        ping["capabilities"].includes("rental-publishing") &&
        ping["capabilities"].includes("rental-address-suggestions") &&
        // Older extensions would press the final button without the server check
        // or wait for its former name, dataReady.
        ping["capabilities"].includes("rental-checks-passed") &&
        // ...or after a release replaced the rules the form was filled with.
        ping["capabilities"].includes("rental-integration-version") &&
        // ...and older ones reject the Realt description editor (TinyMCE in an iframe)
        ping["capabilities"].includes("rental-iframe-richtext") &&
        // ...or upload the photos the page sends instead of those stored with the card
        ping["capabilities"].includes("rental-server-photos") &&
        // ...or keep the publication only in the browser, checking the final click without it.
        ping["capabilities"].includes("rental-publication-history");
      if (this.ready) {
        await this.refresh();
        if (generation === this.generation && !this.destroyed)
          this.timer = setInterval(() => void this.refresh(), 2500);
      }
    } catch {
      if (generation === this.generation) this.ready = false;
    }
  }
  setAutomatic(enabled: boolean) {
    this.confirmingAutomatic = enabled && this.mode !== "automatic";
    if (!enabled) this.mode = "assist";
  }
  confirmAutomatic() {
    this.mode = "automatic";
    this.confirmingAutomatic = false;
  }
  cancelAutomatic() {
    this.confirmingAutomatic = false;
  }
  async refresh() {
    const generation = this.generation;
    try {
      const result = await this.gateway.request(
        "RENTAL_STATUS",
        { profileId: this.workspaceId, id: this.draftId },
        4000,
      );
      if (generation === this.generation && !this.destroyed)
        this.jobs = (result["jobs"] || []) as Job[];
    } catch {
      /* Keep last known progress when browser is disconnected. */
    }
  }
  async publish() {
    if (this.busy || this.store.busy || !this.store.draft.platforms.length)
      return;
    if (!this.ready) {
      this.error = `Установите расширение ${REQUIRED_EXTENSION_VERSION} и обновите вкладку Автопоста.`;
      return;
    }
    this.busy = true;
    this.error = "";
    const generation = this.generation;
    // Send immediately from the click: the bridge records the trusted gesture,
    // then waits for the serialized save before loading its server-owned recipe.
    if (!this.store.revision) this.store.dirty = true;
    const payload = {
      id: this.draftId,
      profileId: this.workspaceId,
      draft: structuredClone(this.store.draft),
      mode: this.mode,
    };
    try {
      const [, result] = await Promise.all([
        this.store.flush(),
        this.gateway.request("RENTAL_RUN", payload, 25000),
      ]);
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
        id: this.draftId,
        profileId: this.workspaceId,
        jobId: job.id,
      });
    } catch (e) {
      this.error = (e as Error).message;
    }
  }
  async stop() {
    try {
      await this.gateway.request("RENTAL_STOP", {
        id: this.draftId,
        profileId: this.workspaceId,
      });
      await this.refresh();
    } catch (e) {
      this.error = (e as Error).message;
    }
  }
  name(platform: string) {
    return this.store.schema?.platforms[platform]?.name || platform;
  }
  get photos() {
    return this.store.photos;
  }
  get photoLimit() {
    return this.store.schema?.photoLimit ?? 0;
  }
  photoUrl(photo: RentalPhoto) {
    return rentalPhotoUrl(this.store.id, photo.id);
  }
  async add(files: File[]) {
    if (this.photosBusy || !files.length) return;
    this.photosBusy = true;
    this.error = "";
    try {
      // The server's limit, checked before compressing a batch the server would refuse.
      if (this.photoLimit && this.photos.length + files.length > this.photoLimit)
        throw new Error(`У квартиры может быть до ${this.photoLimit} фотографий.`);
      await this.store.addPhotos(await this.gateway.compress(files));
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
  async remove(photo: RentalPhoto) {
    await this.photoChange(() => this.store.removePhoto(photo.id));
  }
  async move(photo: RentalPhoto, offset: -1 | 1) {
    await this.photoChange(() => this.store.movePhoto(photo.id, offset));
  }
  private async findLocalPhotos(generation: number) {
    if (this.store.photos.length) return;
    try {
      const local = await this.gateway.localPhotos(this.workspaceId, this.draftId);
      if (generation === this.generation && !this.store.photos.length)
        this.localPhotos = local;
    } catch {
      /* Nothing readable in this browser: nothing to transfer. */
    }
  }
  /** One-time transfer: the photos of this browser go to the card on the server. */
  async uploadLocalPhotos() {
    const workspace = this.workspaceId,
      id = this.draftId,
      local = this.localPhotos;
    await this.photoChange(async () => {
      await this.store.addPhotos(local.map(({ name, dataUrl }) => ({ name, dataUrl })));
      this.localPhotos = [];
      await this.gateway.forgetLocalPhotos(workspace, id);
    });
  }
  async forgetLocalPhotos() {
    await this.photoChange(async () => {
      await this.gateway.forgetLocalPhotos(this.workspaceId, this.draftId);
      this.localPhotos = [];
    });
  }
  private async photoChange(change: () => Promise<void>) {
    if (this.photosBusy) return;
    this.photosBusy = true;
    this.error = "";
    try {
      await change();
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.photosBusy = false;
    }
  }
  ngOnDestroy() {
    this.destroyed = true;
    this.generation++;
    clearInterval(this.timer);
  }
}
