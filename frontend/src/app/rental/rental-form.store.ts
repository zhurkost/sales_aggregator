import { APARTMENT_RENT } from "../listing-categories";
import type { EditorSchema, Prepared, RentalCard } from "./rental-models";
import { rentalApi } from "./rental-api";
import { RentalCardCheck } from "./rental-card-check";
import { RentalApplicability } from "./rental-applicability";
import { applyProfileDefaults, type RentalProfile } from "./rental-profile-defaults";

/** Current form in memory. No persistence or server-side project lifecycle. */
export class RentalFormStore {
  constructor(private workspaceId: () => string, private profile: () => RentalProfile = () => ({}), readonly category: () => string = () => APARTMENT_RENT) {}
  schema: EditorSchema | null = null;
  card: RentalCard = {schemaVersion:"",values:{},extras:{},platforms:[],address:null};
  id: string = crypto.randomUUID();
  editVersion = 0;
  error = "";
  busy = false;
  destroyed = false;
  private localFiles: Record<string, (string | undefined)[]> = {};
  private timer?: ReturnType<typeof setTimeout>;
  readonly check = new RentalCardCheck(() => ({workspace:this.workspaceId(), category:this.category(), id:this.id,
    version:this.editVersion, card:this.card, localFileCounts:this.localFileCounts(), destroyed:this.destroyed}));
  readonly applicability = new RentalApplicability(() => ({workspace:this.workspaceId(), category:this.category(), id:this.id,
    version:this.editVersion, schemaVersion:this.schema?.version, enabled:!!this.schema?.serverApplicability,
    card:this.card, destroyed:this.destroyed}));
  get results() { return this.check.results; }
  set results(value: Prepared[]) { this.check.results = value; }
  get platforms() { return Object.keys(this.schema?.platforms || {}); }
  /** File bytes stay in the browser. Preparation only needs their presence/count. */
  setLocalFiles(field: string, files: {sourceUrl?: string}[]) {
    this.localFiles[field] = files.map(file => file.sourceUrl);
    this.changed();
  }
  localFileCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [field, sources] of Object.entries(this.localFiles)) {
      const links = Array.isArray(this.card.values[field]) ? [...this.card.values[field]] : [];
      let local = 0;
      for (const source of sources) {
        const index = source ? links.indexOf(source) : -1;
        if (index >= 0) links.splice(index, 1);
        else local++;
      }
      if (local) counts[field] = local;
    }
    return counts;
  }
  preparationInput() {
    return {...structuredClone(this.card), localFileCounts:this.localFileCounts()};
  }
  async load() {
    try {
      this.schema = await rentalApi<EditorSchema>(this.workspaceId(), this.category(), "editor");
      if (this.destroyed) return;
      this.card.categoryId = this.category();
      this.card.schemaVersion = this.schema.version;
      this.card.modelVersion = this.schema.card?.version;
      this.card.platforms = this.platforms;
      applyProfileDefaults(this.card, this.schema, this.profile());
      this.applicability.schedule();
    } catch (e) { this.error = (e as Error).message; }
  }
  changed() {
    this.editVersion++;
    this.check.invalidate();
    this.applicability.schedule();
    clearTimeout(this.timer);
    if (this.check.checked) this.timer = setTimeout(() => {
      if (!this.destroyed && !this.busy && this.check.stale) void this.check.refresh();
    },1200);
  }
  async updateFields() {
    if (this.busy) return;
    this.busy = true;
    try {
      const schema = await rentalApi<EditorSchema>(this.workspaceId(), this.category(), "editor");
      const card = await rentalApi<RentalCard>(this.workspaceId(), this.category(), "normalize", this.card);
      if (this.destroyed) return;
      this.schema = schema; this.card = card; this.check.clear(); this.changed(); this.error = "";
    } catch (e) { this.error = (e as Error).message; }
    finally { this.busy = false; }
  }
  acceptSchema() { if (this.schema) { this.card.schemaVersion = this.schema.version; this.error = ""; this.changed(); } }
  async prepare() {
    if (this.busy || this.check.checking) return;
    this.error = "";
    await this.check.refresh();
  }
  destroy() { this.destroyed = true; clearTimeout(this.timer); this.applicability.clear(); this.check.clear(); }
}
