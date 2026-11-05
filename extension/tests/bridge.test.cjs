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
  const origin = core.APP_ORIGINS[0];
  const window = {
    addEventListener(type, callback) { (listeners[type] ||= []).push(callback); },
    postMessage(message, target) { (['ACK','READY'].includes(message.type) ? handshakes : responses).push({ message, target }); },
  };
  window.top = window;
  const chrome = { runtime: { id: 'test-id', async sendMessage(message) { forwarded.push(message); return sendMessage ? sendMessage(message) : { version: core.VERSION, jobs: [] }; } } };
  configureChrome?.(chrome);
  const fetch = async(url,options)=>{catalogRequests.push({url,options});return fetchCatalog ? fetchCatalog(url,options) : Response.json({format:1,id:'rental',revision:1,jobs:[{platform:'kufar'}]});};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../bridge.js'), 'utf8'), { AutopostCore: core, window, chrome, location: { origin }, navigator: { userActivation: { isActive: true } }, Date,fetch,AbortController,setTimeout,clearTimeout });
  async function event(type, data) { for (const listener of listeners[type] || []) await listener(data); }
  async function request(type, requestId = 'req-1', overrides = {}) {
    return event('message', { source: window, origin, data: { source: 'autopost-app', type, requestId, payload: { id: requestId, profileId:'owner', card:{values:{}}, mode:'assist', photos: [], jobs:[{startUrl:'https://attacker.invalid'}], extra:'do not forward' } }, ...overrides });
  }
  return { event, request, responses, handshakes, forwarded, window, origin,catalogRequests,chrome };
}

test('RENTAL_RUN requires a trusted event and allows only one request per gesture', async () => {
  const bridge = createBridge();
  await bridge.request('RENTAL_RUN');
  assert.equal(bridge.forwarded.length, 0);
  await bridge.event('click', { isTrusted: false });
  await bridge.request('RENTAL_RUN', 'req-2');
  assert.equal(bridge.forwarded.length, 0);
  await bridge.event('click', { isTrusted: true });
  await bridge.request('RENTAL_RUN', 'req-3');
  assert.equal(bridge.forwarded.length, 1);
  assert.equal(bridge.forwarded[0].payload.extra, undefined);
  assert.equal(bridge.forwarded[0].payload.listing, undefined);
  assert.equal(bridge.forwarded[0].payload.platforms, undefined);
  await bridge.request('RENTAL_RUN', 'req-4');
  assert.equal(bridge.forwarded.length, 1);
  assert.equal(bridge.responses.at(-1).message.payload.code, 'USER_GESTURE_REQUIRED');
  assert.equal(bridge.catalogRequests.length,1);assert.equal(bridge.catalogRequests[0].url,'/api/workspace/rental/extension-config');
  assert.equal('photos' in JSON.parse(bridge.catalogRequests[0].options.body),false);
  assert.ok(bridge.forwarded[0].payload.jobs);
});

test('rental launch obtains a server recipe after a trusted click and never sends photos to the server',async()=>{
 const recipe={format:1,id:'rental',revision:1,jobs:[{platform:'kufar'}]};
 const bridge=createBridge({fetchCatalog:async()=>Response.json(recipe)});
 const input={profileId:'owner',id:'rental',revision:7,card:{values:{description:'Apartment'}},photos:[{id:'image'}],mode:'assist',jobs:[{startUrl:'https://evil.invalid'}]};
 const overrides={data:{source:'autopost-app',type:'RENTAL_RUN',requestId:'rental-1',payload:input}};
 await bridge.request('RENTAL_RUN','rental-1',overrides);assert.equal(bridge.catalogRequests.length,0);
 await bridge.event('click',{isTrusted:true});overrides.data.requestId='rental-2';await bridge.request('RENTAL_RUN','rental-2',overrides);
 assert.equal(bridge.catalogRequests[0].url,'/api/workspace/rental/extension-config');
 const request=bridge.catalogRequests[0].options;assert.equal(request.headers['X-Autopost-Workspace'],'owner');assert.equal('photos' in JSON.parse(request.body),false);assert.equal(JSON.parse(request.body).revision,7);assert.deepEqual(JSON.parse(request.body).card,input.card);
 assert.equal(bridge.forwarded[0].kind,'RENTAL_REQUEST');assert.deepEqual(bridge.forwarded[0].payload.jobs,recipe.jobs);assert.equal(bridge.forwarded[0].payload.mode,'assist');
});
test('catalog failures prevent launch; no stale dictionary or executable response is used',async()=>{
  const bridge=createBridge({fetchCatalog:async()=>Response.json({error:'Catalog unavailable'},{status:503})});
  await bridge.event('click',{isTrusted:true});await bridge.request('RENTAL_RUN');
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
    await bridge.request('RENTAL_RUN','run-after-reload');
    assert.equal(bridge.responses.at(-1).message.payload.code,'EXTENSION_RELOAD_REQUIRED');
    assert.equal(bridge.catalogRequests.length,0,'Disconnected extension must not consume a server reservation');
    assert.equal(bridge.forwarded.length,1,'Only the initial PING reached the worker');
    assert.equal(bridge.responses.length,2,'Orphaned callbacks must not relay stale progress');
  }
});

test('runtime disappearing while the catalog loads fails without launching or retrying', async () => {
  let finishCatalog;
  const bridge = createBridge({fetchCatalog:() => new Promise(resolve => {finishCatalog = resolve;})});
  await bridge.event('click',{isTrusted:true});
  const request = bridge.request('RENTAL_RUN');
  assert.equal(bridge.catalogRequests.length,1);
  delete bridge.chrome.runtime;
  finishCatalog(Response.json({recipes:[{format:1,id:'rental',revision:1,jobs:[{platform:'kufar'}]}]}));
  await request;
  assert.equal(bridge.forwarded.length,0);
  assert.equal(bridge.responses.at(-1).message.payload.code,'EXTENSION_RELOAD_REQUIRED');
});

test('current form preparation errors are returned once without polling for persistence',async()=>{
  const bridge=createBridge({fetchCatalog:async()=>Response.json({error:'Правила обновились'},{status:409})});
  await bridge.event('click',{isTrusted:true});await bridge.request('RENTAL_RUN');
  assert.equal(bridge.catalogRequests.length,1);
  assert.equal(bridge.forwarded.length,0);
  assert.equal(bridge.responses.at(-1).message.payload.error,'Правила обновились');
});
