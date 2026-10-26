'use strict';
importScripts('core.js');
const core = globalThis.AutopostCore;
const STORAGE_KEY = 'autopostSessionV1';
let queue = Promise.resolve();
function serialized(work) {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}
function safeTabMessage(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message, { frameId: 0 }).catch(() => undefined);
}
async function save(state) { await chrome.storage.session.set({ [STORAGE_KEY]: state }); }
async function load() {
  const stored = (await chrome.storage.session.get(STORAGE_KEY))[STORAGE_KEY];
  const state = stored?.version === 1 && Array.isArray(stored.batches) ? stored : { version: 1, batches: [] };
  const expired = state.batches.filter((batch) => batch.expiresAt <= Date.now());
  if (expired.length) {
    state.batches = state.batches.filter((batch) => batch.expiresAt > Date.now());
    await save(state);
    for (const batch of expired) {
      for (const job of batch.jobs) if (Number.isInteger(job.tabId)) await safeTabMessage(job.tabId, { kind: 'TASK_CLEARED', reason: 'expired' });
    }
  }
  return state;
}
async function broadcast(batch) {
  const alive = [];
  for (const tabId of batch.sourceTabIds) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (core.originOf(tab.url) !== batch.origin) continue;
      alive.push(tabId);
      await safeTabMessage(tabId, { kind: 'APP_PROGRESS', origin: batch.origin, batchId: batch.batchId, jobs: batch.jobs.map(core.publicJob) });
    } catch { /* The originating tab may have been closed. */ }
  }
  batch.sourceTabIds = alive;
}
function authorizedSender(sender) {
  return sender.id === chrome.runtime.id && sender.frameId === 0 && Number.isInteger(sender.tab?.id);
}
function findTask(state, sender) {
  const platform = core.platformForOrigin(core.originOf(sender.url));
  if (!platform) return null;
  for (const batch of state.batches) {
    const job = batch.jobs.find((item) => item.tabId === sender.tab.id && item.canonicalId === platform.id);
    if (job) return { batch, job };
  }
  return null;
}
async function clearBatch(batch, reason = 'cleared') {
  for (const job of batch.jobs) if (Number.isInteger(job.tabId)) await safeTabMessage(job.tabId, { kind: 'TASK_CLEARED', reason });
}
async function appRequest(message, sender) {
  const origin = core.originOf(sender.url);
  if (!core.isAppOrigin(origin)) throw new Error('Источник запроса не разрешён.');
  if (message.type === 'PING') return { version: core.VERSION };
  if (!['RUN', 'STATUS', 'CLEAR'].includes(message.type)) throw new Error('Неизвестный запрос.');
  const state = await load();
  const existing = state.batches.find((batch) => batch.origin === origin);
  if (message.type === 'STATUS') {
    if (existing && !existing.sourceTabIds.includes(sender.tab.id)) {
      existing.sourceTabIds.push(sender.tab.id);
      await save(state);
    }
    const requestedBatchId = message.payload?.batchId;
    const matches = requestedBatchId === undefined || requestedBatchId === existing?.batchId;
    return { batchId: existing?.batchId ?? null, jobs: existing && matches ? existing.jobs.map(core.publicJob) : [] };
  }
  if (message.type === 'CLEAR') {
    state.batches = state.batches.filter((batch) => batch.origin !== origin);
    await save(state);
    if (existing) {
      await clearBatch(existing);
      existing.jobs = [];
      await broadcast(existing);
    }
    return { jobs: [] };
  }
  if (message.userGesture !== true) throw new Error('Передачу необходимо запускать кнопкой на странице.');
  const validated = core.validateRun(message.payload);
  if (existing?.batchId === validated.batchId) {
    if (!existing.sourceTabIds.includes(sender.tab.id)) existing.sourceTabIds.push(sender.tab.id);
    await save(state);
    return { batchId: existing.batchId, jobs: existing.jobs.map(core.publicJob) };
  }
  const others = state.batches.filter((batch) => batch.origin !== origin);
  const photoCharacters = [...others.flatMap((batch) => batch.photos), ...validated.photos].reduce((sum, photo) => sum + photo.dataUrl.length, 0);
  if (photoCharacters > Math.ceil(core.MAX_TOTAL_PHOTO_BYTES / 3) * 4 + 1024) throw new Error('В расширении уже есть фото другого запуска. Очистите предыдущий пакет либо уменьшите размер фото.');
  const now = Date.now();
  const batch = {
    batchId: validated.batchId, origin, sourceTabIds: [sender.tab.id],
    createdAt: now, expiresAt: now + core.TTL_MS,
    listing: validated.listing, photos: validated.photos,
    jobs: validated.platforms.map((platform) => ({
      id: crypto.randomUUID(), platformId: platform.id, canonicalId: platform.canonicalId,
      status: 'manual_required', message: 'Откройте на площадке форму подачи объявления. Заполнение — экспериментальное.',
      tabId: null, filledFields: 0, filledKeys: [], skippedFields: [], photosTransferred: 0, photosAttempted: false,
    })),
  };
  // Persist before opening tabs. If the session quota is exceeded no site is opened.
  state.batches = [...others, batch];
  await save(state);
  if (existing) await clearBatch(existing, 'replaced');
  for (let index = 0; index < batch.jobs.length; index += 1) {
    const job = batch.jobs[index];
    try {
      const tab = await chrome.tabs.create({ url: core.PLATFORMS[job.canonicalId].url, active: index === 0 });
      job.tabId = tab.id;
    } catch {
      job.status = 'error';
      job.message = 'Не удалось открыть площадку. Повторите запуск с новым пакетом.';
    }
  }
  await save(state);
  await broadcast(batch);
  return { batchId: batch.batchId, jobs: batch.jobs.map(core.publicJob) };
}
async function marketplaceRequest(message, sender) {
  const state = await load();
  const task = findTask(state, sender);
  if (!task) return { task: null };
  const { batch, job } = task;
  if (message.kind === 'GET_TASK') {
    return {
      task: {
        jobId: job.id, platformId: job.platformId, name: core.PLATFORMS[job.canonicalId].name,
        listing: batch.listing, photos: batch.photos, expiresAt: batch.expiresAt,
        filledKeys: job.filledKeys, photosAttempted: job.photosAttempted, photosTransferred: job.photosTransferred,
      },
    };
  }
  const report = message.report;
  if (!core.object(report) || report.jobId !== job.id || !core.STATUSES.includes(report.status)) throw new Error('Некорректный отчёт заполнения.');
  const validKeys = (value) => Array.isArray(value) ? value.filter((key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(core.FIELD_LIMITS, key)).slice(0, 18) : [];
  job.filledKeys = [...new Set([...job.filledKeys, ...validKeys(report.filledKeys)])];
  job.filledFields = job.filledKeys.length;
  job.skippedFields = validKeys(report.skippedFields);
  job.photosAttempted = job.photosAttempted || report.photosAttempted === true;
  if (Number.isInteger(report.photosTransferred)) job.photosTransferred = Math.max(job.photosTransferred, Math.min(batch.photos.length, Math.max(0, report.photosTransferred)));
  job.status = report.status;
  job.message = {
    authorization_required: 'Войдите в аккаунт площадки, откройте форму объявления и повторите заполнение.',
    captcha_required: 'Площадка показывает капчу. Пройдите её самостоятельно, затем повторите заполнение.',
    review_required: `Перенесено полей: ${job.filledFields}. Проверьте все данные, фото и опубликуйте объявление вручную.`,
    manual_required: 'Откройте форму объявления и выберите категорию. Нераспознанные поля заполните вручную.',
    error: 'Автозаполнение прервалось. Скопируйте текст из панели и проверьте форму вручную.',
  }[job.status];
  await save(state);
  await broadcast(batch);
  return { ok: true };
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!authorizedSender(sender) || !core.object(message)) return false;
  if (!['APP_REQUEST', 'GET_TASK', 'REPORT_TASK'].includes(message.kind)) return false;
  serialized(async () => {
    if (message.kind === 'APP_REQUEST') return appRequest(message, sender);
    if (!core.platformForOrigin(core.originOf(sender.url))) throw new Error('Площадка не разрешена.');
    return marketplaceRequest(message, sender);
  }).then(sendResponse, () => sendResponse({ error: 'Не удалось обработать запрос. Проверьте данные, размер фото и перезагрузите расширение.', code: 'EXTENSION_REQUEST_FAILED' }));
  return true;
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void serialized(async () => {
    const state = await load();
    for (const batch of state.batches) {
      batch.sourceTabIds = batch.sourceTabIds.filter((id) => id !== tabId);
      const job = batch.jobs.find((item) => item.tabId === tabId);
      if (job) {
        job.tabId = null;
        job.status = 'manual_required';
        job.message = 'Вкладка площадки закрыта. Публикация не подтверждена.';
        await broadcast(batch);
      }
    }
    await save(state);
  }).catch(() => undefined);
});
// Only the service worker can read session storage. Content scripts receive their own task.
void chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => undefined);
