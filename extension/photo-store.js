/* Loaded only by the extension worker. Content scripts use the page's IndexedDB,
   so they cannot read this extension-origin database. No storage.local fallback. */
(function (root) {
  'use strict';
  let opening;
  function database() {
    if (!opening) {
      opening = new Promise((resolve, reject) => {
        const request = indexedDB.open('autopost-private-photos', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('photos');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => { db.close(); opening = undefined; };
          resolve(db);
        };
      }).catch(error => { opening = undefined; throw error; });
    }
    return opening;
  }
  async function transaction(mode, work) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('photos', mode);
      let result;
      tx.oncomplete = () => resolve(result?.result);
      tx.onabort = () => reject(tx.error || new Error('Не удалось сохранить фотографии в расширении.'));
      try { result = work(tx.objectStore('photos')); }
      catch (error) { tx.abort(); reject(error); }
    });
  }
  root.AutopostPhotos = Object.freeze({
    get(key) { return transaction('readonly', store => store.get(key)); },
    set(key, photos) { return transaction('readwrite', store => store.put(photos, key)); },
    keys() { return transaction('readonly', store => store.getAllKeys()); },
    remove(keys) {
      return transaction('readwrite', store => {
        for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
      });
    },
  });
})(globalThis);
