const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function worker(platform = 'realt') {
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
  const recipe=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/rental/apartments_long_term_rent/runtime/browser_'+platform+'.json'),'utf8'));
  const request=(type,id)=>context.AutopostRentalBackground.handle({kind:'RENTAL_REQUEST',type,userGesture:true,
    payload:{id,profileId:'owner',revision:1,mode:'automatic',card:{values:{}},jobs:[recipe],photos:[]}},
    {url:'http://localhost:5173/',tab:{id:999}});
  return {request,tabs,photos,state:()=>structuredClone(stored['autopost-rental-jobs-v1'])};
}

test('Onliner login is actionable and status polling preserves the pending fill authorization',async()=>{
  const w=worker('onliner');
  await w.request('RENTAL_RUN','login');
  const tab=[...w.tabs.values()][0], start=tab.url;
  tab.url='https://profile.onliner.by/login?redirect='+encodeURIComponent(start);
  const status=await w.request('RENTAL_STATUS','login');
  assert.equal(status.jobs[0].status,'needs_action');
  assert.match(status.jobs[0].message,/Войдите.*Onliner/);
  assert.equal(w.state()[0].jobs[0].fillPending,true);
  assert.equal(w.state()[0].jobs[0].fillDocumentId,null);
  tab.url=start;
  assert.equal((await w.request('RENTAL_STATUS','login')).jobs[0].status,'running');
  assert.equal(w.state()[0].jobs[0].fillPending,true);
});

test('closed tabs are reported without resuming a stopped launch',async()=>{
  const w=worker();
  await w.request('RENTAL_RUN','closed');
  w.tabs.clear();
  const status=await w.request('RENTAL_STATUS','closed');
  assert.equal(status.jobs[0].status,'needs_action');
  assert.match(status.jobs[0].message,/закрыта.*Открыть/);
  await w.request('RENTAL_STOP','closed');
  const stopped=await w.request('RENTAL_STATUS','closed');
  assert.equal(stopped.jobs[0].status,'stopped');
  assert.equal(stopped.jobs[0].message,'Остановлено в Автопосте');
});

test('status only inspects the requested card and recognizes the exact login origin',async()=>{
  const w=worker('onliner');
  await w.request('RENTAL_RUN','one');
  await w.request('RENTAL_RUN','two');
  const [one,two]=[...w.tabs.values()];
  one.url='https://profile.onliner.by.example.com/login';
  two.url='https://profile.onliner.by/login';
  assert.equal((await w.request('RENTAL_STATUS','one')).jobs[0].status,'running');
  assert.equal(w.state()[1].jobs[0].status,'running');
  assert.equal((await w.request('RENTAL_STATUS','two')).jobs[0].status,'needs_action');
  await w.request('RENTAL_STOP','two');
  assert.equal((await w.request('RENTAL_STATUS','two')).jobs[0].status,'stopped');
});

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
