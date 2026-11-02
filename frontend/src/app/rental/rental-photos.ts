import { optimizePhoto, type Photo } from "../../../../lib/workspace";

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("autopost-rental-photos", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("cards");
    request.onerror = () =>
      reject(new Error("Не удалось открыть хранилище фотографий."));
    request.onsuccess = () => resolve(request.result);
  });
}
export async function rentalPhotos(
  workspace: string,
  id: string,
  value?: Photo[],
): Promise<Photo[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(
        "cards",
        value === undefined ? "readonly" : "readwrite",
      );
      const store = tx.objectStore("cards"),
        key = workspace + ":" + id;
      const request =
        value === undefined ? store.get(key) : store.put(value, key);
      tx.oncomplete = () =>
        resolve(value === undefined ? request.result || [] : value);
      tx.onerror = () =>
        reject(new Error("Не удалось сохранить фотографии в браузере."));
    });
  } finally {
    db.close();
  }
}
export async function addRentalPhotos(
  current: Photo[],
  files: File[],
): Promise<Photo[]> {
  if (current.length + files.length > 12)
    throw new Error("Можно передать до 12 фотографий за один запуск.");
  const added = [];
  for (const file of files) added.push(await optimizePhoto(file));
  return [...current, ...added];
}
