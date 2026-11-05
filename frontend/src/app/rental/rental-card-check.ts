import { signal } from "@angular/core";
import type { RentalApi } from "./rental-api";
import type { Prepared, RentalDraft } from "./rental-models";

type Context = {
  workspace: string;
  id: string;
  version: number;
  draft: RentalDraft;
  destroyed: boolean;
};

/** Validation is independent of saving. Keep the last report while editing. */
export class RentalCardCheck {
  private readonly report = signal<Prepared[]>([]);
  get results() { return this.report(); }
  set results(value: Prepared[]) { this.report.set(value); }
  checked = false;
  stale = false;
  checking = false;
  error = "";
  private sequence = 0;
  constructor(
    private api: RentalApi,
    private context: () => Context,
  ) {}

  invalidate() {
    if (this.checked || this.results.length) this.stale = true;
  }
  clear() {
    this.sequence++;
    this.results = [];
    this.checked = false;
    this.stale = false;
    this.checking = false;
    this.error = "";
  }
  async refresh() {
    const before = this.context();
    if (before.destroyed) return;
    const request = ++this.sequence;
    this.checked = true;
    this.checking = true;
    this.stale = true;
    this.error = "";
    const current = () => {
      const now = this.context();
      return (
        request === this.sequence &&
        !now.destroyed &&
        now.id === before.id &&
        now.workspace === before.workspace &&
        now.version === before.version
      );
    };
    try {
      // The server adds the photos stored with this card.
      const result = await this.api.request<{ platforms: Prepared[] }>(
        before.workspace,
        "prepare",
        { id: before.id, draft: structuredClone(before.draft) },
      );
      if (current()) {
        this.results = result.platforms;
        this.stale = false;
      }
    } catch (error) {
      if (current()) this.error = (error as Error).message;
    } finally {
      if (request === this.sequence) this.checking = false;
    }
  }
}
