(function () {
  'use strict';
  const core = globalThis.AutopostCore;
  if (window !== window.top || !core.isAppOrigin(location.origin)) return;
  const origin = location.origin;
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
    if (!['PING', 'RUN', 'RUN_QUEUE','OPEN_JOB','PAUSE','RESUME','STATUS', 'CLEAR'].includes(type) || typeof requestId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,120}$/u.test(requestId)) return;
    recentRequests = new Map([...recentRequests].filter(([, time]) => Date.now() - time < 60000));
    if (recentRequests.has(requestId) || recentRequests.size > 80) return;
    recentRequests.set(requestId, Date.now());
    // Acknowledge the page bridge separately from the worker response. This lets
    // the site distinguish a missing content script from a worker startup error.
    window.postMessage({ source: 'autopost-extension', type: 'ACK', requestId, payload: { version: core.VERSION } }, origin);
    const userGesture = gestureId > consumedGestureId && Boolean(navigator.userActivation?.isActive || Date.now() - lastGesture < 2000);
    const mutation=['RUN','RUN_QUEUE','OPEN_JOB','PAUSE','RESUME'].includes(type);
    if (mutation && (!userGesture || running)) {
      respond(requestId, { error: running ? 'Предыдущий запуск ещё выполняется.' : 'Запустите передачу кнопкой на странице.', code: 'USER_GESTURE_REQUIRED' });
      return;
    }
    try {
      let payload=event.data.payload;
      if (type === 'RUN') {
        const validated = core.validateRun(event.data.payload);
        payload = { ...validated, platforms: validated.platforms.map(({ id }) => ({ id })) };
        running = true;
        consumedGestureId = gestureId;
      }
      if(type==='RUN_QUEUE'){
        if(!Array.isArray(payload?.items)||payload.items.length>20)throw new Error('До 20 карточек за запуск.');
        payload={profileId:payload.profileId,items:payload.items.map(item=>core.validateRun(item))};
        running=true;consumedGestureId=gestureId;
      }
      if (type === 'STATUS' && event.data.payload?.batchId !== undefined) {
        const batchId = event.data.payload.batchId;
        if (typeof batchId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,120}$/u.test(batchId)) throw new Error('Неверный идентификатор пакета.');
        payload = { batchId,profileId:payload?.profileId };
      }
      const result = await chrome.runtime.sendMessage({ kind: 'APP_REQUEST', type, payload, userGesture });
      respond(requestId, result || { error: 'Расширение не ответило. Обновите страницу.', code: 'EXTENSION_UNAVAILABLE' });
    } catch (error) {
      const detail = String(error?.message || error || '');
      const connectionError = /context invalidated|receiving end does not exist|could not establish connection|message (port|channel) closed/i.test(detail);
      respond(requestId, {
        error: connectionError
          ? 'Обновите вкладку Автопоста после перезагрузки расширения. Если ошибка повторится, откройте «Ошибки» у расширения в браузере.'
          : detail || 'Не удалось связаться с расширением.',
        code: connectionError ? 'EXTENSION_RELOAD_REQUIRED' : 'REQUEST_FAILED',
      });
    } finally { if (type === 'RUN'||type==='RUN_QUEUE') running = false; }
  });
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id || message?.kind !== 'APP_PROGRESS' || message.origin !== origin) return;
    window.postMessage({ source: 'autopost-extension', type: 'PROGRESS', payload: { batchId: message.batchId,recordId:message.recordId,profileId:message.profileId,jobs: message.jobs } }, origin);
  });
  window.postMessage({ source: 'autopost-extension', type: 'READY', payload: { version: core.VERSION } }, origin);
})();
