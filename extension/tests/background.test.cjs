'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Classic extension scripts are tested in CommonJS. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { IDBFactory } = require('fake-indexeddb');
const core = require('../core.js');
const recipe = require('./recipe-fixture.cjs');
const APP = core.APP_ORIGINS[0];
function createWorker({ data = {}, localData = {}, indexedDB = new IDBFactory(), accessLevel = true, sessionAccessLevel = true } = {}) {
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
      async remove(id) { tabs.delete(id); },
      onRemoved: { addListener() {} },
    },
  };
  chrome.storage.local = {
    async get(key) { return structuredClone(key === null ? localData : { [key]: localData[key] }); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete localData[key]; },
    async set() { throw new Error('Photos must not be written to content-script-accessible storage'); },
    ...(accessLevel ? { async setAccessLevel() {} } : {}),
  };
  if (!sessionAccessLevel) delete chrome.storage.session.setAccessLevel;
  const context = vm.createContext({ chrome, indexedDB, crypto: { randomUUID }, URL, Date, console, atob });
  // Execute the actual imports: stubbing importScripts hid worker registration failures.
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file }));
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), context, { filename: 'background.js' });
  function request(message, url = `${APP}/`, tabId = 1, frameId = 0) {
    return new Promise((resolve) => {
      const listening = onMessage(message, { id: 'test-id', frameId, url, tab: { id: tabId } }, resolve);
      if (!listening) resolve(undefined);
    });
  }
  return { data, localData, indexedDB, created, sent, request, context, tabs };
}
function payload() { return { batchId: 'test-batch', listing: { title: 'Автомобиль', description: 'Тест', price: 100, currency: 'BYN' }, photos: [], platforms: [{ id: 'av', url: 'https://attacker.invalid' }, { id: 'kufar', url: 'javascript:alert(1)' }] }; }
function run(worker) { return worker.request({ kind: 'APP_REQUEST', type: 'RUN', userGesture: true, payload: payload() }); }

test('cabinet click activates the right batch and restores an expired job using a single-use click ticket',async()=>{
  const w=createWorker();await run(w);
  const second={...payload(),batchId:'second',recordId:'record-two',platforms:[{id:'kufar'}]};
  await w.request({kind:'APP_REQUEST',type:'RUN',userGesture:true,payload:second});
  const opening={kind:'APP_REQUEST',type:'OPEN_JOB',userGesture:true,payload:{batchId:'second',recordId:'record-two',platformId:'kufar'}};
  await w.request(opening);assert.equal(w.created.length,3);assert.equal(w.tabs.get(12).active,true);
  w.tabs.get(12).url='https://unrelated.invalid/';await w.request(opening);assert.equal(w.created.length,4,'Never focus an assigned tab which navigated to another site');
  w.data.autopostSessionV1.batches.find(b=>b.batchId==='second').expiresAt=Date.now()-1;
  const ticket=await w.request(opening);assert.ok(ticket.resumeToken);assert.equal(w.created.length,4);
  const restore={kind:'APP_REQUEST',type:'RESTORE_JOB',payload:{resumeToken:ticket.resumeToken,item:second}};
  assert.ok((await w.request({...restore,payload:{...restore.payload,profileId:'other'}})).error);
  assert.ok((await w.request({...restore,payload:{...restore.payload,item:{...second,recordId:'wrong'}}})).error);
  assert.equal((await w.request(restore)).jobs.length,1);assert.equal(w.created.length,5);
  assert.ok((await w.request(restore)).error,'Ticket is consumed');assert.equal(w.created.length,5);
});
test('automatic link capture requires a submit on the assigned tab and matching evidence; durable receipts survive browser restart',async()=>{
  const w=createWorker();const input={...payload(),profileId:'owner',recordId:'card',listing:{...payload().listing,title:'Видеокарта RX 570'},platforms:[{id:'kufar'}]};
  await w.request({kind:'APP_REQUEST',type:'RUN',userGesture:true,payload:input});
  const form='https://www.kufar.by/ain/create';const url='https://www.kufar.by/item/123456';
  const {task}=await w.request({kind:'GET_TASK'},form,10);
  const report={kind:'REPORT_TASK',report:{jobId:task.jobId,status:'link_recorded',url,capture:{mode:'detail',url,title:input.listing.title,attemptId:'absent'}}};
  assert.ok((await w.request(report,url,10)).error);
  assert.equal((await w.request({kind:'ARM_SUBMISSION',jobId:task.jobId,userGesture:true,title:input.listing.title},form,99)).task,null);
  assert.ok((await w.request({kind:'ARM_SUBMISSION',jobId:task.jobId,userGesture:false},form,10)).error);
  const armed=await w.request({kind:'ARM_SUBMISSION',jobId:task.jobId,userGesture:true,title:input.listing.title},form,10);
  report.report.capture.attemptId=armed.submission.id;
  assert.ok((await w.request({...report,report:{...report.report,capture:{...report.report.capture,title:'RX 5700'}}},url,10)).error);
  assert.ok((await w.request(report,form,10)).error,'Detail evidence must refer to the current page');
  assert.equal((await w.request(report,url,10)).ok,true);
  assert.match(w.sent.find(s=>s.message.receiptId)?.message.kind,/APP_PROGRESS/);
  const restarted=createWorker({indexedDB:w.indexedDB});
  const status=await restarted.request({kind:'APP_REQUEST',type:'STATUS',payload:{profileId:'owner'}});
  assert.equal(status.jobs.length,0);assert.equal(status.receipts.length,1);assert.equal(status.receipts[0].jobs[0].url,url);
  assert.equal((await restarted.request({kind:'APP_REQUEST',type:'STATUS',payload:{profileId:'other'}})).receipts.length,0);
  const ack={kind:'APP_REQUEST',type:'ACK_RECEIPT',payload:{profileId:'other',receiptId:status.receipts[0].receiptId}};
  await restarted.request(ack);assert.equal((await restarted.request({kind:'APP_REQUEST',type:'STATUS',payload:{profileId:'owner'}})).receipts.length,1);
  await restarted.request({...ack,payload:{...ack.payload,profileId:'owner'}});
  assert.equal((await restarted.request({kind:'APP_REQUEST',type:'STATUS',payload:{profileId:'owner'}})).receipts.length,0);
});
test('automatic capture completes one bulk job and advances its marketplace only once',async()=>{
  const w=createWorker();const input={...payload(),profileId:'owner',recordId:'first',listing:{...payload().listing,title:'Видеокарта RX 570'},platforms:[{id:'kufar'}]};
  await w.request({kind:'APP_REQUEST',type:'RUN_QUEUE',userGesture:true,payload:{profileId:'owner',items:[input,{...input,batchId:'second',recordId:'second'}]}});
  const form='https://www.kufar.by/ain/create';const url='https://www.kufar.by/item/123456';const {task}=await w.request({kind:'GET_TASK'},form,10);
  const armed=await w.request({kind:'ARM_SUBMISSION',jobId:task.jobId,userGesture:true,title:input.listing.title},form,10);
  const report={kind:'REPORT_TASK',report:{jobId:task.jobId,status:'link_recorded',url,capture:{url,mode:'detail',title:input.listing.title,attemptId:armed.submission.id}}};
  await w.request(report,url,10);await w.request(report,url,10);assert.equal(w.created.length,2);
});
test('status queue opens three inactive tabs, binds reports to exact jobs and stores checked facts separately',async()=>{
  const w=createWorker();const items=Array.from({length:4},(_,i)=>({recordId:'card-'+i,platformId:'kufar',url:'https://www.kufar.by/item/'+(123450+i),title:'RX 570'}));
  const msg={kind:'APP_REQUEST',type:'CHECK_STATUS',userGesture:true,payload:{profileId:'owner',items}};
  assert.ok((await w.request({...msg,userGesture:false})).error);assert.equal(w.created.length,0);
  assert.equal((await w.request(msg)).pendingChecks,4);assert.equal(w.created.length,3);assert.ok(w.created.every(t=>t.active===false));
  await w.request(msg);assert.equal(w.created.length,3,'Repeated clicks do not duplicate pending checks');
  const {task}=await w.request({kind:'GET_STATUS_TASK'},items[0].url,10);assert.ok(task.id);assert.equal(task.listing,undefined);
  assert.equal((await w.request({kind:'GET_STATUS_TASK'},'https://av.by/',10)).task,null);
  assert.ok((await w.request({kind:'REPORT_STATUS',checkId:'other',result:{state:'moderation'}},items[0].url,10)).error);
  assert.equal((await w.request({kind:'REPORT_STATUS',checkId:task.id,result:{state:'moderation',message:'Объявление на модерации'}},items[0].url,10)).ok,true);
  assert.equal(w.created.length,4);assert.equal(w.tabs.has(10),false);
  const result=await w.request({kind:'APP_REQUEST',type:'STATUS',payload:{profileId:'owner'}});
  assert.equal(result.pendingChecks,3);assert.equal(result.receipts[0].remoteStatus.state,'moderation');assert.equal(result.receipts[0].recordId,'card-0');
  assert.equal((await w.request({kind:'APP_REQUEST',type:'STATUS',payload:{profileId:'other'}})).pendingChecks,0);
});

test('price requests require app origin and gesture, cache public results, and never create tabs',async()=>{
 const worker=createWorker();let calls=0;
 worker.context.AutopostPrices.search=async()=>{calls++;return {results:[{id:'kufar',status:'ok',groups:[]}],checkedAt:new Date().toISOString()};};
 const message={kind:'APP_REQUEST',type:'PRICE_SEARCH',userGesture:true,payload:{query:'RX 570',terms:['RX 570'],taxonomyId:'computers.gpu',recipe:recipe()}};
 assert.ok((await worker.request({...message,userGesture:false})).error);
 const denied=await worker.request(message,'https://www.kufar.by/');assert.ok(!denied||denied.error);assert.equal(calls,0);
 assert.equal((await worker.request(message)).results[0].status,'ok');assert.equal((await worker.request(message)).cached,true);assert.equal(calls,1);assert.equal(worker.created.length,0);
 assert.ok((await worker.request({...message,payload:{...message.payload,query:'RX 580'}})).error);assert.equal(calls,1);
});

test('worker registers and answers PING when storage.local.setAccessLevel is unavailable', async () => {
  for (const sessionAccessLevel of [true, false]) {
    const worker = createWorker({ accessLevel: false, sessionAccessLevel });
    assert.equal((await worker.request({ kind: 'APP_REQUEST', type: 'PING' })).version, core.VERSION);
  }
});

test('queue stores photos separately and removes them after completion',async()=>{
 const w=createWorker({accessLevel:false});const bytes=Buffer.alloc(800000);bytes[0]=255;bytes[1]=216;bytes[2]=255;
 const photo={name:'test.jpg',type:'image/jpeg',dataUrl:'data:image/jpeg;base64,'+bytes.toString('base64')};
 const items=Array.from({length:5},(_,i)=>({...payload(),batchId:'photo-'+i,profileId:'photos',photos:[photo],platforms:[{id:'kufar'}]}));
 const result=await w.request({kind:'APP_REQUEST',type:'RUN_QUEUE',userGesture:true,payload:{profileId:'photos',items}});
 assert.ok(!result.error,result.error);assert.equal(result.batches.length,5);assert.equal(w.created.length,1);
 assert.ok(!JSON.stringify(w.data.autopostSessionV1).includes('base64'));
 const first=w.data.autopostSessionV1.batches[0];assert.equal((await w.context.AutopostPhotos.get(first.photoKey)).length,1);
 assert.deepEqual(w.localData,{},'No photos are exposed through storage.local');
 const task=await w.request({kind:'GET_TASK'},'https://www.kufar.by/ain/create',w.created[0].id);
 assert.equal(task.task.photos[0].dataUrl,photo.dataUrl);
 await w.request({kind:'REPORT_TASK',report:{jobId:task.task.jobId,status:'cancelled'}},'https://www.kufar.by/ain/create',w.created[0].id);
 assert.equal(await w.context.AutopostPhotos.get(first.photoKey),undefined);assert.equal(w.created.length,2);
});

test('private photos survive worker restart, then expire with the browser session', async () => {
  const first = createWorker({accessLevel:false});
  const photo = {name:'image.jpg',type:'image/jpeg',dataUrl:'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2Q=='};
  await first.request({kind:'APP_REQUEST',type:'RUN',userGesture:true,payload:{...payload(),photos:[photo]}});
  const photoKey = first.data.autopostSessionV1.batches[0].photoKey;
  const restarted = createWorker({data:first.data,indexedDB:first.indexedDB,accessLevel:false});
  await restarted.request({kind:'APP_REQUEST',type:'STATUS'});
  const task = await restarted.request({kind:'GET_TASK'},'https://av.by/',first.created[0].id);
  assert.equal(task.task.photos[0].dataUrl,photo.dataUrl);
  assert.equal((await restarted.request({kind:'GET_TASK'},'https://www.kufar.by/',first.created[0].id)).task,null);
  const newSession = createWorker({indexedDB:first.indexedDB,accessLevel:false,localData:{'autopostPhotos:old':[photo],unrelated:'keep'}});
  await newSession.request({kind:'APP_REQUEST',type:'STATUS'});
  assert.equal(await newSession.context.AutopostPhotos.get(photoKey),undefined);
  assert.deepEqual(newSession.localData,{unrelated:'keep'});
});

test('PING answers even while a storage operation is pending', async () => {
  const worker = createWorker();
  await worker.request({kind:'APP_REQUEST',type:'STATUS'});
  const release = vm.runInContext('new Promise(resolve => { globalThis.releaseStorage = resolve; })',worker.context);
  worker.context.chrome.storage.session.get = () => release;
  const status = worker.request({kind:'APP_REQUEST',type:'STATUS'});
  assert.equal((await worker.request({kind:'APP_REQUEST',type:'PING'})).version,core.VERSION);
  worker.context.releaseStorage({});
  await status;
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
 const w=createWorker();const gpu={...payload(),batchId:'gpu-routing',listing:{...payload().listing,category:'general',taxonomyId:'onliner.286'},platforms:[{id:'kufar-general'},{id:'onliner-general'}],categoryOverrides:{onliner:'17'},recipe:recipe('onliner.286',{onliner:'17'})};
 const result=await w.request({kind:'APP_REQUEST',type:'RUN',userGesture:true,payload:gpu});assert.ok(!result.error,result.error);
 const k=await w.request({kind:'GET_TASK'},'https://www.kufar.by/ain/create',w.created[0].id);
 const o=await w.request({kind:'GET_TASK'},'https://baraholka.onliner.by/fleamarketposting.php',w.created[1].id);
 assert.equal(k.task.listing.taxonomyId,'computers.gpu');assert.equal(k.task.mapping.attributes[0].value,'11');assert.equal(o.task.mapping.id,'17');
 assert.equal(w.data.autopostSessionV1.batches[0].categoryOverrides.onliner,'17');
 const bad=await w.request({kind:'APP_REQUEST',type:'RUN',userGesture:true,payload:{...gpu,batchId:'bad-routing',categoryOverrides:{onliner:'javascript:attack'}}});assert.match(bad.error,/справочнике/);assert.equal(w.created.length,2);
});
