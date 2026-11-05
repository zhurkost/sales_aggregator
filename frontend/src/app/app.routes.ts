import { inject } from "@angular/core";
import type { Routes } from "@angular/router";
import { RentalPageComponent } from "./rental/rental-page.component";
import { RentalSession } from "./rental/rental-session";

/** The rental editor is its own route; the other sections of the cabinet are not routed yet. */
export const RENTAL_PATH = "/rental";

export const routes: Routes = [
  {
    path: RENTAL_PATH.slice(1),
    component: RentalPageComponent,
    // Leaving saves what is typed; a card that cannot be saved (a conflict) keeps the route.
    canDeactivate: [() => inject(RentalSession).flush().then(() => true, () => false)],
  },
  { path: "**", children: [] },
];
