"use strict";
importScripts("core.js", "taxonomy.js", "attributes.js", "photo-store.js", "prices.js");
const core = globalThis.AutopostCore;
const photoStore = globalThis.AutopostPhotos;
const STORAGE_KEY = "autopostSessionV1";
const PHOTO_PREFIX = "autopostPhotos:";
const MAX_QUEUE_BYTES = 64 * 1024 * 1024;
let queue = Promise.resolve();
let priceSearchRunning = false;
let lastPriceSearch = 0;
const priceCache = new Map();
function serialized(work) {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}
const send = (id, message) =>
  chrome.tabs.sendMessage(id, message, { frameId: 0 }).catch(() => undefined);
const save = (state) => chrome.storage.session.set({ [STORAGE_KEY]: state });
const terminal = (s) => ["link_recorded", "cancelled", "submitted"].includes(s);
async function load() {
  const raw = (await chrome.storage.session.get(STORAGE_KEY))[STORAGE_KEY];
  const state =
    raw?.version === 2 && Array.isArray(raw.batches)
      ? raw
      : { version: 2, batches: [] };
  const expired = state.batches.filter((b) => b.expiresAt <= Date.now());
  if (expired.length) {
    state.batches = state.batches.filter((b) => b.expiresAt > Date.now());
    await save(state);
    await photoStore.remove(
      expired.map((b) => b.photoKey).filter(Boolean),
    );
    for (const b of expired)
      for (const j of b.jobs)
        if (Number.isInteger(j.tabId))
          await send(j.tabId, { kind: "TASK_CLEARED", reason: "expired" });
  }
  return state;
}
async function broadcast(batch) {
  for (const id of batch.sourceTabIds)
    try {
      const t = await chrome.tabs.get(id);
      if (core.originOf(t.url) === batch.origin)
        await send(id, {
          kind: "APP_PROGRESS",
          origin: batch.origin,
          batchId: batch.batchId,
          profileId: batch.profileId,
          recordId: batch.recordId,
          jobs: batch.jobs.map(core.publicJob),
        });
    } catch {}
}
function taskFor(state, sender) {
  const p = core.platformForOrigin(core.originOf(sender.url));
  if (!p) return null;
  for (const b of state.batches) {
    const j = b.jobs.find(
      (j) => j.tabId === sender.tab.id && j.canonicalId === p.id,
    );
    if (j) return { batch: b, job: j };
  }
  return null;
}
async function openJob(job, batch, active = false) {
  if (Number.isInteger(job.tabId))
    try {
      await chrome.tabs.update(job.tabId, { active: true });
      return;
    } catch {
      job.tabId = null;
    }
  try {
    const tab = await chrome.tabs.create({
      url: core.startUrl(job.canonicalId, batch.listing),
      active,
    });
    job.tabId = tab.id;
    job.status = "opening";
    job.message = "Открываем форму. Вход выполняется в вашей сессии браузера.";
  } catch {
    job.status = "error";
    job.message = "Не удалось открыть вкладку. Нажмите «Открыть с помощником».";
  }
}
async function advance(state) {
  const occupied = new Set(
    state.batches.flatMap((b) =>
      b.jobs
        .filter((j) => Number.isInteger(j.tabId) && !terminal(j.status))
        .map((j) => j.canonicalId),
    ),
  );
  for (const b of state.batches) {
    if (b.paused) continue;
    for (const j of b.jobs) {
      if (j.status !== "queued" || occupied.has(j.canonicalId)) continue;
      occupied.add(j.canonicalId);
      await openJob(j, b);
      await broadcast(b);
    }
  }
  await save(state);
}
async function appRequest(message, sender) {
  const origin = core.originOf(sender.url);
  if (!core.isAppOrigin(origin)) throw new Error("Источник не разрешён.");
  if (message.type === "PING")
    return {
      version: core.VERSION,
      capabilities: [
        "all-platforms",
        "category-routing",
        "queue",
        "profiles",
        "open-job",
        "price-search",
      ],
    };
  if (message.type === "PRICE_SEARCH") {
    if (!message.userGesture) throw new Error("Запустите поиск цен кнопкой на странице.");
    const criteria = globalThis.AutopostPrices.validate(message.payload);
    const key = origin + JSON.stringify(criteria);
    const cached = priceCache.get(key);
    if (cached && Date.now() - cached.time < 5 * 60 * 1000) return {...cached.value,cached:true};
    if (priceSearchRunning || Date.now() - lastPriceSearch < 10000) throw new Error("Подождите завершения поиска или повторите через 10 секунд.");
    priceSearchRunning = true; lastPriceSearch = Date.now();
    try {
      const result = await globalThis.AutopostPrices.search(criteria);
      if (result.results.some(item=>item.status==='ok')) {
        if (priceCache.size >= 5) priceCache.delete(priceCache.keys().next().value);
        priceCache.set(key,{time:Date.now(),value:result});
      }
      return result;
    } finally { priceSearchRunning = false; }
  }
  const state = await load();
  const profileId =
    typeof message.payload?.profileId === "string"
      ? message.payload.profileId
      : "legacy";
  const own = state.batches.filter(
    (b) => b.origin === origin && b.profileId === profileId,
  );
  const batch =
    own.find((b) => b.batchId === message.payload?.batchId) ||
    (!message.payload?.batchId ? own.at(-1) : null);
  if (message.type === "STATUS") {
    for (const b of own)
      if (!b.sourceTabIds.includes(sender.tab.id))
        b.sourceTabIds.push(sender.tab.id);
    await save(state);
    return {
      batchId: batch?.batchId || null,
      jobs: batch?.jobs.map(core.publicJob) || [],
      batches: own.map((b) => ({
        batchId: b.batchId,
        recordId: b.recordId,
        paused: b.paused,
        jobs: b.jobs.map(core.publicJob),
      })),
    };
  }
  if (message.type === "CLEAR") {
    state.batches = state.batches.filter((b) => !own.includes(b));
    await save(state);
    await photoStore.remove(
      own.map((b) => b.photoKey).filter(Boolean),
    );
    for (const b of own)
      for (const j of b.jobs)
        if (Number.isInteger(j.tabId))
          await send(j.tabId, { kind: "TASK_CLEARED", reason: "cleared" });
    return { jobs: [] };
  }
  if (message.userGesture !== true)
    throw new Error("Запустите действие кнопкой в Автопосте.");
  if (message.type === "OPEN_JOB") {
    if (!batch)
      throw new Error(
        "Сеанс расширения истёк. Откройте карточку и запустите размещение заново.",
      );
    const job = batch.jobs.find(
      (j) => j.platformId === message.payload.platformId,
    );
    if (!job) throw new Error("Задание не найдено.");
    if (terminal(job.status) && job.url) {
      await chrome.tabs.create({ url: job.url, active: true });
      return { jobs: batch.jobs.map(core.publicJob) };
    }
    await openJob(job, batch, true);
    await save(state);
    return { jobs: batch.jobs.map(core.publicJob) };
  }
  if (["PAUSE", "RESUME"].includes(message.type)) {
    for (const b of own) b.paused = message.type === "PAUSE";
    if (message.type === "RESUME") await advance(state);
    else await save(state);
    return { ok: true };
  }
  if (!["RUN", "RUN_QUEUE"].includes(message.type))
    throw new Error("Неизвестный запрос.");
  const items =
    message.type === "RUN_QUEUE" ? message.payload?.items : [message.payload];
  if (!Array.isArray(items) || !items.length || items.length > 20)
    throw new Error("В очереди можно запускать от 1 до 20 карточек за раз.");
  const validated = items.map(core.validateRun);
  if (new Set(validated.map((b) => b.batchId)).size !== validated.length)
    throw new Error("Повторный пакет в очереди.");
  if (validated.some((b) => b.profileId !== profileId))
    throw new Error("Профиль очереди не совпадает.");
  const incoming = validated.filter(
    (v) =>
      !state.batches.some(
        (b) =>
          b.origin === origin &&
          b.profileId === profileId &&
          b.batchId === v.batchId,
      ),
  );
  if (state.batches.length + incoming.length > 30)
    throw new Error("Завершите или очистите предыдущую очередь.");
  // Enforce the shared storage quota before opening a single tab.
  const photoCharacters =
    state.batches.reduce((n, b) => n + (b.photoCharacters || 0), 0) +
    incoming.flatMap((b) => b.photos).reduce((n, p) => n + p.dataUrl.length, 0);
  if (photoCharacters > (MAX_QUEUE_BYTES * 4) / 3)
    throw new Error(
      "Фото очереди превышают 64 МиБ. Завершите предыдущие задания или уменьшите пакет.",
    );
  const now = Date.now();
  const added = [];
  for (const v of incoming) {
    const { photos, ...metadata } = v;
    const photoKey = PHOTO_PREFIX + crypto.randomUUID();
    await photoStore.set(photoKey, photos);
    added.push({
      ...metadata,
      photoKey,
      photoCharacters: photos.reduce((n, p) => n + p.dataUrl.length, 0),
      photoCount: photos.length,
      origin,
      sourceTabIds: [sender.tab.id],
      createdAt: now,
      expiresAt: now + core.TTL_MS,
      paused: false,
      jobs: v.platforms.map((p) => ({
        id: crypto.randomUUID(),
        platformId: p.id,
        canonicalId: p.canonicalId,
        status: "queued",
        message:
          "В очереди. Следующая карточка откроется после завершения предыдущей на этой площадке.",
        tabId: null,
        filledFields: 0,
        filledKeys: [],
        skippedFields: [],
        photosTransferred: 0,
        photosAttempted: false,
      })),
    });
  }
  state.batches.push(...added);
  await save(state);
  // A single listing opens every selected site. Bulk runs keep one active job per site.
  if (message.type === "RUN")
    for (const b of added)
      for (let i = 0; i < b.jobs.length; i++)
        await openJob(b.jobs[i], b, i === 0);
  else await advance(state);
  await save(state);
  for (const b of added) await broadcast(b);
  const first = state.batches.find(
    (b) =>
      b.origin === origin &&
      b.profileId === profileId &&
      b.batchId === validated[0].batchId,
  );
  return {
    batchId: first.batchId,
    jobs: first.jobs.map(core.publicJob),
    batches: state.batches
      .filter((b) => b.origin === origin && b.profileId === profileId)
      .map((b) => ({
        batchId: b.batchId,
        recordId: b.recordId,
        jobs: b.jobs.map(core.publicJob),
      })),
  };
}
async function marketplaceRequest(message, sender) {
  const state = await load();
  const found = taskFor(state, sender);
  if (!found) return { task: null };
  const { batch, job } = found;
  if (message.kind === "GET_TASK") {
    const node = globalThis.AutopostTaxonomy?.[batch.listing.taxonomyId];
    const photos = batch.photoKey
      ? (await photoStore.get(batch.photoKey)) || []
      : [];
    return {
      task: {
        jobId: job.id,
        platformId: job.platformId,
        canonicalId: job.canonicalId,
        name: core.PLATFORMS[job.canonicalId].name,
        listing: batch.listing,
        photos,
        expiresAt: batch.expiresAt,
        filledKeys: job.filledKeys,
        photosAttempted: job.photosAttempted,
        photosTransferred: job.photosTransferred,
        mapping: globalThis.AutopostCategoryOptions?.[job.canonicalId]?.[batch.categoryOverrides?.[job.canonicalId]] || node?.mappings?.[job.canonicalId],
        attributes: globalThis.AutopostAttributes.attributeEntries(globalThis.AutopostFields, globalThis.AutopostCategoryOptions?.kufar?.[batch.categoryOverrides?.kufar] || node?.mappings?.kufar,batch.attributes,batch.listing),
        paused: batch.paused,
        complete: terminal(job.status),
      },
    };
  }
  const r = message.report;
  if (
    !core.object(r) ||
    r.jobId !== job.id ||
    !core.STATUSES.includes(r.status)
  )
    throw new Error("Некорректный отчёт.");
  if (terminal(job.status)) return { ok: true };
  const attributeKeys = new Set(Object.keys(batch.attributes || {}).map(key=>'attribute:'+key));
  const keys = (v) =>
    Array.isArray(v)
      ? v.filter((k) => Object.hasOwn(core.FIELD_LIMITS, k) || attributeKeys.has(k)).slice(0, 100)
      : [];
  job.filledKeys = [...new Set([...job.filledKeys, ...keys(r.filledKeys)])];
  job.filledFields = job.filledKeys.length;
  job.skippedFields = keys(r.skippedFields);
  job.photosAttempted = job.photosAttempted || r.photosAttempted === true;
  if (Number.isInteger(r.photosTransferred))
    job.photosTransferred = Math.max(
      job.photosTransferred,
      Math.min(batch.photoCount || 0, Math.max(0, r.photosTransferred)),
    );
  if (r.status === "link_recorded") {
    const url = core.safeLink(job.canonicalId, r.url);
    if (!url || r.userConfirmed !== true)
      throw new Error("Укажите ссылку этой площадки и подтвердите её.");
    job.url = url;
  }
  job.status = r.status;
  job.message =
    typeof r.message === "string"
      ? r.message.slice(0, 500)
      : r.status === "review_required"
        ? "Проверьте поля и фото перед публикацией."
        : r.status === "link_recorded"
          ? "Ссылка сохранена пользователем. Модерация и текущий статус требуют проверки."
          : "Ожидается действие на площадке.";
  if (batch.jobs.every((j) => terminal(j.status))) {
    if (batch.photoKey) await photoStore.remove(batch.photoKey);
    batch.photoCharacters = 0;
  }
  await save(state);
  await broadcast(batch);
  if (terminal(job.status)) await advance(state);
  return { ok: true };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.frameId !== 0 ||
    !Number.isInteger(sender.tab?.id) ||
    !core.object(message) ||
    !["APP_REQUEST", "GET_TASK", "REPORT_TASK"].includes(message.kind)
  )
    return false;
  const work = () =>
    message.kind === "APP_REQUEST"
      ? appRequest(message, sender)
      : marketplaceRequest(message, sender);
  // A health check must not wait behind photo writes or queue cleanup.
  const result = message.kind === "APP_REQUEST" && ["PING","PRICE_SEARCH"].includes(message.type)
    ? work() : serialized(work);
  result.then(respond, (e) =>
    respond({
      error: e.message || "Расширение не ответило.",
      code: "EXTENSION_REQUEST_FAILED",
    }),
  );
  return true;
});
chrome.tabs.onRemoved.addListener((id) => {
  void serialized(async () => {
    const state = await load();
    for (const b of state.batches) {
      b.sourceTabIds = b.sourceTabIds.filter((i) => i !== id);
      const j = b.jobs.find((j) => j.tabId === id);
      if (j) {
        j.tabId = null;
        if (!terminal(j.status)) {
          j.status = "manual_required";
          j.message = "Вкладка закрыта. Возобновите задание в личном кабинете.";
        }
        await broadcast(b);
      }
    }
    await save(state);
  }).catch(() => undefined);
});
// storage.session is restricted to trusted extension contexts by default.
// Do not call setAccessLevel: some Chromium versions expose it only on session,
// and calling a missing local method prevents the entire worker from registering.
// Session metadata disappears when the browser closes; orphaned photos are removed on restart.
async function cleanPhotos() {
  const state = await load();
  const live = new Set(state.batches.map((b) => b.photoKey));
  const keys = await photoStore.keys();
  await photoStore.remove(keys.filter((key) => !live.has(key)));
  // Updating/reloading clears storage.session. Retire only our old photo keys;
  // new photos never enter storage.local, even without setAccessLevel support.
  const legacy = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(legacy).filter(key => key.startsWith(PHOTO_PREFIX)));
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "autopost-cleanup")
    void serialized(cleanPhotos).catch(() => undefined);
});
void chrome.alarms.create("autopost-cleanup", { periodInMinutes: 5 });
void serialized(cleanPhotos).catch(() => undefined);
