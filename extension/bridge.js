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
      return !listenerFailed && api?.id && typeof api.sendMessage === 'function' ? api : null;
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
  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== origin || !core.object(event.data) || event.data.source !== 'autopost-app') return;
    const { type, requestId } = event.data;
    if (!['RENTAL_RUN','RENTAL_STATUS','RENTAL_OPEN','RENTAL_STOP','PING'].includes(type) || typeof requestId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,120}$/u.test(requestId)) return;
    recentRequests = new Map([...recentRequests].filter(([, time]) => Date.now() - time < 60000));
    if (recentRequests.has(requestId) || recentRequests.size > 80) return;
    recentRequests.set(requestId, Date.now());
    // Acknowledge the page bridge separately from the worker response. This lets
    // the site distinguish a missing content script from a worker startup error.
    window.postMessage({ source: 'autopost-extension', type: 'ACK', requestId, payload: { version: core.VERSION } }, origin);
    const userGesture = gestureId > consumedGestureId && Boolean(navigator.userActivation?.isActive || Date.now() - lastGesture < 2000);
    const mutation=['RENTAL_RUN','RENTAL_OPEN','RENTAL_STOP'].includes(type);
    if (mutation && (!userGesture || running)) {
      respond(requestId, { error: running ? 'Предыдущий запуск ещё выполняется.' : 'Запустите передачу кнопкой на странице.', code: 'USER_GESTURE_REQUIRED' });
      return;
    }
    try {
      // Check before reserving a launch on the server. An orphaned bridge must
      // never consume the one-shot launch reservation or transfer card data.
      requireRuntime();
      let payload=event.data.payload;
      if (type.startsWith('RENTAL_')) {
        if (mutation) { consumedGestureId=gestureId; running=true; }
        if (type==='RENTAL_RUN') {
          const config=await rentalConfig(payload,true);
          payload={...config,profileId:payload.profileId,draft:payload.draft,mode:payload.mode,photos:payload.photos||[]};
        }
        const result=await requireRuntime().sendMessage({kind:'RENTAL_REQUEST',type,payload,userGesture});
        respond(requestId,result||{error:'Расширение не ответило.'});return;
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
    } finally { if (type.startsWith('RENTAL_')) running = false; }
  });
  async function rentalConfig(payload, wait=false) {
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),16000);
    try {
      for(let attempt=0;attempt<30;attempt++) {
        const response=await fetch('/api/workspace/rental/extension-config',{
          method:'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,
          headers:{'Content-Type':'application/json','X-Autopost-Workspace':payload.profileId},
          body:JSON.stringify({id:payload.id,draft:payload.draft}),
        });
        const data=await response.json();
        if(response.ok)return data;
        if(wait&&[404,409].includes(response.status)&&attempt<29){await new Promise(resolve=>setTimeout(resolve,300));continue;}
        throw new Error(data.error||'Не удалось получить правила аренды.');
      }
    } finally {clearTimeout(timer);}
  }
  try {
    requireRuntime();
    window.postMessage({ source: 'autopost-extension', type: 'READY', payload: { version: core.VERSION } }, origin);
  } catch {
    listenerFailed = true;
    // Keep the page listener alive so PING gets recovery instructions instead
    // of an uncaught startup exception or an unexplained timeout.
  }
})();
