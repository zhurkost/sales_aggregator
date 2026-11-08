/* Shared validation. No network requests or page-provided code. */
(function (root) {
  'use strict';
  const VERSION = '0.9.23';
  const APP_ORIGINS = Object.freeze([
    'https://autopost-belarus-mvp.sunlit-lemur-2753.chatgpt.site',
    'https://87.199.205.227',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]);
  function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function originOf(url) { try { return new URL(url).origin; } catch { return ''; } }
  function isAppOrigin(origin) { return APP_ORIGINS.includes(origin); }
  // A tab assignment is not permission to fill every future document in that tab.
  function fillNavigation() {
    const entry = root.performance?.getEntriesByType?.('navigation')?.[0];
    const legacy = root.performance?.navigation?.type;
    return { type: entry?.type || (legacy === 1 ? 'reload' : legacy === 2 ? 'back_forward' : 'navigate'),
      referrer: root.document?.referrer || '' };
  }
  function armFill(job) {
    job.fillPending = true;
    job.fillBlocked = false;
    job.fillDocumentId = null;
  }
  function canFill(job, sender) {
    return typeof sender.documentId === 'string' && job.fillDocumentId === sender.documentId && !job.fillBlocked;
  }
  function claimFill(job, sender, navigation, allowedOrigins) {
    if (canFill(job, sender) && navigation?.type !== 'reload' && navigation?.type !== 'back_forward') return true;
    // A late poll from the previous document must not revoke the new document.
    if (!navigation || typeof sender.documentId !== 'string') return false;
    // Reload/history never consume an outstanding launch as permission to fill.
    // After a denied navigation only another app action may start the helper.
    const allowed = typeof sender.documentId === 'string' && navigation?.type === 'navigate' &&
      (job.fillPending || (!job.fillBlocked && job.fillDocumentId &&
        allowedOrigins.includes(originOf(navigation.referrer))));
    job.fillPending = false;
    job.fillBlocked = !allowed;
    job.fillDocumentId = sender.documentId || null;
    return !!allowed;
  }
  const core = { VERSION, APP_ORIGINS, object, originOf, isAppOrigin, fillNavigation, armFill, canFill, claimFill };
  root.AutopostCore = Object.freeze(core);
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
})(globalThis);
