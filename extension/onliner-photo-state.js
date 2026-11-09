// Read-only access to the uploader's acknowledgements. Runs in the page world:
// Onliner removes duplicate uploads before their thumbnails can be counted.
(() => {
  const keys = new WeakMap();
  let sequence = 0;
  document.addEventListener("autopost:photo-state-request", event => {
    const requestId = event.detail;
    if (typeof requestId !== "string" || requestId.length > 80) return;
    let state = null;
    try {
      const input = document.querySelector('input.new-photos__input-file[name="file"]');
      const ko = window.ko;
      const photos = input && ko?.contextFor(input)?.$root?.data?.photos;
      if (photos) {
        const row = item => {
          if (!keys.has(item)) keys.set(item, String(++sequence));
          return {key: keys.get(item), hash: String(ko.unwrap(item.hash) || ""),
            status: String(ko.unwrap(item.status) || ""), preview: String(ko.unwrap(item.preview) || "")};
        };
        state = {items: ko.unwrap(photos.items).map(row),
          queue: ko.unwrap(photos.uploadQueue).map(entry => row(entry.item))};
      }
    } catch { /* A site change leaves the normal DOM verification in charge. */ }
    document.dispatchEvent(new CustomEvent("autopost:photo-state-response", {
      detail: JSON.stringify({requestId, state}),
    }));
  });
})();
