import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {API,readHar,importHar,newState,crawl,resultFiles,buildUrl,resumeSummary} from './core.mjs';
import {validate} from './schema.mjs';
const ui=JSON.parse(fs.readFileSync(new URL('../../../data/parsing/cars_used_sale/evidence/abw-ui-observations.json',import.meta.url)));
const opt=(id,title)=>({id,title});
const state=()=>importHar([{context:{},data:{brand:[opt(254,'Kia')]}},{context:{brand:'254'},data:{model:[opt(1691,'Rio')]}}]);
function mock({missing=false,stopAfter,secondModel=false}={}){
  const calls=[];
  return {calls,request:async raw=>{
    const q=Object.fromEntries(new URL(raw).searchParams);calls.push(q);stopAfter?.(calls.length);
    if(q.transmission)return {modification:[opt(Number(q.transmission)+900,'Версия '+q.transmission)]};
    if(q.body)return q.generation==='10'
      ? {engine:[opt(1,'бензин')],gear:[opt(2,'передний')],transmission:[opt(3,'автомат'),opt(4,'механика')]}
      : {engine:[opt(1,'бензин')],gear:[opt(2,'передний')],transmission:[opt(5,'вариатор')],modification:[opt(905,'Версия 5')]};
    if(q.generation)return {body:[opt(3402,'седан')]};
    if(q.year)return missing&&q.model==='1691'?{generation:[]}:{generation:[opt(10,'IV'),...(q.year==='139'?[opt(11,'IV Рестайлинг')]:[])]};
    if(q.model)return {year:[opt(138,'2020'),opt(139,'2021')]};
    return {model:[opt(1691,'Rio'),...(secondModel?[opt(2000,'Ceed')]:[])]};
  }};
}
test('catalog-only pass preserves flat arrays and never requests technical branches',async()=>{
  const s=state(),m=mock(),positions=[];s.flat={body:[{value:3402,name:'седан',children:[],listComplete:false}],engine:[],gear:[],transmission:[],modification:[]};const flat=structuredClone(s.flat);await crawl({state:s,request:m.request,progress:p=>positions.push(p.current)});
  assert(positions.some(p=>p?.brand==='Kia'&&p.model==='Rio'&&p.stage==='Начало модели'));
  assert(s.activity.some(p=>p.brand==='Kia'&&p.model==='Rio'&&p.stage==='Модель завершена'));
  assert.equal(s.status,'observed_scope_complete');assert.equal(s.brands[0].children[0].children.length,2);
  assert.deepEqual(s.flat,flat);assert.equal(s.collectionScope,'catalog_only_preserve_flat');
  assert.equal(m.calls.filter(q=>q.generation||q.body||q.transmission||q.engine||q.gear).length,0);
  assert(m.calls.some(q=>q.year==='138'));assert(!m.calls.some(q=>q.year==='2020'));
  assert(s.observations.every(o=>!Object.hasOwn(o.context,'year')&&o.field!=='year'));
  assert(!JSON.stringify(s.observations).includes('2020'));assert(!JSON.stringify(s.observations).includes('138'));
  assert.equal(s.completedModels.length,1);
  const files=resultFiles(s,ui);validate({schema:files['cars_used_sale_abw.json'],binding:files['binding_cars_used_sale_abw.json']});
  assert(files['binding_cars_used_sale_abw.json'].fields.every(b=>b.status==='needs_review'));
});
test('unknown no-generation branch is reported, never certified, and other models can continue',async()=>{
  const s=state();s.brands[0].listComplete=false;await crawl({state:s,request:mock({missing:true,secondModel:true}).request});
  assert.equal(s.status,'observed_scope_with_gaps');assert.equal(s.completedModels.length,1);
  assert.equal(s.brands[0].children[1].listComplete,true);
  assert.equal(s.brands[0].children[0].listComplete,false);assert.equal(s.issues[0].kind,'coverage');
});
test('stop and resume preserve completed models and never persist a year cursor',async()=>{
  const s=state();let stop=false;const m=mock({stopAfter:n=>{if(n===2)stop=true;}});
  await assert.rejects(crawl({state:s,request:m.request,stopped:()=>stop}),/Остановлено/);
  assert.equal(s.status,'paused');assert.equal(s.completedModels.length,0);
  await crawl({state:s,request:mock().request});assert.equal(s.completedModels.length,1);
  const resumed=mock();await crawl({state:s,request:resumed.request});assert.equal(resumed.calls.length,0);
});
test('offline HAR reads only public brand options from VIN response and ignores upload, headers, advert and selected years',()=>{
  const entry=(url,json,method='GET')=>({request:{url,method,headers:[{name:'authorization',value:'PRIVATE_TOKEN'}]},response:{status:200,content:{text:JSON.stringify(json)}}});
  const h={log:{entries:[
    entry('https://b.abw.by/api/v2/create/vin/1HGCM82633A004352',{options:{brand:[opt(254,'Kia')],year:[opt(138,'2020')]},advert:{phone:'PRIVATE_PHONE',name:'PRIVATE_NAME'},preview:'PRIVATE_PHOTO'}),
    entry(API+'?brand=254',{model:[opt(1691,'Rio')]}),entry(API+'?brand=254&model=1691',{year:[opt(138,'2020')]}),
    entry('https://b.abw.by/uploader/image',{url:'PRIVATE_PHOTO'},'POST')
  ]}};
  const s=importHar(readHar(h)),text=JSON.stringify(s);
  assert(!text.includes('PRIVATE'));assert(!text.includes('1HGCM'));assert(!text.includes('2020'));assert(!text.includes('138'));
  assert.equal(s.rootComplete,true);assert.equal(s.brands[0].value,254);assert.equal(s.requests,0);
});
test('GET URL builder accepts only observed catalog parameters and numeric codes; no new endpoints',()=>{
  assert(buildUrl({brand:254,model:1691,year:138,generation:10,body:3402}).startsWith(API+'?'));
  assert.throws(()=>buildUrl({brand:254,model:1691,year:138,generation:10,body:3402,engine:1,gear:2,transmission:3}));
  assert.throws(()=>buildUrl({brand:254,vin:'PRIVATE'}));assert.throws(()=>buildUrl({brand:'https://other.example'}));
  assert.throws(()=>buildUrl({brand:254,phone:'PRIVATE'}));
});
test('seed gaps, photo recommendation and label IDs survive enrichment without inventing geography or limits',()=>{
  const empty=resultFiles(newState(),ui)['cars_used_sale_abw.json'];
  const enriched=resultFiles(state(),ui)['cars_used_sale_abw.json'];
  const f=(s,k)=>s[0].options.find(f=>f.id==='abw.'+k);
  assert.equal(f(empty,'brand').options[0].id,f(enriched,'brand').options[0].id);
  assert.deepEqual(f(enriched,'city').options,[]);assert.equal(f(enriched,'city').options_complete,false);
  assert(!f(enriched,'photo').validation?.max_items);assert.equal(f(enriched,'photo').file_role,'product_image');
});
test('extension is isolated from AV; no page injection, draft, upload or publication transport',()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('./extension/manifest.json',import.meta.url)));
  assert.deepEqual(manifest.host_permissions,['https://b.abw.by/*']);assert.deepEqual(manifest.permissions,['storage','unlimitedStorage']);
  const app=fs.readFileSync(new URL('./extension/app.mjs',import.meta.url),'utf8');
  assert(app.includes("storageKey='abwResearchV1'"));assert(!app.includes('avResearch'));
  assert(app.includes("method:'GET'"));assert(app.includes("redirect:'error'"));assert(app.includes("credentials:'omit'"));
  assert(!/\/uploader|\/draft|\/publish|\/create\/vin/.test(app));
  assert(app.includes("navigator.locks.request('abw-catalog-crawler'"));
});


test('network error saves every response and same-tab resume skips successful requests inside a model',async()=>{
  let s=state(),snapshot;const responseCache=new Map(),first=mock();let attempts=0;
  const save=async value=>{snapshot=structuredClone(value);};
  await assert.rejects(crawl({state:s,responseCache,save,request:async url=>{
    if(++attempts===3)throw Error('HTTP 503');return first.request(url);
  }}),/HTTP 503/);
  assert.equal(snapshot.requests,2);assert.equal(snapshot.status,'blocked');
  assert.equal(snapshot.brands[0].children[0].children.length,1);assert.equal(snapshot.completedModels.length,0);
  assert(!JSON.stringify(snapshot).includes('2020'));
  assert(snapshot.observations.every(o=>!Object.hasOwn(o.context,'year')));
  s=structuredClone(snapshot);const next=mock();
  await crawl({state:s,responseCache,save,request:next.request});
  const previous=new Set(first.calls.map(q=>JSON.stringify(q)));
  assert(next.calls.every(q=>!previous.has(JSON.stringify(q))));
  assert.equal(s.completedModels.length,1);assert.equal(s.requests,first.calls.length+next.calls.length);
});

test('storage failure stops further requests and preserves newest in-memory results',async()=>{
  const s=state(),m=mock();
  await assert.rejects(crawl({state:s,request:m.request,save:async()=>{throw Error('Storage unavailable');}}),/Storage unavailable/);
  assert.equal(m.calls.length,0);assert.equal(s.requests,0);assert.equal(s.status,'blocked');
  assert(s.brands[0].children.length>0);
});


test('parallel year branches preserve all generations and drain work before error checkpoint',async()=>{
  const s=state(),m=mock();let active=0,peak=0;const snapshots=[];
  await crawl({state:s,concurrency:3,save:async value=>snapshots.push(structuredClone(value)),request:async url=>{
    active++;peak=Math.max(peak,active);
    await new Promise(r=>setTimeout(r,2));
    try{const q=Object.fromEntries(new URL(url).searchParams);
      if(q.year){return {generation:[opt(Number(q.year),'generation '+q.year)]};}
      return await m.request(url);
    }finally{active--;}
  }});
  assert.equal(peak,2);assert.equal(active,0);
  assert.deepEqual(s.brands[0].children[0].children.map(o=>o.value).sort(),[138,139]);assert.equal(s.completedModels.length,1);
  assert(s.observations.every(o=>!Object.hasOwn(o.context,'year')));
  const failed=state();let live=0,activeAtFinalSave=-1;
  await assert.rejects(crawl({state:failed,concurrency:3,request:async url=>{
    live++;const q=Object.fromEntries(new URL(url).searchParams);
    try{await new Promise(r=>setTimeout(r,q.year==='139'?6:1));
      if(q.year==='138')throw Error('HTTP 429');return await m.request(url);
    }finally{live--;}
  },save:async value=>{if(value.status==='blocked')activeAtFinalSave=live;}}),/HTTP 429/);
  assert.equal(activeAtFinalSave,0);assert.equal(failed.completedModels.length,0);assert.equal(live,0);
});


test('resume skips existing coverage problems; explicit retry collects generations without technical fields',async()=>{
  const s=state();s.brands[0].children.push({name:'Ceed',value:2000,children:[],listComplete:false});
  s.issues.push({kind:'coverage',modelKey:'number:254/number:1691',brand:'Kia',model:'Rio',message:'В ответе отсутствует gear'});
  assert.equal(resumeSummary(s).next.model,'Ceed');
  const first=mock();await crawl({state:s,request:first.request});
  assert(first.calls.every(q=>q.model==='2000'));assert.equal(s.completedModels.length,1);
  assert.equal(s.status,'observed_scope_with_gaps');assert.equal(s.issues.length,1);
  const retry=mock();await crawl({state:s,request:retry.request,retryReview:true});
  assert(retry.calls.every(q=>q.model==='1691'));assert.equal(s.completedModels.length,2);
  assert.equal(s.status,'observed_scope_complete');assert.equal(s.issues.length,0);
  assert(retry.calls.every(q=>!q.generation&&!q.body));
});
