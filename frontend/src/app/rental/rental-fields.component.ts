import { Component, Input, Output, EventEmitter } from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { Field, FieldState, JsonValue } from "./rental-api";

@Component({
  selector: "app-rental-fields",
  standalone: true,
  imports: [FormsModule],
  templateUrl: "./rental-fields.component.html",
  styleUrl: "./rental-fields.component.css",
})
export class RentalFieldsComponent {
  @Input() fields: Field[] = [];
  @Input() values: Record<string, JsonValue> = {};
  /** What the server says of each shown field: its options among others. */
  @Input() states = new Map<string, FieldState>();
  @Input() labels: Record<string, string> = {};
  @Input() evidence: Record<string, string> = {};
  /** Ids of fields no selected platform receives yet. */
  @Input() untransferred: string[] = [];
  @Input() disabled = false;
  @Output() edit = new EventEmitter<{field: Field; value: JsonValue}>();
  /** The label with the unit the card model gives the field. */
  name(field: Field) {
    return field.unit ? field.name + ", " + field.unit : field.name;
  }
  label(value: string) { return this.labels[value] || value; }
  choices(field: Field) { return this.states.get(field.id)?.choices || []; }
  value(field: Field) {
    const value = this.values[field.id];
    return Array.isArray(value) ? value.join("\n") : String(value ?? "");
  }
  set(field: Field, value: JsonValue) {
    if (this.disabled) return;
    if (field.type === "files" && typeof value === "string") value = value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    this.edit.emit({field, value});
  }
  checked(field: Field, value: string) { return Array.isArray(this.values[field.id]) && (this.values[field.id] as JsonValue[]).includes(value); }
  toggle(field: Field, value: string, checked: boolean) {
    const old = Array.isArray(this.values[field.id]) ? this.values[field.id] as string[] : [];
    this.set(field, checked ? [...new Set([...old, value])] : old.filter(v => v !== value));
  }
}
