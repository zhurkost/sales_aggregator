(function () {
  'use strict';
  const core = globalThis.AutopostCore;
  if (window !== window.top || !core.isAppOrigin(location.origin)) return;
  const origin = location.origin;
  let listenerFailed = false;
  const reloadMessage = 'Обновите вкладку Автопоста: она потеряла связь с расширением. Если это не помогло, включите Автопост в списке расширений этого браузера, разрешите доступ к сайту и снова обновите вкладку.';
  function runtime() {
    // Reloading/disabling an unpacked extension can leave this content script
    // alive while chrome.runtime (or its id) has already disappeared.
    try {
      const api = globalThis.chrome?.runtime;
      return !listenerFailed && api?.id && typeof api.sendMessage === 'function' && typeof api.onMessage?.addListener === 'function' ? api : null;
    } catch { return null; }
  }
  function requireRuntime() {
    const api = runtime();
    if (!api) throw Object.assign(new Error(reloadMessage), { code: 'EXTENSION_RELOAD_REQUIRED' });
    return api;
  }
  let lastGesture = 0;
  let gestureId = 0;
  let consumedGestureId = 0;
  let running = false;
  let recentRequests = new Map();
  for (const type of ['pointerdown', 'keydown', 'click']) {
    window.addEventListener(type, (event) => { if (event.isTrusted) { lastGesture = Date.now(); gestureId += 1; } }, true);
  }
  function respond(requestId, payload) {
    window.postMessage({ source: 'autopost-extension', type: 'RESPONSE', requestId, payload }, origin);
  }
  async function recipes(items, profileId, reserve=false, verify=false) {
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(),15000);
    try {
      const options={
        method:'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,
        headers:{'Content-Type':'application/json'},
        // Photos and credentials are never sent to the catalog endpoint.
        body:JSON.stringify({profileId,reserve,verify,items:items.map(({listing,categoryOverrides,attributes,platforms,recordId,batchId,photoIds,platformText})=>({listing,categoryOverrides,attributes,platforms,recordId,batchId,photoIds,platformText}))}),
      };
      let response,data,body;
      for(let attempt=0;attempt<40;attempt++) {
        response=await fetch('/api/workspace/extension-config',options);
        body=await response.text();
        if(body.length>1024*1024)throw new Error('Ответ справочника слишком большой.');
        try{data=JSON.parse(body);}catch{throw new Error('Сервер справочников недоступен. Войдите в Автопост и повторите.');}
        if(response.status!==409 || data.code!=='WAIT_FOR_SAVE')break;
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить справочники.');
      if (!Array.isArray(data.recipes) || data.recipes.length !== items.length) throw new Error('Не получены категории карточек.');
      return items.map((item,i)=>({...item,recipe:core.validateRecipe(data.recipes[i])}));
    } finally { clearTimeout(timeout); }
  }
  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== origin || !core.object(event.data) || event.data.source !== 'autopost-app') return;
    const { type, requestId } = event.data;
    if (!['PING', 'PRICE_SEARCH', 'RUN', 'RUN_QUEUE','OPEN_JOB','RESTORE_JOB','CHECK_STATUS','ACK_RECEIPT','PAUSE','RESUME','SET_MODE','CANCEL_RECORD','STATUS', 'CLEAR'].includes(type) || typeof requestId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,120}$/u.test(requestId)) return;
    recentRequests = new Map([...recentRequests].filter(([, time]) => Date.now() - time < 60000));
    if (recentRequests.has(requestId) || recentRequests.size > 80) return;
    recentRequests.set(requestId, Date.now());
    // Acknowledge the page bridge separately from the worker response. This lets
    // the site distinguish a missing content script from a worker startup error.
    window.postMessage({ source: 'autopost-extension', type: 'ACK', requestId, payload: { version: core.VERSION } }, origin);
    const userGesture = gestureId > consumedGestureId && Boolean(navigator.userActivation?.isActive || Date.now() - lastGesture < 2000);
    const mutation=['RUN','RUN_QUEUE','OPEN_JOB','CHECK_STATUS','PAUSE','RESUME','SET_MODE','PRICE_SEARCH','CANCEL_RECORD'].includes(type);
    if (mutation && (!userGesture || running)) {
      respond(requestId, { error: running ? 'Предыдущий запуск ещё выполняется.' : 'Запустите передачу кнопкой на странице.', code: 'USER_GESTURE_REQUIRED' });
      return;
    }
    try {
      // Check before reserving a launch on the server. An orphaned bridge must
      // never consume the one-shot launch reservation or transfer card data.
      requireRuntime();
      let payload=event.data.payload;
      if (['SET_MODE','CANCEL_RECORD'].includes(type)) consumedGestureId=gestureId;
      if (['OPEN_JOB','CHECK_STATUS'].includes(type)) consumedGestureId = gestureId;
      if (type === 'PRICE_SEARCH') { consumedGestureId = gestureId; }
      if (type === 'RUN') {
        running = true; consumedGestureId = gestureId;
        const [enriched] = await recipes([event.data.payload],event.data.payload?.profileId,true);
        const validated = core.validateRun(enriched);
        payload = { ...validated, platforms: validated.platforms.map(({ id }) => ({ id })) };
        running = true;
        consumedGestureId = gestureId;
      }
      if(type==='RUN_QUEUE'){
        if(!Array.isArray(payload?.items)||payload.items.length>20)throw new Error('До 20 карточек за запуск.');
        running=true;consumedGestureId=gestureId;
        payload={profileId:payload.profileId,items:(await recipes(payload.items,payload.profileId,true)).map(item=>core.validateRun(item))};
      }
      if (type === 'RESTORE_JOB') {
        const [item] = await recipes([payload.item],payload.profileId);
        payload = {...payload,item:core.validateRun(item)};
      }
      if (type === 'PRICE_SEARCH') {
        const [item] = await recipes([{listing:{taxonomyId:payload.taxonomyId}}]);
        payload = {...payload,recipe:item.recipe};
      }
      if (type === 'STATUS' && event.data.payload?.batchId !== undefined) {
        const batchId = event.data.payload.batchId;
        if (typeof batchId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,120}$/u.test(batchId)) throw new Error('Неверный идентификатор пакета.');
        payload = { batchId,profileId:payload?.profileId };
      }
      const result = await requireRuntime().sendMessage({ kind: 'APP_REQUEST', type, payload, userGesture });
      respond(requestId, result || { error: 'Расширение не ответило. Обновите страницу.', code: 'EXTENSION_UNAVAILABLE' });
    } catch (error) {
      const detail = String(error?.message || error || '');
      const connectionError = !runtime() || error?.code === 'EXTENSION_RELOAD_REQUIRED' || /context invalidated|receiving end does not exist|could not establish connection|message (port|channel) closed/i.test(detail);
      respond(requestId, {
        error: connectionError
          ? reloadMessage
          : detail || 'Не удалось связаться с расширением.',
        code: connectionError ? 'EXTENSION_RELOAD_REQUIRED' : 'REQUEST_FAILED',
      });
    } finally { if (type === 'RUN'||type==='RUN_QUEUE') running = false; }
  });
  function fromExtension(message, sender, reply) {
    const api = runtime();
    if (!api || sender.id !== api.id) return;
    if(message?.kind==='VERIFY_SNAPSHOT' && message.origin===origin) {
      recipes([message.item],message.profileId,false,true).then(()=>reply({ok:true}),e=>reply({error:e.message||'Не удалось сверить карточку с кабинетом.'}));
      return true;
    }
    if (!['APP_PROGRESS','APP_REMOTE_STATUS'].includes(message?.kind) || message.origin !== origin) return;
    window.postMessage({ source: 'autopost-extension', type: message.kind==='APP_REMOTE_STATUS'?'REMOTE_STATUS':'PROGRESS', payload: { batchId: message.batchId,recordId:message.recordId,profileId:message.profileId,jobs: message.jobs,receiptId:message.receiptId,platformId:message.platformId,url:message.url,remoteStatus:message.remoteStatus } }, origin);
  }
  try {
    requireRuntime().onMessage.addListener(fromExtension);
    window.postMessage({ source: 'autopost-extension', type: 'READY', payload: { version: core.VERSION } }, origin);
  } catch {
    listenerFailed = true;
    // Keep the page listener alive so PING gets recovery instructions instead
    // of an uncaught startup exception or an unexplained timeout.
  }
})();
