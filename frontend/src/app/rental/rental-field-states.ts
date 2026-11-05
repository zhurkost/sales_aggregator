import { signal } from "@angular/core";
import type { RentalApi } from "./rental-api";
import type { FieldState, RentalDraft } from "./rental-models";

type Context = { workspace: string; draft: RentalDraft; destroyed: boolean };

/**
 * Which card fields the editor shows, with their options and whether a chosen platform requires
 * or receives them: the server decides it for the card and its platforms, the editor only draws
 * the answer. The last answer stays until the next one arrives.
 */
export class RentalFieldStates {
  private readonly answer = signal(new Map<string, FieldState>());
  /** The last answer: field id → its state. */
  get fields() { return this.answer(); }
  set fields(value: Map<string, FieldState>) { this.answer.set(value); }
  private sequence = 0;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private api: RentalApi,
    private context: () => Context,
    private failed: (message: string) => void,
  ) {}
  /** After an edit, with the same pause as saving. */
  schedule(delay = 1200) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), delay);
  }
  async refresh() {
    clearTimeout(this.timer);
    const before = this.context();
    if (before.destroyed) return;
    const request = ++this.sequence;
    try {
      const result = await this.api.request<{ fields: FieldState[] }>(before.workspace, "fields", {
        draft: structuredClone(before.draft),
      });
      if (request === this.sequence && !this.context().destroyed)
        this.fields = new Map(result.fields.map((field) => [field.id, field]));
    } catch (error) {
      if (request === this.sequence && !this.context().destroyed)
        this.failed((error as Error).message);
    }
  }
  clear() {
    this.sequence++;
    clearTimeout(this.timer);
  }
}
