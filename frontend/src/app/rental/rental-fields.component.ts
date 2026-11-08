import { Component, Input, Output, EventEmitter } from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { Field, JsonValue } from "./rental-models";

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
  @Input() choices: Record<string, string[]> = {};
  @Input() labels: Record<string, string> = {};
  @Input() evidence: Record<string, string> = {};
  @Input() disabled = false;
  @Output() edit = new EventEmitter<{field: Field; value: JsonValue}>();
  name(field: Field) {
    if (field.id === "media.images" && field.type === "files") return "Ссылки на фотографии";
    // Legacy apartment labels omit units; other categories supply their own labels and units.
    return /^(rental|apartment)\.[a-z_]*area$/.test(field.id) && !field.name.includes("м²") ? field.name + ", м²" : field.name;
  }
  label(value: string) { return this.labels[value] || value; }
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
