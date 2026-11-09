(function (root) {
  function read() {
    if (location.hostname !== "r.onliner.by") return null;
    const requestId = crypto.randomUUID();
    let state = null;
    const receive = event => {
      try {
        const result = JSON.parse(event.detail);
        if (result.requestId === requestId && Array.isArray(result.state?.items) && Array.isArray(result.state?.queue))
          state = result.state;
      } catch { /* Ignore unrelated page events. */ }
    };
    document.addEventListener("autopost:photo-state-response", receive);
    try {
      document.dispatchEvent(new CustomEvent("autopost:photo-state-request", {detail: requestId}));
    } finally { document.removeEventListener("autopost:photo-state-response", receive); }
    return state;
  }
  function start() {
    const state = read();
    return state && {before: new Set([...state.items, ...state.queue].map(p => p.key)), received: new Map()};
  }
  function accepted(tracker, expected) {
    const state = read();
    if (!state) return null;
    for (const p of [...state.items, ...state.queue])
      if (!tracker.before.has(p.key) && p.hash) tracker.received.set(p.key, p.hash);
    if (tracker.received.size !== expected) return null;
    const hashes = new Set(tracker.received.values());
    const sources = [];
    for (const hash of hashes) {
      const processed = state.items.find(p => p.hash === hash && p.status === "processed");
      if (!processed || !processed.preview.startsWith("https://content.onliner.by/apartments_photo/")) return null;
      sources.push(processed.preview);
    }
    return sources;
  }
  root.AutopostOnlinerPhotos = {start, accepted};
})(globalThis);
