const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function worker() {
  let stored = {};
  let serial = 0;
  const tabs = new Map(), photos = new Map();
  const context = vm.createContext({URL, Date, crypto, structuredClone,
    AutopostCore:require('../core.js'), AutopostRentalCore:require('../rental-core.js'),
    AutopostPhotos:{get:async k=>photos.get(k), set:async(k,v)=>photos.set(k,v), remove:async keys=>keys.forEach(k=>photos.delete(k))},
    chrome:{storage:{session:{get:async()=>structuredClone(stored),set:async v=>{stored=structuredClone(v);}}},
      tabs:{create:async options=>{const tab={...options,id:++serial};tabs.set(tab.id,tab);return tab;},
        get:async id=>{if(!tabs.has(id))throw new Error('Tab closed');return tabs.get(id);}}}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../rental-background.js'),'utf8'),context);
  const recipe=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/rental/apartments_long_term_rent/runtime/browser_realt.json'),'utf8'));
  const request=(type,id)=>context.AutopostRentalBackground.handle({kind:'RENTAL_REQUEST',type,userGesture:true,
    payload:{id,profileId:'owner',revision:1,mode:'automatic',card:{values:{}},jobs:[recipe],photos:[]}},
    {url:'http://localhost:5173/',tab:{id:999}});
  return {request,tabs,photos};
}

test('stopped launches do not exhaust the active card limit',async()=>{
  const w=worker();
  for(let i=0;i<25;i++){
    await assert.doesNotReject(()=>w.request('RENTAL_RUN','card-'+i),'launch '+(i+1));
    await w.request('RENTAL_STOP','card-'+i);
  }
});

test('closing all marketplace tabs releases capacity for a fresh card',async()=>{
  const w=worker();
  for(let i=0;i<25;i++){
    await assert.doesNotReject(()=>w.request('RENTAL_RUN','card-'+i),'launch '+(i+1));
    w.tabs.clear();
  }
});

test('capacity cleanup never evicts an active card with an open marketplace tab',async()=>{
  const w=worker();
  for(let i=0;i<20;i++) await w.request('RENTAL_RUN','active-'+i);
  await assert.rejects(()=>w.request('RENTAL_RUN','overflow'), /Слишком много/);
  assert.equal(w.photos.size,20);
  const status=await w.request('RENTAL_STATUS','active-0');
  assert.equal(status.jobs.length,1);
});

test('discarding stopped history also releases its photo storage',async()=>{
  const w=worker();
  for(let i=0;i<25;i++){
    await w.request('RENTAL_RUN','stopped-'+i);
    await w.request('RENTAL_STOP','stopped-'+i);
  }
  assert.ok(w.photos.size<=20);
});
