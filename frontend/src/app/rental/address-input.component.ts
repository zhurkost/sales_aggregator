import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnDestroy,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Address, rentalApi } from "./rental-api";

@Component({
  selector: "app-address-input",
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (compact) {
      <div class="compact-heading"><label for="rental-address">Адрес</label><button type="button" [disabled]="disabled" (click)="manual = !manual">{{ manual ? 'Найти адрес' : 'Ввести вручную' }}</button></div>
    } @else {
    <div class="address-mode">
      <button type="button" [disabled]="disabled" (click)="manual = false" [attr.aria-pressed]="!manual">Найти адрес</button>
      <button type="button" [disabled]="disabled" (click)="manual = true" [attr.aria-pressed]="manual">Ввести вручную</button>
    </div>
    }
    @if (!manual) {
      <label class="full-label" [class.compact-input]="compact">@if (!compact) { Адрес квартиры }
        <input id="rental-address" role="combobox" aria-autocomplete="list" aria-controls="rental-address-options"
          [attr.aria-expanded]="suggestions.length > 0" [attr.aria-activedescendant]="active >= 0 ? optionId(active) : null"
          aria-label="Поиск адреса квартиры" [disabled]="disabled" [ngModel]="query"
          (ngModelChange)="search($event)" (focus)="suggestCurrent()" (keydown)="keys($event)" autocomplete="off" maxlength="300" placeholder="Город, улица, дом" />
      </label>
      @if (busy) { <p role="status">Ищем адрес…</p> }
      @if (error) { <p role="status">{{ error }}</p> }
      @if (suggestions.length) {
        <ul class="address-options" id="rental-address-options" role="listbox" aria-label="Варианты адреса">
          @for (item of suggestions; track item.id; let i = $index) {
            <li role="option" [id]="optionId(i)" [class.active]="i === active" [attr.aria-selected]="i === active"
              [attr.aria-disabled]="choosing || disabled" (mousedown)="$event.preventDefault()" (click)="pick(i)">{{ item.label }}</li>
          }
        </ul>
      }
      @if (selected?.confirmed && !compact) {
        <p class="address-confirmation">Выбран: <strong>{{ selected?.label }}</strong></p>
      } @else if (query && !compact) {
        <p class="fine-print">Текст сохранён. Выберите подсказку или уточните части адреса вручную.</p>
      }
    } @else {
      <div class="manual-grid" id="rental-address" tabindex="-1">
        @for (part of parts; track part.key) {
          <label class="full-label">{{ part.label }}
            <input [attr.aria-label]="part.label" [disabled]="disabled" [ngModel]="partValue(part.key)" (ngModelChange)="setPart(part.key, $event)" maxlength="200" />
          </label>
        }
      </div>
      @if (selected?.label && !compact) { <p class="fine-print">{{ selected?.label }}</p> }
    }
    @if (!compact) { <p class="fine-print">Один адрес для всех площадок. Поиск: DaData · OpenStreetMap. Если дома нет в подсказках, используйте ручной ввод.</p> }
  `,
  styles: [
    `
      .address-mode { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; }
      .compact-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:8px; font-size:13px; color:#43536a; }
      .compact-heading label { font-weight:550; }
      .compact-heading button { border:0; background:transparent; color:#3658ba; padding:0; font-size:12px; }
      .compact-input { margin:0; }
      .manual-grid .full-label { margin:0; font-size:13px; }
      .address-mode button { background:#f2f5fa; border:1px solid #d9dfeb; padding:8px 12px; border-radius:8px; color:#304a6c; }
      .address-mode button[aria-pressed=true] { background:#e8efff; border-color:#8da6ee; }
      input { width:100%; border:1px solid #d9dfeb; border-radius:8px; padding:12px; box-sizing:border-box; }
      .manual-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
      .manual-grid label { display:flex; flex-direction:column; gap:7px; }
      @media(max-width:600px) { .manual-grid { grid-template-columns:1fr; } }
      .address-options {
        list-style: none;
        padding: 0;
        border: 1px solid #d9dfeb;
        border-radius: 12px;
        overflow: hidden;
      }
      .address-options li {
        padding: 12px;
        background: white;
        cursor: pointer;
      }
      .address-options li:hover,
      .address-options li.active {
        background: #edf2ff;
      }
      .address-options li[aria-disabled=true] {
        opacity: .55;
        cursor: default;
      }
      .address-confirmation {
        padding: 12px;
        background: #eef8f2;
        border-radius: 10px;
      }
    `,
  ],
})
export class AddressInputComponent implements OnDestroy {
  @Input({ required: true }) workspaceId = "";
  @Input() compact = false;
  @Input() set draftId(id: string) {
    if (id === this.currentDraft) return;
    this.currentDraft = id;
    this.resetPending();
    this.selected = null;
    this.query = "";
    this.manual = false;
  }
  @Input() set value(value: Address | null) {
    // A search already cleared our selection before notifying the parent.
    if (value === this.selected) return;
    this.resetPending();
    this.selected = value;
    this.query = value?.label || "";
    this.manual = value?.provider === "manual" &&
      ((!!value.resolution && value.resolution !== "matched") || this.parts.some(part => !!this.partValue(part.key)));
  }
  @Input() set disabled(value: boolean) { this.locked = value; if (value) this.resetPending(); }
  get disabled() { return this.locked; }
  private locked = false;
  manual = false;
  readonly parts = [
    {key:"settlement",label:"Населённый пункт"}, {key:"street",label:"Улица"},
    {key:"house",label:"Дом, включая букву"}, {key:"block",label:"Корпус"},
    {key:"region",label:"Область"}, {key:"district",label:"Район"},
  ];
  partValue(key: string) { return String((this.selected as unknown as Record<string, unknown>)?.[key] || ""); }
  setPart(key: string, value: string) {
    if (this.disabled) return;
    this.resetPending();
    const a = {countryIso:"BY", settlement:"", street:"", house:"", ...this.selected, [key]:value, provider:"manual", confirmed:false, latitude:"", longitude:"", sourceId:undefined, confirmedAt:undefined, precision:undefined, resolution:undefined} as Address;
    a.label = [a.region, a.district, a.settlement, a.street, a.house, a.block].filter(Boolean).join(", ");
    this.selected = a; this.query = a.label; this.addressChange.emit(a);
  }
  @Output() addressChange = new EventEmitter<Address | null>();
  query = "";
  selected: Address | null = null;
  busy = false;
  choosing = false;
  error = "";
  suggestions: { id: string; label: string }[] = [];
  /** Option highlighted by the arrow keys; none until the user moves to one. */
  active = -1;
  private generation = 0;
  private currentDraft = "";
  private timer?: ReturnType<typeof setTimeout>;
  private resetPending() {
    clearTimeout(this.timer);
    this.generation++;
    this.suggestions = [];
    this.active = -1;
    this.error = "";
    this.busy = false;
    this.choosing = false;
  }
  search(value: string) {
    if (this.disabled) return;
    this.query = value;
    this.selected = null;
    this.suggestions = [];
    this.active = -1;
    this.error = "";
    this.choosing = false;
    const address: Address = {provider:"manual", label:value, countryIso:"BY", settlement:"", street:"", house:"", confirmed:false};
    this.selected = address;
    this.addressChange.emit(address);
    clearTimeout(this.timer);
    const generation = ++this.generation;
    this.busy = false;
    if (value.trim().length < 3) return;
    this.timer = setTimeout(() => void this.load(value, generation), 400);
  }
  suggestCurrent() {
    if (this.disabled || this.selected?.confirmed || this.query.trim().length < 3 || this.suggestions.length || this.busy) return;
    clearTimeout(this.timer);
    void this.load(this.query, ++this.generation);
  }
  async load(query: string, generation: number) {
    this.busy = true;
    try {
      const result = await rentalApi<{
        suggestions: { id: string; label: string }[];
      }>(this.workspaceId, "address/suggest", { query });
      if (generation !== this.generation) return;
      this.suggestions = result.suggestions;
      this.active = -1;
      if (!result.suggestions.length)
        this.error =
          "Адрес не найден. Уточните запрос или заполните адрес вручную.";
    } catch (e) {
      if (generation === this.generation) this.error = (e as Error).message;
    } finally {
      if (generation === this.generation) this.busy = false;
    }
  }
  optionId(index: number) { return "rental-address-option-" + index; }
  pick(index: number) {
    const item = this.suggestions[index];
    if (item && !this.choosing) void this.choose(item.id);
  }
  keys(event: KeyboardEvent) {
    const count = this.suggestions.length;
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && count) {
      event.preventDefault();
      this.active = event.key === "ArrowDown"
        ? (this.active + 1) % count
        : this.active <= 0 ? count - 1 : this.active - 1;
    } else if (event.key === "Enter" && this.active >= 0 && this.active < count) {
      event.preventDefault();
      this.pick(this.active);
    } else if (event.key === "Escape" && (count || this.busy) && !this.choosing) {
      event.preventDefault();
      this.resetPending();
    }
  }
  async choose(id: string) {
    if (this.disabled) return;
    const generation = ++this.generation;
    clearTimeout(this.timer);
    this.choosing = true;
    this.error = "";
    try {
      const { address } = await rentalApi<{ address: Address }>(
        this.workspaceId,
        "address/select",
        { id },
      );
      if (generation !== this.generation) return;
      this.selected = address;
      this.query = address.label;
      this.suggestions = [];
      this.active = -1;
      this.addressChange.emit(address);
    } catch (e) {
      if (generation === this.generation) this.error = (e as Error).message;
    } finally {
      if (generation === this.generation) this.choosing = false;
    }
  }
  ngOnDestroy() {
    clearTimeout(this.timer);
    this.generation++;
  }
}
