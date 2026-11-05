import { Injectable } from "@angular/core";
import { rentalApi } from "./rental-api";
import type { Address } from "./rental-models";

@Injectable({ providedIn: "root" })
export class RentalAddressGateway {
  suggest(workspace: string, query: string) {
    return rentalApi<{ suggestions: { id: string; label: string }[] }>(workspace, "address/suggest", { query });
  }
  select(workspace: string, id: string) {
    return rentalApi<{ address: Address }>(workspace, "address/select", { id });
  }
}
