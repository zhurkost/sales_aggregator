import { Component, Input, Output, EventEmitter } from "@angular/core";
@Component({
  selector: "app-rental-saved-list", standalone: true,
  templateUrl: "./rental-saved-list.component.html", styleUrl: "./rental-saved-list.component.css",
})
export class RentalSavedListComponent {
  @Input() drafts: {id: string; title: string; address: string}[] = [];
  @Input() busy = false;
  @Input() pendingDelete: string | null = null;
  @Output() openDraft = new EventEmitter<string>();
  @Output() confirmDelete = new EventEmitter<string | null>();
  @Output() deleteDraft = new EventEmitter<string>();
}
