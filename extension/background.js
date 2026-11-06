"use strict";
importScripts("core.js", "photo-store.js", "rental-core.js", "rental-background.js");
const core = globalThis.AutopostCore;
let queue = Promise.resolve();
function serialized(work) {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 ||
      !Number.isInteger(sender.tab?.id) || !core.object(message)) return false;
  if (message.kind === "APP_REQUEST" && message.type === "PING") {
    if (!core.isAppOrigin(core.originOf(sender.url || sender.tab.url))) return false;
    // Health checks must not wait for photo storage or cleanup.
    respond({version: core.VERSION, capabilities: ["rental-publishing", "rental-address-suggestions", "rental-form-session", "rental-field-transfer-v2", "rental-address-type-then-first", "rental-onliner-city-menu"]});
    return true;
  }
  if (!["RENTAL_REQUEST", "RENTAL_PAGE"].includes(message.kind)) return false;
  serialized(() => globalThis.AutopostRentalBackground.handle(message, sender))
    .then(respond, error => respond({
      error: error.message || "Расширение не ответило.",
      code: "EXTENSION_REQUEST_FAILED",
    }));
  return true;
});
async function cleanPhotos() {
  const live = new Set(await globalThis.AutopostRentalBackground.photoKeys());
  const keys = await globalThis.AutopostPhotos.keys();
  await globalThis.AutopostPhotos.remove(keys.filter(key =>
    key.startsWith("rental:") && !live.has(key)));
}
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "autopost-cleanup") void serialized(cleanPhotos).catch(() => undefined);
});
void chrome.alarms.create("autopost-cleanup", {periodInMinutes: 5});
void serialized(cleanPhotos).catch(() => undefined);
