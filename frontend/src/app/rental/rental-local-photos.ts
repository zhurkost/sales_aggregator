/*
 * Before photos were stored on the server, the editor kept them in the IndexedDB of the browser it
 * ran in, by cabinet and card. Nothing writes them any more; a deleted card takes its copy along.
 */
const KEY = (workspace: string, id: string) => workspace + ":" + id;

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("autopost-rental-photos", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("cards");
    request.onerror = () =>
      reject(new Error("Не удалось открыть фотографии этого браузера."));
    request.onsuccess = () => resolve(request.result);
  });
}
async function cards<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("cards", mode),
        request = work(tx.objectStore("cards"));
      tx.oncomplete = () => resolve(request.result as T);
      tx.onerror = () =>
        reject(new Error("Не удалось прочитать фотографии этого браузера."));
    });
  } finally {
    db.close();
  }
}
export function forgetLocalRentalPhotos(workspace: string, id: string) {
  return cards<undefined>("readwrite", (store) =>
    store.delete(KEY(workspace, id)),
  );
}
