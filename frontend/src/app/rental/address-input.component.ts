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
    <label class="full-label"
      >Адрес квартиры
      <input
        aria-label="Поиск адреса квартиры"
        [ngModel]="query"
        (ngModelChange)="search($event)"
        autocomplete="off"
        maxlength="300"
        placeholder="Населённый пункт, улица, дом"
      />
    </label>
    @if (busy) {
      <p role="status">Ищем адрес…</p>
    }
    @if (error) {
      <p role="status">{{ error }}</p>
    }
    @if (suggestions.length) {
      <ul class="address-options" aria-label="Варианты адреса">
        @for (item of suggestions; track item.id) {
          <li>
            <button
              type="button"
              (click)="choose(item.id)"
              [disabled]="choosing"
            >
              {{ item.label }}
            </button>
          </li>
        }
      </ul>
    }
    @if (selected) {
      <p class="address-confirmation">
        Выбран: <strong>{{ selected.label }}</strong>
      </p>
      @if (selected.level !== "house") {
        <p>Дом пока не найден. Уточните номер дома в полях ниже.</p>
      }
    }
    <p class="fine-print">
      Подсказки DaData · данные OpenStreetMap. Выберите подходящий адрес. Если
      его нет, заполните адресные поля ниже вручную. Площадки сверят адрес со
      своими справочниками.
    </p>
  `,
  styles: [
    `
      .address-options {
        list-style: none;
        padding: 0;
        border: 1px solid #d9dfeb;
        border-radius: 12px;
        overflow: hidden;
      }
      .address-options button {
        width: 100%;
        text-align: left;
        border: 0;
        border-radius: 0;
        padding: 12px;
        background: white;
      }
      .address-options button:hover {
        background: #edf2ff;
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
  @Input() set draftId(id: string) {
    if (id === this.currentDraft) return;
    this.currentDraft = id;
    this.resetPending();
    this.selected = null;
    this.query = "";
  }
  @Input() set value(value: Address | null) {
    // A search already cleared our selection before notifying the parent.
    if (value === this.selected) return;
    this.resetPending();
    this.selected = value;
    this.query = value?.label || "";
  }
  @Output() addressChange = new EventEmitter<Address | null>();
  query = "";
  selected: Address | null = null;
  busy = false;
  choosing = false;
  error = "";
  suggestions: { id: string; label: string }[] = [];
  private generation = 0;
  private currentDraft = "";
  private timer?: ReturnType<typeof setTimeout>;
  private resetPending() {
    clearTimeout(this.timer);
    this.generation++;
    this.suggestions = [];
    this.error = "";
    this.busy = false;
    this.choosing = false;
  }
  search(value: string) {
    this.query = value;
    this.selected = null;
    this.suggestions = [];
    this.error = "";
    this.choosing = false;
    this.addressChange.emit(null);
    clearTimeout(this.timer);
    const generation = ++this.generation;
    this.busy = false;
    if (value.trim().length < 3) return;
    this.timer = setTimeout(() => void this.load(value, generation), 400);
  }
  async load(query: string, generation: number) {
    this.busy = true;
    try {
      const result = await rentalApi<{
        suggestions: { id: string; label: string }[];
      }>(this.workspaceId, "address/suggest", { query });
      if (generation !== this.generation) return;
      this.suggestions = result.suggestions;
      if (!result.suggestions.length)
        this.error =
          "Адрес не найден. Уточните запрос или заполните адрес вручную.";
    } catch (e) {
      if (generation === this.generation) this.error = (e as Error).message;
    } finally {
      if (generation === this.generation) this.busy = false;
    }
  }
  async choose(id: string) {
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
