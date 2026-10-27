"use strict";
importScripts("core.js", "photo-store.js", "prices.js", "publication.js", "status.js");
const core = globalThis.AutopostCore;
const publication = globalThis.AutopostPublication;
const photoStore = globalThis.AutopostPhotos;
const STORAGE_KEY = "autopostSessionV1";
const PHOTO_PREFIX = "autopostPhotos:";
const RECEIPT_PREFIX = "autopostReceipt:";
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
  state.pendingOpens = (state.pendingOpens || []).filter(item => item.expiresAt > Date.now());
  state.checks ||= [];
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
async function receipts(origin, profileId) {
  const result = [];
  for (const key of (await photoStore.keys()).filter(key=>key.startsWith(RECEIPT_PREFIX))) {
    const value = await photoStore.get(key);
    if (!value || value.expiresAt <= Date.now()) { await photoStore.remove(key); continue; }
    if (value.origin === origin && value.profileId === profileId) result.push(value);
  }
  return result;
}
async function remember(value) {
  const receipt = {...value,receiptId:crypto.randomUUID(),expiresAt:Date.now()+7*86400000};
  await photoStore.set(RECEIPT_PREFIX+receipt.receiptId,receipt);
  return receipt;
}
async function sendReceipt(receipt, sourceTabIds) {
  for (const id of sourceTabIds) {
    try {
      if (core.originOf((await chrome.tabs.get(id)).url) === receipt.origin)
        await send(id,{...receipt,kind:receipt.kind === "status" ? "APP_REMOTE_STATUS" : "APP_PROGRESS"});
    } catch {}
  }
}
async function finishCheck(state, check, result) {
  const remoteStatus = {state:result.state,message:String(result.message||globalThis.AutopostStatus.labels[result.state]).slice(0,500),checkedAt:new Date().toISOString()};
  const receipt = await remember({kind:"status",origin:check.origin,profileId:check.profileId,recordId:check.recordId,platformId:check.platformId,url:check.originalUrl||check.url,remoteStatus});
  state.checks = state.checks.filter(c=>c.id!==check.id);
  await save(state);
  await sendReceipt(receipt,check.sourceTabIds);
  if (Number.isInteger(check.tabId)) {
    try {
      const tab = await chrome.tabs.get(check.tabId);
      // A user who has focused a checking tab keeps it. Never close unrelated tabs.
      if (!tab.active && core.platformForOrigin(core.originOf(tab.url))?.id === check.canonicalId)
        await chrome.tabs.remove(check.tabId);
    } catch {}
  }
}
async function advanceChecks(state) {
  let active = state.checks.filter(c=>Number.isInteger(c.tabId)).length;
  for (const check of [...state.checks]) {
    if (Number.isInteger(check.tabId)) continue;
    if (!publication.listingUrl(check.canonicalId,check.url)) {
      await finishCheck(state,check,{state:"unknown",message:"Автоматическая проверка этой площадки или формата ссылки пока не поддерживается. Откройте объявление по ссылке."});
      continue;
    }
    if (active >= 3) continue;
    try {
      check.tabId = (await chrome.tabs.create({url:check.url,active:false})).id;
      check.deadline = Date.now()+25000;
      active++;
    } catch { await finishCheck(state,check,{state:"unknown",message:"Не удалось открыть площадку для проверки."}); }
  }
  await save(state);
  if (state.checks.length) void chrome.alarms.create("autopost-status-timeout",{when:Date.now()+26000});
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
      const existing = await chrome.tabs.get(job.tabId);
      if (core.platformForOrigin(core.originOf(existing.url))?.id !== job.canonicalId)
        throw new Error("The assigned tab has navigated away.");
      await chrome.tabs.update(job.tabId, { active: true });
      if (Number.isInteger(existing.windowId) && chrome.windows?.update)
        await chrome.windows.update(existing.windowId,{focused:true}).catch(()=>undefined);
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
function newJob(p) {
  return {id: crypto.randomUUID(), platformId: p.id, canonicalId: p.canonicalId,
    status: "queued", message: "В очереди. Следующая карточка откроется после завершения предыдущей на этой площадке.",
    tabId: null, filledFields: 0, filledKeys: [], skippedFields: [], photosTransferred: 0, photosAttempted: false};
}
async function makeBatch(v, origin, sourceTabId) {
  const {photos, ...metadata} = v;
  const photoKey = PHOTO_PREFIX + crypto.randomUUID();
  await photoStore.set(photoKey, photos);
  return {...metadata, photoKey, photoCharacters: photos.reduce((n,p) => n+p.dataUrl.length,0),
    photoCount: photos.length, origin, sourceTabIds: [sourceTabId], createdAt: Date.now(),
    expiresAt: Date.now()+core.TTL_MS, paused: false, jobs: v.platforms.map(newJob)};
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
        "server-recipes",
        "auto-links",
        "status-checks",
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
      receipts: await receipts(origin,profileId),
      pendingChecks: state.checks.filter(c=>c.origin===origin && c.profileId===profileId).length,
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
  if (message.type === "ACK_RECEIPT") {
    const id = message.payload?.receiptId;
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) throw new Error("Некорректная квитанция.");
    const value = await photoStore.get(RECEIPT_PREFIX+id);
    if (value?.origin === origin && value.profileId === profileId) await photoStore.remove(RECEIPT_PREFIX+id);
    return {ok:true};
  }
  if (message.type === "CLEAR") {
    state.pendingOpens = state.pendingOpens.filter(item => item.origin !== origin || item.profileId !== profileId);
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
  if (message.type === "RESTORE_JOB") {
    // One-use continuation of OPEN_JOB, bound to the original click, profile and tab.
    const pending = state.pendingOpens.find(item => item.token === message.payload?.resumeToken &&
      item.origin === origin && item.profileId === profileId && item.sourceTabId === sender.tab.id);
    if (!pending) throw new Error("Нажмите на статус площадки ещё раз: время открытия истекло.");
    const value = core.validateRun(message.payload.item);
    if (value.profileId !== profileId || value.batchId !== pending.batchId || value.recordId !== pending.recordId ||
        value.platforms.length !== 1 || value.platforms[0].id !== pending.platformId)
      throw new Error("Восстанавливаемое задание не совпадает с выбранным.");
    let restored = own.find(b => b.batchId === value.batchId);
    if (restored && restored.recordId !== value.recordId) throw new Error("Карточка задания изменилась.");
    if (!restored) {
      if (state.batches.length >= 30 || state.batches.reduce((n,b)=>n+(b.photoCharacters||0),0) +
          value.photos.reduce((n,p)=>n+p.dataUrl.length,0) > MAX_QUEUE_BYTES*4/3)
        throw new Error("Завершите или очистите предыдущую очередь перед восстановлением.");
      restored = await makeBatch(value, origin, sender.tab.id);
      state.batches.push(restored);
    }
    let job = restored.jobs.find(j => j.platformId === pending.platformId);
    if (!job) {
      if (restored.jobs.every(j=>terminal(j.status))) {
        if (state.batches.reduce((n,b)=>n+(b.photoCharacters||0),0)+value.photos.reduce((n,p)=>n+p.dataUrl.length,0)>MAX_QUEUE_BYTES*4/3)
          throw new Error("Фото очереди превышают доступный объём.");
        await photoStore.set(restored.photoKey,value.photos);
        restored.photoCount=value.photos.length;restored.photoCharacters=value.photos.reduce((n,p)=>n+p.dataUrl.length,0);
      }
      if (value.recipe) restored.recipe={...value.recipe,mappings:{...restored.recipe?.mappings,...value.recipe.mappings},
        entries:[...(restored.recipe?.entries||[]).filter(e=>e.platform!==value.platforms[0].canonicalId),...value.recipe.entries]};
      restored.attributes={...restored.attributes,...value.attributes};
      job = newJob(value.platforms[0]); restored.jobs.push(job);
    }
    state.pendingOpens = state.pendingOpens.filter(item => item !== pending);
    if (!restored.sourceTabIds.includes(sender.tab.id)) restored.sourceTabIds.push(sender.tab.id);
    await save(state);
    await openJob(job, restored, true);
    await save(state);
    await broadcast(restored);
    return {jobs: restored.jobs.map(core.publicJob)};
  }
  if (message.userGesture !== true)
    throw new Error("Запустите действие кнопкой в Автопосте.");
  if (message.type === "CHECK_STATUS") {
    const items = message.payload?.items;
    if (!Array.isArray(items) || !items.length || items.length > 3500) throw new Error("Выберите объявления с сохранёнными ссылками.");
    const checked = items.map(item=>{
      const canonicalId = core.platformId(item?.platformId);
      const url = canonicalId && core.safeLink(canonicalId,item.url);
      if (!url || url.length > 1500 || typeof item.recordId !== "string" || !/^[a-zA-Z0-9_.:-]{1,80}$/.test(item.recordId))
        throw new Error("Некорректная ссылка или карточка для проверки.");
      return {...item,originalUrl:url,url:publication.listingUrl(canonicalId,url)||url,canonicalId,title:String(item.title||'').slice(0,160)};
    });
    for (const item of checked) {
      const existing = state.checks.find(c=>c.origin===origin && c.profileId===profileId && c.recordId===item.recordId && c.platformId===item.platformId && c.url===item.url);
      if (existing) { if(!existing.sourceTabIds.includes(sender.tab.id))existing.sourceTabIds.push(sender.tab.id); continue; }
      state.checks.push({id:crypto.randomUUID(),origin,profileId,sourceTabIds:[sender.tab.id],recordId:item.recordId,platformId:item.platformId,canonicalId:item.canonicalId,url:item.url,originalUrl:item.originalUrl,title:item.title,tabId:null});
    }
    await save(state);
    await advanceChecks(state);
    return {pendingChecks:state.checks.filter(c=>c.origin===origin && c.profileId===profileId).length};
  }
  if (message.type === "OPEN_JOB") {
    if (batch && message.payload.recordId && batch.recordId !== message.payload.recordId)
      throw new Error("Карточка задания не совпадает.");
    const job = batch?.jobs.find(
      (j) => j.platformId === message.payload.platformId,
    );
    if (!job) {
      const p = message.payload;
      if (![p.batchId,p.recordId,p.platformId].every(value => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,120}$/.test(value)))
        throw new Error("Нет данных для восстановления задания.");
      const token = crypto.randomUUID();
      state.pendingOpens = state.pendingOpens.filter(item => item.sourceTabId !== sender.tab.id);
      state.pendingOpens.push({token,origin,profileId,sourceTabId:sender.tab.id,batchId:p.batchId,
        recordId:p.recordId,platformId:p.platformId,expiresAt:Date.now()+60000});
      await save(state);
      return {resumeToken:token};
    }
    if (!batch.sourceTabIds.includes(sender.tab.id)) batch.sourceTabIds.push(sender.tab.id);
    if (terminal(job.status) && job.url) {
      await chrome.tabs.create({ url: job.url, active: true });
      return { jobs: batch.jobs.map(core.publicJob) };
    }
    await openJob(job, batch, true);
    await save(state);
    await broadcast(batch);
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
  const added = [];
  for (const v of incoming) {
    added.push(await makeBatch(v, origin, sender.tab.id));
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
  if (["GET_STATUS_TASK","REPORT_STATUS"].includes(message.kind)) {
    const check = state.checks.find(c=>c.tabId===sender.tab.id && core.platformForOrigin(core.originOf(sender.url))?.id===c.canonicalId);
    if (!check) return {task:null};
    if (message.kind === "GET_STATUS_TASK") return {task:{id:check.id,url:check.url,title:check.title,canonicalId:check.canonicalId}};
    if (message.checkId !== check.id || !core.object(message.result) || !Object.hasOwn(globalThis.AutopostStatus.labels,message.result.state))
      throw new Error("Некорректный результат проверки.");
    if (message.result.state !== "action_required" && publication.listingUrl(check.canonicalId,sender.url) !== check.url)
      message.result = {state:"unknown",message:"Площадка перенаправила на другую страницу. Статус объявления не подтверждён."};
    await finishCheck(state,check,message.result);
    await advanceChecks(state);
    return {ok:true};
  }
  const found = taskFor(state, sender);
  if (!found) return { task: null };
  const { batch, job } = found;
  if (message.kind === "GET_TASK") {
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
        mapping: batch.recipe?.mappings[job.canonicalId],
        attributes: batch.recipe?.entries || [],
        paused: batch.paused,
        submission: job.submission || null,
        complete: terminal(job.status),
      },
    };
  }
  if (["ARM_SUBMISSION","RESET_SUBMISSION"].includes(message.kind)) {
    if (message.jobId !== job.id || terminal(job.status)) return {task:null};
    if (message.kind === "RESET_SUBMISSION") {
      job.submission = null;
    } else {
      if (batch.paused || message.userGesture !== true || !publication.postingUrl(job.canonicalId,sender.url))
        throw new Error("Отслеживание начинается после отправки формы пользователем.");
      if (!publication.fresh(job.submission) || Date.now()-job.submission.at > 1500) {
        const title = typeof message.title === "string" ? message.title.trim().slice(0,160) : batch.listing.title;
        job.submission = {id:crypto.randomUUID(),at:Date.now(),title,
          existing:Array.isArray(message.existing) ? [...new Set(message.existing.map(url=>publication.listingUrl(job.canonicalId,url)).filter(Boolean))].slice(0,100) : []};
      }
      job.status = "review_required";
      job.message = "Ожидаем результат подачи на площадке. Ссылка сохранится после распознавания готового объявления.";
    }
    await save(state);
    await broadcast(batch);
    return {ok:true,submission:job.submission};
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
    const captured = publication.validateCapture(job.canonicalId,job.submission,r.capture,sender.url);
    if (!url || (r.userConfirmed !== true && (!captured || captured !== url)))
      throw new Error("Укажите ссылку этой площадки и подтвердите её.");
    job.url = url;
    if (r.userConfirmed !== true) r.message = "Ссылка сохранена автоматически после подачи. Модерация и текущий статус площадки ещё не проверены.";
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
  if (job.status === "link_recorded") {
    const receipt = await remember({kind:"publication",origin:batch.origin,profileId:batch.profileId,recordId:batch.recordId,batchId:batch.batchId,jobs:[core.publicJob(job)]});
    await sendReceipt(receipt,batch.sourceTabIds);
  }
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
    !["APP_REQUEST", "GET_TASK", "REPORT_TASK", "ARM_SUBMISSION", "RESET_SUBMISSION", "GET_STATUS_TASK", "REPORT_STATUS"].includes(message.kind)
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
    const check = state.checks.find(c=>c.tabId===id);
    if (check) {
      await finishCheck(state,check,{state:"unknown",message:"Вкладка закрыта до окончания проверки."});
      await advanceChecks(state);
    }
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
  await photoStore.remove(keys.filter((key) => key.startsWith(PHOTO_PREFIX) && !live.has(key)));
  await receipts(null,null); // Expire unacknowledged results after seven days, independently of photo/session TTL.
  // Updating/reloading clears storage.session. Retire only our old photo keys;
  // new photos never enter storage.local, even without setAccessLevel support.
  const legacy = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(legacy).filter(key => key.startsWith(PHOTO_PREFIX)));
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "autopost-status-timeout") void serialized(async()=>{
    const state = await load();
    for (const check of [...state.checks]) if(check.deadline && check.deadline <= Date.now())
      await finishCheck(state,check,{state:"unknown",message:"Площадка не ответила вовремя. Статус не подтверждён."});
    await advanceChecks(state);
  }).catch(()=>undefined);
  if (alarm.name === "autopost-cleanup")
    void serialized(cleanPhotos).catch(() => undefined);
});
void chrome.alarms.create("autopost-cleanup", { periodInMinutes: 5 });
void serialized(cleanPhotos).catch(() => undefined);
