import { Component, Input, Output, EventEmitter } from "@angular/core";
import type { Address, JsonValue, RentalAiResult } from "./rental-models";
import type { RentalViewModel } from "./rental-view.model";
@Component({
  selector: "app-rental-ai-review", standalone: true,
  templateUrl: "./rental-ai-review.component.html", styleUrl: "./rental-ai-review.component.css",
})
export class RentalAiReviewComponent {
  @Input() aiQuestions: string[] = [];
  @Input() aiConflicts: RentalAiResult["suggestions"] = [];
  @Input() aiAddress: Address | null = null;
  @Input() currentAddress: Address | null = null;
  @Input() values: Record<string, JsonValue> = {};
  @Input({required:true}) view!: RentalViewModel;
  @Output() applyAddress = new EventEmitter<void>();
  @Output() dismissAddress = new EventEmitter<void>();
  @Output() applyField = new EventEmitter<number>();
  @Output() dismissField = new EventEmitter<number>();
}
