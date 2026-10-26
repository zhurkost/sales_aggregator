'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Classic extension scripts are tested in CommonJS. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const core = require('../core.js');
require('../taxonomy.js');
const APP = core.APP_ORIGINS[0];
function createWorker() {
  const data = {};
  const created = [];
  const sent = [];
  const tabs = new Map([[1, { id: 1, url: `${APP}/` }], [2, { id: 2, url: 'http://localhost:5173/' }]]);
  let onMessage;
  const chrome = {
    alarms:{create(){},onAlarm:{addListener(){}}},
    runtime: { id: 'test-id', onMessage: { addListener(listener) { onMessage = listener; } } },
    storage: { session: {
      async get(key) { return structuredClone(key===null?data:{ [key]: data[key] }); },
      async set(value) { Object.assign(data, structuredClone(value)); },
      async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])delete data[k];},
      async setAccessLevel() {},
    } },
    tabs: {
      async create(options) { const tab = { id: created.length + 10, ...options }; created.push(tab); tabs.set(tab.id, tab); return tab; },
      async get(id) { if (!tabs.has(id)) throw new Error('No tab'); return tabs.get(id); },
      async update(id,options){if(!tabs.has(id))throw new Error('No tab');Object.assign(tabs.get(id),options);return tabs.get(id);},
      async sendMessage(id, message) { sent.push({ id, message }); },
      onRemoved: { addListener() {} },
    },
  };
  chrome.storage.local=chrome.storage.session;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), { chrome, AutopostCore: core, AutopostTaxonomy:globalThis.AutopostTaxonomy,AutopostCategoryOptions:globalThis.AutopostCategoryOptions, importScripts() {}, crypto: { randomUUID }, URL, Date, console });
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

test('queue stores photos separately and removes them after completion',async()=>{
 const w=createWorker();const bytes=Buffer.alloc(800000);bytes[0]=255;bytes[1]=216;bytes[2]=255;
 const photo={name:'test.jpg',type:'image/jpeg',dataUrl:'data:image/jpeg;base64,'+bytes.toString('base64')};
 const items=Array.from({length:5},(_,i)=>({...payload(),batchId:'photo-'+i,profileId:'photos',photos:[photo],platforms:[{id:'kufar'}]}));
 const result=await w.request({kind:'APP_REQUEST',type:'RUN_QUEUE',userGesture:true,payload:{profileId:'photos',items}});
 assert.ok(!result.error,result.error);assert.equal(result.batches.length,5);assert.equal(w.created.length,1);
 assert.ok(!JSON.stringify(w.data.autopostSessionV1).includes('base64'));
 const first=w.data.autopostSessionV1.batches[0];assert.equal(w.data[first.photoKey].length,1);
 const task=await w.request({kind:'GET_TASK'},'https://www.kufar.by/ain/create',w.created[0].id);
 assert.equal(task.task.photos[0].dataUrl,photo.dataUrl);
 await w.request({kind:'REPORT_TASK',report:{jobId:task.task.jobId,status:'cancelled'}},'https://www.kufar.by/ain/create',w.created[0].id);
 assert.equal(w.data[first.photoKey],undefined);assert.equal(w.created.length,2);
});

test('RUN opens only fixed origins and duplicate batch is idempotent', async () => {
  const worker = createWorker();
  const result = await run(worker);
  assert.equal(result.jobs.length, 2);
  assert.deepEqual(worker.created.map((tab) => tab.url), ['https://av.by/', 'https://www.kufar.by/ain/create']);
  assert.ok(result.jobs.every((job) => job.status === 'opening'));
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
  assert.equal(other.batchId, null);
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

test('all four selected parts marketplaces open and include helper tasks',async()=>{
 const worker=createWorker();const value=payload();value.profileId='owner';value.recordId='record';value.listing={...value.listing,category:'parts',partName:'Фара',condition:'Б/у',priceUnit:'За штуку'};value.platforms=['bamper','kufar-parts','onliner-parts','abw-parts'].map(id=>({id}));
 const result=await worker.request({kind:'APP_REQUEST',type:'RUN',userGesture:true,payload:value});assert.equal(result.jobs.length,4);assert.equal(worker.created.length,4);
 assert.equal(worker.created[1].url,'https://www.kufar.by/ain/create');assert.equal(worker.created[2].url,'https://baraholka.onliner.by/fleamarketposting.php');
 for(let i=0;i<4;i++)assert.ok((await worker.request({kind:'GET_TASK'},worker.created[i].url,10+i)).task);
 const other=await worker.request({kind:'APP_REQUEST',type:'STATUS',payload:{profileId:'different'}});assert.equal(other.jobs.length,0);
 await worker.request({kind:'APP_REQUEST',type:'OPEN_JOB',payload:{profileId:'owner',batchId:value.batchId,platformId:'onliner-parts'},userGesture:true});assert.equal(worker.created.length,4);
});
test('bulk queue serializes each marketplace and only advances after completion',async()=>{
 const worker=createWorker();const first={...payload(),profileId:'owner',recordId:'one',platforms:[{id:'kufar'}]};const second={...first,batchId:'batch-two',recordId:'two'};
 const result=await worker.request({kind:'APP_REQUEST',type:'RUN_QUEUE',payload:{profileId:'owner',items:[first,second]},userGesture:true});assert.equal(result.batches.length,2);assert.equal(worker.created.length,1);assert.equal(result.batches[1].jobs[0].status,'queued');
 const {task}=await worker.request({kind:'GET_TASK'},worker.created[0].url,10);await worker.request({kind:'REPORT_TASK',report:{jobId:task.jobId,status:'review_required',filledKeys:['title']}},worker.created[0].url,10);assert.equal(worker.created.length,1);
 await worker.request({kind:'REPORT_TASK',report:{jobId:task.jobId,status:'link_recorded',url:'https://evil.invalid/ad',userConfirmed:true}},worker.created[0].url,10);assert.equal(worker.created.length,1);
 await worker.request({kind:'REPORT_TASK',report:{jobId:task.jobId,status:'link_recorded',url:'https://www.kufar.by/item/123456',userConfirmed:true}},worker.created[0].url,10);assert.equal(worker.created.length,2);
 const duplicate=await worker.request({kind:'APP_REQUEST',type:'RUN_QUEUE',payload:{profileId:'owner',items:[first,second]},userGesture:true});assert.equal(duplicate.batches.length,2);assert.equal(worker.created.length,2);
});

test('default GPU mappings and per-marketplace corrections survive the worker queue',async()=>{
 const w=createWorker();const gpu={...payload(),batchId:'gpu-routing',listing:{...payload().listing,category:'general',taxonomyId:'onliner.286'},platforms:[{id:'kufar-general'},{id:'onliner-general'}],categoryOverrides:{onliner:'17'}};
 const result=await w.request({kind:'APP_REQUEST',type:'RUN',userGesture:true,payload:gpu});assert.ok(!result.error,result.error);
 const k=await w.request({kind:'GET_TASK'},'https://www.kufar.by/ain/create',w.created[0].id);
 const o=await w.request({kind:'GET_TASK'},'https://baraholka.onliner.by/fleamarketposting.php',w.created[1].id);
 assert.equal(k.task.listing.taxonomyId,'computers.gpu');assert.equal(k.task.mapping.attributes[0].value,'11');assert.equal(o.task.mapping.id,'17');
 assert.equal(w.data.autopostSessionV1.batches[0].categoryOverrides.onliner,'17');
 const bad=await w.request({kind:'APP_REQUEST',type:'RUN',userGesture:true,payload:{...gpu,batchId:'bad-routing',categoryOverrides:{onliner:'javascript:attack'}}});assert.match(bad.error,/справочнике/);assert.equal(w.created.length,2);
});
