import { Injectable, signal } from "@angular/core";
import type { RentalDraftStore } from "./rental-draft.store";
import type { RentalProfile } from "./rental-profile-defaults";

/**
 * What the rental route needs from the signed-in cabinet, and the open editor's store, so that
 * leaving the route or the cabinet saves what is typed first.
 */
@Injectable({ providedIn: "root" })
export class RentalSession {
  /** The cabinet of the signed-in profile; empty when nobody is signed in. */
  readonly workspaceId = signal("");
  /** The contacts of the profile a new card takes. */
  readonly profile = signal<RentalProfile>({});
  private store: RentalDraftStore | null = null;
  attach(store: RentalDraftStore) {
    this.store = store;
  }
  detach(store: RentalDraftStore) {
    if (this.store === store) this.store = null;
  }
  /** Saves the open card, including edits typed during a save; nothing without an editor. */
  async flush() {
    await this.store?.flush();
  }
}
