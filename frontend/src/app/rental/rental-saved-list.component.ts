import { Component, Input, Output, EventEmitter } from "@angular/core";
import type { RentalListedDraft, RentalPublication } from "./rental-models";

const STATUS: Record<RentalPublication["status"], string> = {
  opened: "Форма открыта",
  filled: "Заполнено, завершите на площадке",
  submitted: "Отправлено на площадку",
  needs_action: "Нужно действие на площадке",
  stopped: "Остановлено",
};
@Component({
  selector: "app-rental-saved-list", standalone: true,
  templateUrl: "./rental-saved-list.component.html", styleUrl: "./rental-saved-list.component.css",
})
export class RentalSavedListComponent {
  @Input() drafts: RentalListedDraft[] = [];
  /** Names of the platforms, from the editor schema. */
  @Input() platforms: Record<string, { name?: string }> = {};
  @Input() busy = false;
  @Input() pendingDelete: string | null = null;
  @Output() openDraft = new EventEmitter<string>();
  @Output() confirmDelete = new EventEmitter<string | null>();
  @Output() deleteDraft = new EventEmitter<string>();
  @Output() saveLink = new EventEmitter<{ publication: string; url: string }>();
  status(publication: RentalPublication) { return STATUS[publication.status] || publication.status; }
  name(platform: string) { return this.platforms[platform]?.name || platform; }
  when(updated: string) {
    const date = new Date(updated);
    return isNaN(date.getTime()) ? "" : date.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }
}
