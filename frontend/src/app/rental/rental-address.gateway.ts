import { Injectable } from "@angular/core";
import { rentalApi } from "./rental-api";
import type { Address } from "./rental-models";

@Injectable({ providedIn: "root" })
export class RentalAddressGateway {
  suggest(workspace: string, category: string, query: string) {
    return rentalApi<{ suggestions: { id: string; label: string }[] }>(workspace, category, "address/suggest", { query });
  }
  select(workspace: string, category: string, id: string) {
    return rentalApi<{ address: Address }>(workspace, category, "address/select", { id });
  }
}
