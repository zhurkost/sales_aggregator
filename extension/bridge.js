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
    if (!['PING', 'RUN', 'STATUS', 'CLEAR'].includes(type) || typeof requestId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,120}$/u.test(requestId)) return;
    recentRequests = new Map([...recentRequests].filter(([, time]) => Date.now() - time < 60000));
    if (recentRequests.has(requestId) || recentRequests.size > 80) return;
    recentRequests.set(requestId, Date.now());
    const userGesture = gestureId > consumedGestureId && Boolean(navigator.userActivation?.isActive || Date.now() - lastGesture < 2000);
    if (type === 'RUN' && (!userGesture || running)) {
      respond(requestId, { error: running ? 'Предыдущий запуск ещё выполняется.' : 'Запустите передачу кнопкой на странице.', code: 'USER_GESTURE_REQUIRED' });
      return;
    }
    try {
      let payload;
      if (type === 'RUN') {
        const validated = core.validateRun(event.data.payload);
        payload = { ...validated, platforms: validated.platforms.map(({ id }) => ({ id })) };
        running = true;
        consumedGestureId = gestureId;
      }
      if (type === 'STATUS' && event.data.payload?.batchId !== undefined) {
        const batchId = event.data.payload.batchId;
        if (typeof batchId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,120}$/u.test(batchId)) throw new Error('Неверный идентификатор пакета.');
        payload = { batchId };
      }
      const result = await chrome.runtime.sendMessage({ kind: 'APP_REQUEST', type, payload, userGesture });
      respond(requestId, result || { error: 'Расширение не ответило. Обновите страницу.', code: 'EXTENSION_UNAVAILABLE' });
    } catch (error) {
      respond(requestId, { error: error instanceof Error ? error.message : 'Не удалось связаться с расширением.', code: 'REQUEST_FAILED' });
    } finally { if (type === 'RUN') running = false; }
  });
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id || message?.kind !== 'APP_PROGRESS' || message.origin !== origin) return;
    window.postMessage({ source: 'autopost-extension', type: 'PROGRESS', payload: { batchId: message.batchId, jobs: message.jobs } }, origin);
  });
})();
