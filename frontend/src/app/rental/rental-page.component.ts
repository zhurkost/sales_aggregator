import { Component, inject } from "@angular/core";
import { RentalEditorComponent } from "./rental-editor.component";
import { RentalSession } from "./rental-session";

/** The route /rental: the editor of the signed-in cabinet. */
@Component({
  selector: "app-rental-page",
  standalone: true,
  imports: [RentalEditorComponent],
  template: `@if (session.workspaceId(); as workspace) {
    <app-rental-editor [workspaceId]="workspace" [profileDefaults]="session.profile()" />
  }`,
})
export class RentalPageComponent {
  readonly session = inject(RentalSession);
}
