import { rentalApi } from "./rental-api";
import type { Prepared, RentalCard } from "./rental-models";

type Context = {
  workspace: string;
  category: string;
  id: string;
  version: number;
  card: RentalCard;
  localFileCounts?: Record<string, number>;
  destroyed: boolean;
};

/** Validation is independent of saving. Keep the last report while editing. */
export class RentalCardCheck {
  results: Prepared[] = [];
  checked = false;
  stale = false;
  checking = false;
  error = "";
  private sequence = 0;
  constructor(private context: () => Context) {}

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
        now.category === before.category &&
        now.id === before.id &&
        now.workspace === before.workspace &&
        now.version === before.version
      );
    };
    try {
      const result = await rentalApi<{ platforms: Prepared[] }>(
        before.workspace,
        before.category,
        "prepare",
        {...structuredClone(before.card), localFileCounts:before.localFileCounts || {}},
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
