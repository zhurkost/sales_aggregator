import { Injectable } from "@angular/core";
import { extension, optimizePhoto } from "../../../../lib/workspace";

/** Boundary to the browser extension and image compression. */
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
}
