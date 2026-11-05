import { Injectable } from "@angular/core";
import { extension, type Photo } from "../../../../lib/workspace";
import { addRentalPhotos } from "./rental-photos";

/** Boundary to the browser extension and image processing. */
@Injectable({ providedIn: "root" })
export class RentalPublicationGateway {
  request(type: string, payload?: unknown, timeout?: number) {
    return extension(type, payload, timeout);
  }
  add(current: Photo[], files: File[]) {
    return addRentalPhotos(current, files);
  }
}
