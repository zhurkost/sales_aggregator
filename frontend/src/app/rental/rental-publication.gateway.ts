import { Injectable } from "@angular/core";
import { extension, optimizePhoto } from "../../../../lib/workspace";
import {
  forgetLocalRentalPhotos,
  localRentalPhotos,
} from "./rental-local-photos";

/** Boundary to the browser extension, image compression and photos left in this browser. */
@Injectable({ providedIn: "root" })
export class RentalPublicationGateway {
  request(type: string, payload?: unknown, timeout?: number) {
    return extension(type, payload, timeout);
  }
  /** JPEG of at most 1600 px, as a data URL the server accepts. */
  async compress(files: File[]) {
    const photos = [];
    for (const file of files) {
      const { name, dataUrl } = await optimizePhoto(file);
      photos.push({ name, dataUrl });
    }
    return photos;
  }
  localPhotos(workspace: string, id: string) {
    return localRentalPhotos(workspace, id);
  }
  forgetLocalPhotos(workspace: string, id: string) {
    return forgetLocalRentalPhotos(workspace, id);
  }
}
