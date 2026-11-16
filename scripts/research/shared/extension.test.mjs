import {createCheckpointWriter} from '../abw-cars/checkpoint-writer.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {readCheckpoint} from './checkpoint.mjs';
import {newState as avState} from '../av-cars/core.mjs';
import {newState as abwState} from '../abw-cars/core.mjs';
// Run the actual UI/transport modules against an offline DOM/storage/clock.
// Every fetch is a stub; no requests to either marketplace occur.
for(const platform of ['av','abw'])test(platform+' UI restores old progress and supports saved pacing and live speed changes',async()=>{
  const initial=(platform==='av'?avState:abwState)();
  const backup=structuredClone(initial);backup.requests=12683;backup.completedModels=['completed-model'];
  backup.brands=[{name:'Kia',value:254,children:[]}];
  const storageKey=platform==='av'?'avResearch':'abwResearchV1';let stored=initial;const settings={};
  const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{files:[],disabled:false,textContent:'',handlers:{},addEventListener(e,fn){this.handlers[e]=fn;}});return elements.get(id);};
  let time=10000;const sent=[],timers=new Map();let timerId=0;
  const bundle={format:platform+'-research-bundle-1',files:{[`evidence/${platform}-catalog-source.json`]:backup}};
  const API=platform==='av'?'https://web-api.av.by/offer-types/cars/offer-form':'https://b.abw.by/api/v2/create/suggest';
  const sandbox={
    document:{getElementById:element},console:{info(){}},URL,AbortController,structuredClone,JSON,Math,Error,TypeError,
    Date:{now:()=>time},
    setTimeout:(fn,ms)=>{const id=++timerId;if(ms<45000){time+=ms;queueMicrotask(fn);}else timers.set(id,fn);return id;},
    clearTimeout:id=>timers.delete(id),
    chrome:{runtime:{getURL:n=>'local:'+n},storage:{local:{get:async()=>({[storageKey]:structuredClone(stored),...settings}),set:async obj=>{if(Object.hasOwn(obj,storageKey))stored=structuredClone(obj[storageKey]);else Object.assign(settings,obj);}}}},
    navigator:{locks:{request:async(name,opts,fn)=>fn({name})}},
    fetch:async(url,opts)=>{
      if(String(url).startsWith('local:'))return {json:async()=>({})};
      assert(String(url).startsWith(API));assert.equal(opts.redirect,'error');assert.equal(opts.credentials,'omit');
      sent.push({time,url:String(url),method:opts.method});time+=20;
      return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({properties:[]})};
    },API,readCheckpoint,createCheckpointWriter,newState:()=>structuredClone(initial),stats:s=>({requests:s.requests}),
    parseHar:()=>({headers:{'x-api-key':'TEST_ONLY'},records:[]}),importRecords:()=>{throw Error('Existing progress must not be replaced by HAR');},
    readHar:()=>[],importHar:()=>{throw Error('Not used');},resultFiles:()=>({}),
    crawl:async({state,request,save})=>{
      assert.equal(state.requests,12683);assert.deepEqual([...state.completedModels],['completed-model']);
      for(let i=0;i<4;i++){if(i===2||i===3){element('delay').value=i===2?'50':'0';await element('delay').handlers.change();}await (platform==='av'?request('POST',{properties:[]}):request(API+'?brand=254'));state.requests++;}
      state.status='paused';await save(state);
    }
  };
  const code=fs.readFileSync(new URL(`../${platform}-cars/extension/app.mjs`,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
  await vm.runInNewContext('(async()=>{'+code+'})()',sandbox);
  assert.equal(element('delay').value,'20');
  element('delay').value='-1';await element('delay').handlers.change();assert.equal(element('delay').value,'20');
  element('delay').value='250';await element('delay').handlers.change();assert.equal(settings[platform+'ResearchDelayMs'],250);
  element('checkpoint').files=[{text:async()=>JSON.stringify(bundle)}];await element('checkpoint').handlers.change();
  assert.equal(stored.requests,12683);
  if(platform==='abw'){element('har').files=[{text:async()=>JSON.stringify(bundle)}];await element('har').handlers.change();assert.equal(stored.requests,12683);assert.deepEqual(stored.completedModels,['completed-model']);}
  if(platform==='av'){element('har').files=[{text:async()=>'{}'}];await element('har').handlers.change();}
  await element('start').handlers.click();
  assert.equal(stored.requests,12687);assert.deepEqual(stored.completedModels,['completed-model']);
  assert.equal(sent.length,4);assert.equal(sent[1].time-sent[0].time,250);assert.equal(sent[2].time-sent[1].time,50);assert.equal(sent[3].time-sent[2].time,20);assert.equal(settings[platform+'ResearchDelayMs'],0);
  assert(sent.every(r=>r.method===(platform==='av'?'POST':'GET')));
  await element('checkpoint').handlers.change();
  assert.equal(stored.requests,12687);assert(element('status').textContent.includes('более новый прогресс'));
  if(platform==='abw'){const unsafe=structuredClone(bundle);const candidate=unsafe.files['evidence/abw-catalog-source.json'];candidate.requests=99999;candidate.completedModels=[];element('checkpoint').files=[{text:async()=>JSON.stringify(unsafe)}];await element('checkpoint').handlers.change();assert.equal(stored.requests,12687);assert(element('status').textContent.includes('завершённых моделей'));}
  await vm.runInNewContext('(async()=>{'+code+'})()',sandbox);
  assert.equal(element('delay').value,'0');assert.equal(sent.length,4); // Reload restores speed without starting requests.
});
