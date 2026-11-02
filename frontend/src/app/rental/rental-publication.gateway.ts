import { Injectable } from "@angular/core";
import { extension, type Photo } from "../../../../lib/workspace";
import { addRentalPhotos, rentalPhotos } from "./rental-photos";

/** Boundary to the browser extension and local binary storage. */
@Injectable({ providedIn: "root" })
export class RentalPublicationGateway {
  request(type: string, payload?: unknown, timeout?: number) {
    return extension(type, payload, timeout);
  }
  photos(workspace: string, id: string, value?: Photo[]) {
    return rentalPhotos(workspace, id, value);
  }
  add(current: Photo[], files: File[]) {
    return addRentalPhotos(current, files);
  }
}
