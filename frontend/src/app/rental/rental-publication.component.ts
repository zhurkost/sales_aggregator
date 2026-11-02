import { Component, Input, OnChanges, OnDestroy } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { type Photo } from "../../../../lib/workspace";
import { RentalDraftStore } from "./rental-draft.store";
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
  @Input({ required: true }) store!: RentalDraftStore;
  @Input({ required: true }) workspaceId = "";
  @Input({ required: true }) draftId = "";
  mode: "automatic" | "assist" = "automatic";
  busy = false;
  photosBusy = false;
  error = "";
  ready = false;
  photos: Photo[] = [];
  jobs: Job[] = [];
  private generation = 0;
  private timer?: ReturnType<typeof setInterval>;
  private destroyed = false;
  async ngOnChanges() {
    const generation = ++this.generation;
    clearInterval(this.timer);
    this.jobs = [];
    this.photos = [];
    this.error = "";
    if (!this.workspaceId || !this.draftId) return;
    const workspace = this.workspaceId,
      id = this.draftId;
    try {
      const photos = await this.gateway.photos(workspace, id);
      if (generation === this.generation) this.photos = photos;
    } catch (e) {
      if (generation === this.generation) this.error = (e as Error).message;
    }
    try {
      const ping = await this.gateway.request("PING", undefined, 4000);
      if (generation !== this.generation) return;
      this.ready =
        Array.isArray(ping["capabilities"]) &&
        ping["capabilities"].includes("rental-publishing");
      if (this.ready) {
        await this.refresh();
        if (generation === this.generation && !this.destroyed)
          this.timer = setInterval(() => void this.refresh(), 2500);
      }
    } catch {
      if (generation === this.generation) this.ready = false;
    }
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
      this.error = "Установите расширение 0.9.0 и обновите вкладку Автопоста.";
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
      photos: this.photos,
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
  async add(files: File[]) {
    if (this.photosBusy) return;
    this.photosBusy = true;
    this.error = "";
    const generation = this.generation,
      workspace = this.workspaceId,
      id = this.draftId;
    try {
      const photos = await this.gateway.add(this.photos, files);
      await this.gateway.photos(workspace, id, photos);
      if (generation === this.generation) this.photos = photos;
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
    const photos = this.photos.filter((p) => p.id !== photo.id);
    try {
      await this.gateway.photos(this.workspaceId, this.draftId, photos);
      this.photos = photos;
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
