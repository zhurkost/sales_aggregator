import { newRecord, type AdRecord } from "./workspace.ts";
import { sanitizeListing, type ProductGroup } from "./listing.ts";
import { getPlatforms } from "./platforms.ts";
/** Explicit, user-triggered migration; legacy local data is never erased. */
export async function legacyDrafts(): Promise<AdRecord[]> {
  const database = await new Promise<IDBDatabase | null>((resolve, reject) => {
    const req = indexedDB.open("autopost-v1", 1);
    req.onupgradeneeded = () => {
      req.transaction?.abort();
      resolve(null);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      req.error?.name === "AbortError" ? resolve(null) : reject(req.error);
  });
  if (!database) return [];
  try {
    const results: AdRecord[] = [];
    for (const category of ["cars", "parts"] as ProductGroup[]) {
      const raw = await new Promise<Record<string, unknown> | undefined>(
        (resolve, reject) => {
          const req = database
            .transaction("data")
            .objectStore("data")
            .get(category === "parts" ? "draft:parts" : "draft");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        },
      );
      if (!raw) continue;
      const listing = sanitizeListing(raw.listing, category);
      if (!listing.title && !listing.description && !raw.text) continue;
      listing.taxonomyId = category === "parts" ? "auto.parts" : "auto.cars";
      const record = newRecord(
        listing,
        typeof raw.text === "string" ? raw.text : listing.description,
      );
      record.id = "legacy-draft-" + category;
      record.externalId = record.id;
      record.prepared = raw.prepared === true;
      record.categoryConfirmed = true;
      record.photos = Array.isArray(raw.photos) ? raw.photos.slice(0, 12) : [];
      record.selected = Array.isArray(raw.selected)
        ? raw.selected.filter((id) =>
            getPlatforms(category).some((p) => p.id === id),
          )
        : [];
      results.push(record);
    }
    return results;
  } finally {
    database.close();
  }
}
