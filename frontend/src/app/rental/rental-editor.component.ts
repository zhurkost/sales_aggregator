import {
  Component,
  Input,
  OnInit,
  OnDestroy,
  HostListener,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { AddressInputComponent } from "./address-input.component";
import { applicable } from "./conditions";
import {
  Address,
  EditorSchema,
  Field,
  JsonValue,
  Prepared,
  RentalDraft,
  rentalApi,
} from "./rental-api";

@Component({
  selector: "app-rental-editor",
  standalone: true,
  imports: [FormsModule, AddressInputComponent],
  templateUrl: "./rental-editor.component.html",
  styleUrl: "./rental-editor.component.css",
})
export class RentalEditorComponent implements OnInit, OnDestroy {
  @Input({ required: true }) workspaceId = "";
  schema: EditorSchema | null = null;
  draft: RentalDraft = {
    schemaVersion: "",
    values: {},
    extras: {},
    platforms: ["kufar", "onliner", "realt", "domovita"],
    address: null,
  };
  id: string = crypto.randomUUID();
  revision = 0;
  dirty = false;
  status = "";
  error = "";
  busy = false;
  pendingDelete: string | null = null;
  deletingId: string | null = null;
  drafts: { id: string; title: string; address: string; revision: number }[] =
    [];
  results: Prepared[] = [];
  readonly names: Record<string, string> = {
    kufar: "Kufar",
    onliner: "Onliner",
    realt: "Realt",
    domovita: "Domovita",
  };
  private timer?: ReturnType<typeof setTimeout>;
  private queue: Promise<void> = Promise.resolve();
  private editVersion = 0;
  private destroyed = false;
  async ngOnInit() {
    try {
      this.schema = await rentalApi<EditorSchema>(this.workspaceId, "editor");
      this.draft.schemaVersion = this.schema.version;
      await this.refresh();
    } catch (e) {
      this.error = (e as Error).message;
    }
  }
  get platforms() {
    return Object.keys(this.schema?.platforms || {});
  }
  async refresh() {
    this.drafts = (
      await rentalApi<{ drafts: RentalEditorComponent["drafts"] }>(
        this.workspaceId,
        "drafts",
      )
    ).drafts;
  }
  changed() {
    this.editVersion++;
    this.dirty = true;
    this.results = [];
    this.status = "Есть изменения";
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.save().catch((e) => (this.error = e.message));
    }, 900);
  }
  setValue(field: Field, value: string) {
    this.draft.values[field.id] =
      field.type === "files"
        ? value
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
        : value;
    // A manually edited address is no longer the same confirmed provider selection.
    if (field.id.startsWith("location.") && this.draft.address)
      this.draft.address = null;
    this.changed();
  }
  value(field: Field) {
    const v = this.draft.values[field.id];
    return Array.isArray(v) ? v.join("\n") : String(v ?? "");
  }
  choices(field: Field) {
    return this.schema?.canonicalValues[field.id] || [];
  }
  label(value: string) {
    const labels: Record<string, string> = {
      studio: "Студия",
      allowed: "Разрешено",
      forbidden: "Запрещено",
      yes: "Есть",
      no: "Нет",
      present: "Есть",
      absent: "Нет",
      partial: "Частично",
      owner: "Собственник",
      agency: "Агентство",
      gas: "Газовая",
      electric: "Электрическая",
      none: "Нет",
      separate: "Раздельный",
      combined: "Совмещённый",
      two: "Два",
      three: "Три",
      two_plus: "Два и более",
      present_unspecified: "Есть, тип не уточнён",
      balcony: "Балкон",
      loggia: "Лоджия",
      balcony_and_loggia: "Балкон и лоджия",
      terrace: "Терраса",
      panel: "Панельный",
      monolithic: "Монолитный",
      brick: "Кирпичный",
      block: "Блочный",
      frame: "Каркасный",
      frame_block: "Каркасно-блочный",
      block_rooms: "Блок-комнаты",
      silicate_blocks: "Силикатные блоки",
      logs: "Бревенчатый",
      cosmetic: "Косметический",
      euro: "Евроремонт",
      designer: "Дизайнерский",
      construction_finish: "Строительная отделка",
      unfinished: "Без отделки",
      needs_repair: "Требуется ремонт",
      unsafe_condition: "Аварийное состояние",
      good: "Хороший",
      normal: "Нормальный",
      poor: "Плохое состояние",
      months_1: "Один месяц",
      months_2: "Два месяца",
      months_3: "Три месяца",
      months_3_plus: "Три и более месяца",
      months_6: "Полгода",
      deposit_unspecified: "Залог, сумма не уточнена",
      calls_and_messages: "Звонки и сообщения",
      calls_only: "Только звонки",
      messages_only: "Только сообщения",
    };
    return labels[value] || value;
  }
  addressChanged(address: Address | null) {
    const hadAddress = !!this.draft.address;
    this.draft.address = address;
    const parts: Record<string, string> = address
      ? {
          "location.settlement": [
            ...new Set(
              [address.region, address.district, address.settlement].filter(
                Boolean,
              ),
            ),
          ].join(", "),
          "location.street": address.street,
          "location.house_number":
            address.house +
            (address.block
              ? ` ${address.blockType || "корп."} ${address.block}`
              : ""),
          "location.latitude":
            address.precision === "0" ? address.latitude || "" : "",
          "location.longitude":
            address.precision === "0" ? address.longitude || "" : "",
        }
      : {};
    if (hadAddress || address)
      for (const key of [
        "location.settlement",
        "location.street",
        "location.house_number",
        "location.latitude",
        "location.longitude",
      ])
        this.draft.values[key] = parts[key] || "";
    this.changed();
  }
  togglePlatform(p: string, checked: boolean) {
    this.draft.platforms = checked
      ? [...new Set([...this.draft.platforms, p])]
      : this.draft.platforms.filter((x) => x !== p);
    this.changed();
  }
  extra(p: string, id: string) {
    return this.draft.extras[p]?.[id] ?? "";
  }
  setExtra(p: string, f: Field, raw: JsonValue) {
    // Keep typed decimal text intact until the server's exact BigDecimal conversion.
    this.draft.extras[p] ||= {};
    this.draft.extras[p][f.id] = raw;
    this.changed();
  }
  selected(p: string, f: Field, value: JsonValue) {
    const xs = this.extra(p, f.id);
    return Array.isArray(xs) && xs.some((x) => x === value);
  }
  context(p: string) {
    const schema = this.schema?.platforms[p];
    const values = { ...this.draft.extras[p], ...schema?.constants };
    for (const binding of schema?.bindings || []) {
      const pair = binding.pairs.find(
        (pair) => pair.from === this.draft.values[binding.source],
      );
      if (pair && values[binding.target] == null)
        values[binding.target] = pair.to;
      else if (pair && values[binding.target] === "")
        values[binding.target] = pair.to;
    }
    return values;
  }
  availableExtras(p: string) {
    const values = this.context(p);
    return (
      this.schema?.platforms[p].extras.filter(
        (f) => applicable(f.uiWhen, values) === true,
      ) || []
    );
  }
  waitingExtras(p: string) {
    const values = this.context(p);
    return this.schema?.platforms[p].extras.some(
      (f) => applicable(f.uiWhen, values) === null,
    );
  }
  nativeChoices(p: string, field: Field) {
    const values = this.context(p);
    return field.options.filter(
      (option) => applicable(option.fill_rule["when"], values) === true,
    );
  }
  extraFiles(p: string, field: Field, text: string) {
    this.setExtra(
      p,
      field,
      text
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  extraFileText(p: string, field: Field) {
    const value = this.extra(p, field.id);
    return Array.isArray(value) ? value.join("\n") : String(value);
  }
  issueMessages(result: Prepared) {
    return [...new Set(result.issues.map((issue) => issue.message))];
  }
  toggleExtra(p: string, f: Field, value: JsonValue, checked: boolean) {
    const old = this.extra(p, f.id);
    const values = Array.isArray(old) ? old : [];
    this.setExtra(
      p,
      f,
      (checked
        ? [...values, value]
        : values.filter((x) => x !== value)) as string[],
    );
  }
  save(): Promise<void> {
    clearTimeout(this.timer);
    const save = this.queue
      .catch(() => {})
      .then(async () => {
        if (!this.dirty || this.deletingId === this.id) return;
        const version = this.editVersion,
          id = this.id,
          snapshot = structuredClone(this.draft);
        this.status = "Сохраняем…";
        const result = await rentalApi<{ revision: number }>(
          this.workspaceId,
          "drafts/" + id,
          { revision: this.revision, draft: snapshot },
        );
        if (this.id === id) {
          this.revision = result.revision;
          this.dirty = this.editVersion !== version;
          this.status = this.dirty
            ? "Есть новые изменения"
            : "Сохранено в кабинете";
        }
        if (!this.destroyed) await this.refresh();
      });
    this.queue = save;
    return save;
  }
  async flush() {
    // Leaving the editor must also save changes typed while a prior request was running.
    do {
      await this.save();
    } while (this.dirty);
  }
  async open(id: string) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    this.pendingDelete = null;
    try {
      await this.flush();
      const result = await rentalApi<{
        id: string;
        revision: number;
        draft: RentalDraft;
      }>(this.workspaceId, "drafts/" + id);
      this.id = result.id;
      this.revision = result.revision;
      this.draft = result.draft;
      this.results = [];
      this.dirty = false;
      if (this.schema && this.draft.schemaVersion !== this.schema.version)
        this.error =
          "Правила обновились. Проверьте поля и нажмите «Принять новую схему».";
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }
  async fresh() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.flush();
      this.resetDraft();
      this.status = "Новая карточка";
      this.error = "";
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }
  private resetDraft() {
    clearTimeout(this.timer);
    this.editVersion++;
    this.id = crypto.randomUUID();
    this.revision = 0;
    this.results = [];
    this.draft = {
      schemaVersion: this.schema?.version || "",
      values: {},
      extras: {},
      platforms: this.platforms,
      address: null,
    };
    this.dirty = false;
    this.pendingDelete = null;
  }
  async remove(id: string) {
    if (this.busy || this.pendingDelete !== id) return;
    this.busy = true;
    this.deletingId = id;
    this.error = "";
    if (this.id === id) clearTimeout(this.timer);
    // Finish an already-running save first; queued saves of this card are skipped.
    // Later saves stay behind deletion and cannot recreate the removed card.
    const removal = this.queue.catch(() => {}).then(async () => {
      const item = this.drafts.find((draft) => draft.id === id);
      if (!item) throw new Error("Квартира не найдена. Обновите список.");
      const revision = this.id === id ? this.revision : item.revision;
      await rentalApi(this.workspaceId, "drafts/" + id + "/delete", { revision });
      this.drafts = this.drafts.filter((draft) => draft.id !== id);
      if (this.id === id) this.resetDraft();
      this.pendingDelete = null;
      this.status = "Квартира удалена";
    });
    this.queue = removal;
    try {
      await removal;
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.deletingId = null;
      this.busy = false;
    }
  }
  acceptSchema() {
    if (this.schema) {
      this.draft.schemaVersion = this.schema.version;
      this.error = "";
      this.changed();
    }
  }
  async prepare() {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    const version = this.editVersion;
    try {
      await this.flush();
      const result = await rentalApi<{ platforms: Prepared[] }>(
        this.workspaceId,
        "prepare",
        structuredClone(this.draft),
      );
      if (version === this.editVersion) this.results = result.platforms;
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }
  display(value: JsonValue) {
    return typeof value === "string" ? value : JSON.stringify(value);
  }
  preparedValues(result: Prepared) {
    const schema = this.schema?.platforms[result.platform];
    return Object.entries(result.values).map(([id, value]) => ({
      id,
      name: schema?.labels[id] || id,
      value: Array.isArray(value)
        ? value
            .map(
              (v) =>
                schema?.choiceLabels[id]?.[JSON.stringify(v)] ||
                this.display(v),
            )
            .join(", ")
        : schema?.choiceLabels[id]?.[JSON.stringify(value)] ||
          (id.endsWith(".description")
            ? String(this.draft.values["listing.description"] || value)
            : this.display(value)),
    }));
  }
  @HostListener("window:beforeunload", ["$event"]) unload(
    event: BeforeUnloadEvent,
  ) {
    if (this.dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  }
  ngOnDestroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
  }
}
