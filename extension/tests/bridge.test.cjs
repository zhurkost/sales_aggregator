'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Classic extension scripts are tested in CommonJS. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../core.js');
function createBridge({ sendMessage, fetchCatalog, configureChrome } = {}) {
  const listeners = {};
  const responses = [];
  const handshakes = [];
  const forwarded = [];
  const catalogRequests = [];
  let fromExtension;
  const origin = core.APP_ORIGINS[0];
  const window = {
    addEventListener(type, callback) { (listeners[type] ||= []).push(callback); },
    postMessage(message, target) { (['ACK','READY'].includes(message.type) ? handshakes : responses).push({ message, target }); },
  };
  window.top = window;
  const chrome = { runtime: { id: 'test-id', async sendMessage(message) { forwarded.push(message); return sendMessage ? sendMessage(message) : { version: core.VERSION, jobs: [] }; }, onMessage: { addListener(callback) { fromExtension = callback; } } } };
  configureChrome?.(chrome);
  const fetch = async(url,options)=>{catalogRequests.push({url,options});return fetchCatalog ? fetchCatalog(url,options) : Response.json({recipes:JSON.parse(options.body).items.map(()=>require('./recipe-fixture.cjs')('auto.cars'))});};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../bridge.js'), 'utf8'), { AutopostCore: core, window, chrome, location: { origin }, navigator: { userActivation: { isActive: true } }, Date,fetch,AbortController,setTimeout,clearTimeout });
  async function event(type, data) { for (const listener of listeners[type] || []) await listener(data); }
  async function request(type, requestId = 'req-1', overrides = {}) {
    return event('message', { source: window, origin, data: { source: 'autopost-app', type, requestId, payload: { batchId: requestId, listing: { title: 'Title', description: 'Description', extra: 'do not forward' }, photos: [], platforms: [{ id: 'av', url: 'https://attacker.invalid' }], extra: 'do not forward' } }, ...overrides });
  }
  return { event, request, responses, handshakes, forwarded, fromExtension, window, origin,catalogRequests,chrome };
}

test('RUN requires a trusted event and allows only one request per gesture', async () => {
  const bridge = createBridge();
  await bridge.request('RUN');
  assert.equal(bridge.forwarded.length, 0);
  await bridge.event('click', { isTrusted: false });
  await bridge.request('RUN', 'req-2');
  assert.equal(bridge.forwarded.length, 0);
  await bridge.event('click', { isTrusted: true });
  await bridge.request('RUN', 'req-3');
  assert.equal(bridge.forwarded.length, 1);
  assert.equal(bridge.forwarded[0].payload.extra, undefined);
  assert.equal(bridge.forwarded[0].payload.listing.extra, undefined);
  assert.equal(bridge.forwarded[0].payload.platforms[0].url, undefined);
  await bridge.request('RUN', 'req-4');
  assert.equal(bridge.forwarded.length, 1);
  assert.equal(bridge.responses.at(-1).message.payload.code, 'USER_GESTURE_REQUIRED');
  assert.equal(bridge.catalogRequests.length,1);assert.equal(bridge.catalogRequests[0].url,'/api/workspace/extension-config');
  assert.equal('photos' in JSON.parse(bridge.catalogRequests[0].options.body).items[0],false);
  assert.ok(bridge.forwarded[0].payload.recipe);
});
test('catalog failures prevent launch; no stale dictionary or executable response is used',async()=>{
  const bridge=createBridge({fetchCatalog:async()=>Response.json({error:'Catalog unavailable'},{status:503})});
  await bridge.event('click',{isTrusted:true});await bridge.request('RUN');
  assert.equal(bridge.forwarded.length,0);assert.match(bridge.responses.at(-1).message.payload.error,/Catalog unavailable/);
});

test('foreign sources and origins do not receive responses', async () => {
  const bridge = createBridge();
  await bridge.request('PING', 'req-1', { origin: 'https://evil.invalid' });
  await bridge.request('PING', 'req-2', { source: {} });
  assert.equal(bridge.forwarded.length, 0);
  assert.equal(bridge.responses.length, 0);
  await bridge.request('PING', 'req-3');
  assert.equal(bridge.responses[0].target, bridge.origin);
});

test('progress is forwarded only for this origin and extension', () => {
  const bridge = createBridge();
  bridge.fromExtension({ kind: 'APP_PROGRESS', origin: 'http://localhost:5173', jobs: [] }, { id: 'test-id' });
  bridge.fromExtension({ kind: 'APP_PROGRESS', origin: bridge.origin, jobs: [] }, { id: 'other-extension' });
  assert.equal(bridge.responses.length, 0);
  bridge.fromExtension({ kind: 'APP_PROGRESS', origin: bridge.origin, jobs: [] }, { id: 'test-id' });
  assert.equal(bridge.responses[0].message.type, 'PROGRESS');
});

test('bridge announces readiness and acknowledges before a cold worker replies', async () => {
  let complete;
  const bridge = createBridge({sendMessage: () => new Promise(resolve => { complete = resolve; })});
  assert.equal(bridge.handshakes[0].message.type,'READY');
  const pending = bridge.request('PING');
  assert.equal(bridge.handshakes.at(-1).message.type,'ACK');
  assert.equal(bridge.responses.length,0);
  await bridge.request('PING');
  assert.equal(bridge.forwarded.length,1,'Same request is forwarded to the worker only once');
  complete({version:core.VERSION}); await pending;
  assert.equal(bridge.responses[0].message.payload.version,core.VERSION);
});

test('invalidated extension context returns instructions to reload the site', async () => {
  const bridge = createBridge({sendMessage: () => { throw new Error('Extension context invalidated.'); }});
  await bridge.request('PING');
  assert.equal(bridge.responses[0].message.payload.code,'EXTENSION_RELOAD_REQUIRED');
  assert.match(bridge.responses[0].message.payload.error,/Обновите вкладку/);
});

test('missing runtime at startup has no uncaught exception and returns recovery instructions', async () => {
  for (const configureChrome of [
    chrome => { delete chrome.runtime; },
    chrome => { delete chrome.runtime.id; },
    chrome => { delete chrome.runtime.sendMessage; },
    chrome => { delete chrome.runtime.onMessage; },
    chrome => { chrome.runtime.onMessage.addListener = () => { throw new Error('Extension context invalidated.'); }; },
  ]) {
    const bridge = createBridge({configureChrome});
    assert.equal(bridge.handshakes.length,0,'No false READY for an unusable bridge');
    await bridge.request('PING');
    assert.equal(bridge.responses.at(-1).message.payload.code,'EXTENSION_RELOAD_REQUIRED');
    assert.match(bridge.responses.at(-1).message.payload.error,/Обновите вкладку/);
    assert.equal(bridge.forwarded.length,0);
  }
});

test('runtime lost after extension reload cannot reserve or launch a card', async () => {
  for (const invalidate of [chrome => { delete chrome.runtime; }, chrome => { delete chrome.runtime.id; }]) {
    const bridge = createBridge();
    await bridge.request('PING');
    invalidate(bridge.chrome);
    await bridge.event('click',{isTrusted:true});
    await bridge.request('RUN','run-after-reload');
    assert.equal(bridge.responses.at(-1).message.payload.code,'EXTENSION_RELOAD_REQUIRED');
    assert.equal(bridge.catalogRequests.length,0,'Disconnected extension must not consume a server reservation');
    assert.equal(bridge.forwarded.length,1,'Only the initial PING reached the worker');
    bridge.fromExtension({kind:'APP_PROGRESS',origin:bridge.origin,jobs:[]},{id:'test-id'});
    assert.equal(bridge.responses.length,2,'Orphaned callbacks must not relay stale progress');
  }
});

test('runtime disappearing while the catalog loads fails without launching or retrying', async () => {
  let finishCatalog;
  const bridge = createBridge({fetchCatalog:() => new Promise(resolve => {finishCatalog = resolve;})});
  await bridge.event('click',{isTrusted:true});
  const request = bridge.request('RUN');
  assert.equal(bridge.catalogRequests.length,1);
  delete bridge.chrome.runtime;
  finishCatalog(Response.json({recipes:[require('./recipe-fixture.cjs')('auto.cars')]}));
  await request;
  assert.equal(bridge.forwarded.length,0);
  assert.equal(bridge.responses.at(-1).message.payload.code,'EXTENSION_RELOAD_REQUIRED');
});
