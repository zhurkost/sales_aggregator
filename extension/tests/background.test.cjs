'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Classic extension scripts are tested in CommonJS. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const core = require('../core.js');
const APP = core.APP_ORIGINS[0];
function createWorker() {
  const data = {};
  const created = [];
  const sent = [];
  const tabs = new Map([[1, { id: 1, url: `${APP}/` }], [2, { id: 2, url: 'http://localhost:5173/' }]]);
  let onMessage;
  const chrome = {
    runtime: { id: 'test-id', onMessage: { addListener(listener) { onMessage = listener; } } },
    storage: { session: {
      async get(key) { return structuredClone({ [key]: data[key] }); },
      async set(value) { Object.assign(data, structuredClone(value)); },
      async setAccessLevel() {},
    } },
    tabs: {
      async create(options) { const tab = { id: created.length + 10, ...options }; created.push(tab); tabs.set(tab.id, tab); return tab; },
      async get(id) { if (!tabs.has(id)) throw new Error('No tab'); return tabs.get(id); },
      async sendMessage(id, message) { sent.push({ id, message }); },
      onRemoved: { addListener() {} },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), { chrome, AutopostCore: core, importScripts() {}, crypto: { randomUUID }, URL, Date, console });
  function request(message, url = `${APP}/`, tabId = 1, frameId = 0) {
    return new Promise((resolve) => {
      const listening = onMessage(message, { id: 'test-id', frameId, url, tab: { id: tabId } }, resolve);
      if (!listening) resolve(undefined);
    });
  }
  return { data, created, sent, request };
}
function payload() { return { batchId: 'test-batch', listing: { title: 'Автомобиль', description: 'Тест', price: 100, currency: 'BYN' }, photos: [], platforms: [{ id: 'av', url: 'https://attacker.invalid' }, { id: 'kufar', url: 'javascript:alert(1)' }] }; }
function run(worker) { return worker.request({ kind: 'APP_REQUEST', type: 'RUN', userGesture: true, payload: payload() }); }

test('RUN opens only fixed origins and duplicate batch is idempotent', async () => {
  const worker = createWorker();
  const result = await run(worker);
  assert.equal(result.jobs.length, 2);
  assert.deepEqual(worker.created.map((tab) => tab.url), ['https://av.by/', 'https://www.kufar.by/']);
  assert.ok(result.jobs.every((job) => job.status === 'manual_required'));
  await run(worker);
  assert.equal(worker.created.length, 2);
});

test('batch IDs identify RUN and progress; STATUS excludes jobs from another batch', async () => {
  const worker = createWorker();
  assert.equal((await run(worker)).batchId, 'test-batch');
  assert.equal((await run(worker)).batchId, 'test-batch');
  const own = await worker.request({ kind: 'APP_REQUEST', type: 'STATUS', payload: { batchId: 'test-batch' } });
  assert.equal(own.batchId, 'test-batch');
  assert.equal(own.jobs.length, 2);
  const other = await worker.request({ kind: 'APP_REQUEST', type: 'STATUS', payload: { batchId: 'other-car' } });
  assert.equal(other.batchId, 'test-batch');
  assert.equal(other.jobs.length, 0);
  assert.equal(worker.sent.find((item) => item.message.kind === 'APP_PROGRESS').message.batchId, 'test-batch');
});

test('RUN without gesture and messages from an iframe are denied', async () => {
  const worker = createWorker();
  assert.ok((await worker.request({ kind: 'APP_REQUEST', type: 'RUN', payload: payload() })).error);
  assert.equal(await worker.request({ kind: 'APP_REQUEST', type: 'PING' }, `${APP}/`, 1, 1), undefined);
  assert.equal(worker.created.length, 0);
});

test('status and clear are isolated between allowed application origins', async () => {
  const worker = createWorker();
  await run(worker);
  const foreign = await worker.request({ kind: 'APP_REQUEST', type: 'STATUS' }, 'http://localhost:5173/', 2);
  assert.equal(foreign.jobs.length, 0);
  await worker.request({ kind: 'APP_REQUEST', type: 'CLEAR' }, 'http://localhost:5173/', 2);
  assert.equal((await worker.request({ kind: 'APP_REQUEST', type: 'STATUS' })).jobs.length, 2);
  assert.ok((await worker.request({ kind: 'APP_REQUEST', type: 'STATUS' }, 'https://evil.invalid/', 3)).error);
});

test('task data goes only to a job tab on its assigned platform', async () => {
  const worker = createWorker();
  await run(worker);
  assert.equal((await worker.request({ kind: 'GET_TASK' }, 'https://av.by/', 99)).task, null);
  assert.equal((await worker.request({ kind: 'GET_TASK' }, 'https://www.kufar.by/', 10)).task, null);
  assert.equal((await worker.request({ kind: 'GET_TASK' }, 'https://av.by/', 10)).task.listing.title, 'Автомобиль');
  assert.equal((await worker.request({ kind: 'GET_TASK' }, 'https://cars.av.by/', 10)).task.listing.title, 'Автомобиль');
  assert.equal((await worker.request({ kind: 'GET_TASK' }, 'https://auto.kufar.by/', 11)).task.listing.title, 'Автомобиль');
});

test('expired sessions are removed before returning data', async () => {
  const worker = createWorker();
  await run(worker);
  worker.data.autopostSessionV1.batches[0].expiresAt = Date.now() - 100;
  assert.equal((await worker.request({ kind: 'GET_TASK' }, 'https://av.by/', 10)).task, null);
  assert.equal(worker.data.autopostSessionV1.batches.length, 0);
  assert.ok(worker.sent.some((item) => item.message.kind === 'TASK_CLEARED' && item.message.reason === 'expired'));
});

test('reports cannot claim publication or report another task', async () => {
  const worker = createWorker();
  await run(worker);
  const { task } = await worker.request({ kind: 'GET_TASK' }, 'https://av.by/', 10);
  assert.ok((await worker.request({ kind: 'REPORT_TASK', report: { jobId: task.jobId, status: 'published' } }, 'https://av.by/', 10)).error);
  assert.ok((await worker.request({ kind: 'REPORT_TASK', report: { jobId: 'wrong', status: 'review_required' } }, 'https://av.by/', 10)).error);
  const valid = await worker.request({ kind: 'REPORT_TASK', report: { jobId: task.jobId, status: 'review_required', filledKeys: ['title', 'title', '__proto__'], photosTransferred: 1000 } }, 'https://av.by/', 10);
  assert.equal(valid.ok, true);
  const status = await worker.request({ kind: 'APP_REQUEST', type: 'STATUS' });
  assert.equal(status.jobs[0].filledFields, 1);
  assert.equal(status.jobs[0].photosTransferred, 0);
});
