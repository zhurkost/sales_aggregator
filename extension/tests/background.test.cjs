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
const APP = core.APP_ORIGINS[0];
function createWorker({ data = {}, localData = {}, indexedDB = new IDBFactory(), accessLevel = true, sessionAccessLevel = true, verifyResult={ok:true} } = {}) {
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
      async sendMessage(id, message) { sent.push({ id, message }); if(message.kind==='VERIFY_SNAPSHOT')return verifyResult; },
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
  const context = vm.createContext({ chrome, indexedDB, crypto: { randomUUID }, URL, Date, console, atob,setTimeout,clearTimeout,structuredClone });
  // Execute the actual imports: stubbing importScripts hid worker registration failures.
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file }));
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), context, { filename: 'background.js' });
  function request(message, url = `${APP}/`, tabId = 1, frameId = 0, documentId = `document-${tabId}`) {
    if (message.kind === 'GET_TASK' && !Object.hasOwn(message, 'navigation'))
      message = {...message, navigation:{type:'navigate',referrer:''}};
    if (message.kind === 'RENTAL_PAGE' && message.type === 'GET')
      message = {...message,payload:{navigation:{type:'navigate',referrer:''},...message.payload}};
    return new Promise((resolve) => {
      const listening = onMessage(message, { id: 'test-id', frameId, documentId, url, tab: { id: tabId } }, resolve);
      if (!listening) resolve(undefined);
    });
  }
  return { data, localData, indexedDB, created, sent, request, context, tabs };
}
test('real worker registration routes rental jobs to all four sites without legacy listing validation',async()=>{
 const w=createWorker();
 const input={id:'rental',profileId:'owner',revision:1,mode:'assist',draft:{values:{}},photos:[],jobs:['kufar','onliner','realt','domovita'].map(p=>({...JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/rental/apartments_long_term_rent/runtime/browser_'+p+'.json'),'utf8')),controls:[]}))};
 const result=await w.request({kind:'RENTAL_REQUEST',type:'RENTAL_RUN',payload:input,userGesture:true});
 assert.equal(result.jobs.length,4);assert.equal(w.created.length,4);
 const ping=await w.request({kind:'APP_REQUEST',type:'PING'});assert.ok(ping.capabilities.includes('rental-publishing'));
 const task=await w.request({kind:'RENTAL_PAGE',type:'GET'},input.jobs[2].startUrl,12);assert.equal(task.task.recipe.platform,'realt');
 const frame=await w.request({kind:'RENTAL_PAGE',type:'GET'},input.jobs[2].startUrl,12,1);assert.equal(frame,undefined);
});

function rentalPayload(photos = []) {
  return {id:'card',profileId:'owner',revision:1,mode:'assist',draft:{values:{}},photos,
    jobs:[{...JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/rental/apartments_long_term_rent/runtime/browser_realt.json'),'utf8')),controls:[]}]};
}
test('worker rejects retired commands and messages from foreign origins or frames', async () => {
  const w=createWorker();
  assert.equal(await w.request({kind:'APP_REQUEST',type:'RUN',userGesture:true}),undefined);
  assert.equal(await w.request({kind:'APP_REQUEST',type:'PING'},'https://evil.invalid/'),undefined);
  assert.equal(await w.request({kind:'APP_REQUEST',type:'PING'},APP,1,1),undefined);
  const launch={kind:'RENTAL_REQUEST',type:'RENTAL_RUN',payload:rentalPayload(),userGesture:true};
  assert.ok((await w.request(launch,'https://evil.invalid/')).error);
  assert.ok((await w.request({...launch,userGesture:false})).error);
  assert.equal(w.created.length,0);
});
test('rental photos survive worker restart, expire with the browser session and never enter local storage', async () => {
  const photo={id:'photo-1',name:'a.png',type:'image/png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAE='};
  const w=createWorker();const payload=rentalPayload([photo]);
  const result=await w.request({kind:'RENTAL_REQUEST',type:'RENTAL_RUN',payload,userGesture:true});
  assert.equal(result.error,undefined);
  const restart=createWorker({data:w.data,indexedDB:w.indexedDB});
  const task=await restart.request({kind:'RENTAL_PAGE',type:'GET'},payload.jobs[0].startUrl,10);
  assert.equal(task.task.photos[0].dataUrl,photo.dataUrl);
  assert.deepEqual(w.localData,{});
  const expired=createWorker({indexedDB:w.indexedDB});
  await vm.runInContext('serialized(cleanPhotos)',expired.context);
  assert.equal((await expired.context.AutopostPhotos.keys()).length,0);
});
