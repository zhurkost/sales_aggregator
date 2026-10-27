import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {createWorkspace} from '../vps/workspace.mjs';
import {emptyListing} from '../lib/listing.ts';
import {readiness,availablePlatforms,queueGroup} from '../lib/readiness.ts';
import {editListing,emptyBatchEdit} from '../lib/batch-edit.ts';
import {readYml} from '../lib/catalog-import.ts';
import {publicIPv4,fetchFeed} from '../vps/feed.mjs';
import {POST} from '../app/api/analyze/route.ts';
import {runWithAISettings} from '../lib/ai-context.ts';
const origin='https://autopost.test';
const req=(s,path,body,cookie='',workspace='')=>s.handle(new Request(origin+'/api/workspace/'+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',cookie,...(workspace?{'x-autopost-workspace':workspace}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}));
async function account(s,login){const r=await req(s,'register',{login,password:'test-password-123',name:login});assert.equal(r.status,200);return {...await r.json(),cookie:r.headers.get('set-cookie').split(';')[0]};}
async function save(s,ad,cookie){const r=await req(s,'ads',ad,cookie);assert.equal(r.status,200,await r.clone().text());return (await r.json()).ad;}
const card=()=>({id:crypto.randomUUID(),revision:0,listing:{...emptyListing,category:'general',taxonomyId:'computers.gpu',title:'RX 570',description:'Проверенная карта',price:'150',currency:'BYN',city:'Минск',phone:'+375291234567'},photos:[{id:'p1',name:'gpu.jpg',dataUrl:'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2Q=='}],selected:['kufar-general','onliner-general'],prepared:true,categoryConfirmed:true,archived:false,jobs:[],events:[]});

test('readiness is per platform, does not invent account access and excludes already launched jobs',()=>{
 const r=card();r.jobs=[{platformId:'kufar-general',status:'review_required',message:'Проверка'}];
 const rows=readiness(r,true);assert.equal(rows.length,2);assert.equal(rows[0].existing,true);assert.deepEqual(availablePlatforms(r),['onliner-general']);
 assert.ok(rows.every(p=>p.notes.some(n=>n.includes('Вход в аккаунт'))));assert.ok(readiness(r,false).every(p=>p.blockers.includes('Подключите расширение')));
 assert.equal(queueGroup({url:'https://www.kufar.by/item/1',status:'link_recorded',remoteStatus:{state:'rejected'}}),'attention');
});
test('server reservations prevent double clicks, concurrent tabs and browser restarts; failed multi-item reservations roll back',async()=>{
 const s=createWorkspace({PUBLIC_ORIGIN:origin,DATA_DIR:':memory:'});try{
  const a=await account(s,'reservations');let r=await save(s,card(),a.cookie);
  r=await save(s,{...r,batchId:'batch1',jobs:[{platformId:'kufar-general',batchId:'batch1',status:'ready'}]},a.cookie);
  const item={recordId:r.id,batchId:'batch1',listing:r.listing,photoIds:r.photos.map(p=>p.id),platforms:[{id:'kufar-general'}]};
  let res=await req(s,'extension-config',{profileId:a.profile.id,reserve:true,items:[item]},a.cookie);assert.equal(res.status,200);
  assert.equal((await req(s,'extension-config',{profileId:a.profile.id,verify:true,items:[item]},a.cookie)).status,200);
  r=await save(s,{...r,listing:{...r.listing,price:'175'}},a.cookie);
  assert.equal((await req(s,'extension-config',{profileId:a.profile.id,verify:true,items:[item]},a.cookie)).status,400,'queued snapshot cannot submit an outdated price');
  assert.equal((await req(s,'extension-config',{reserve:true,items:[item]},a.cookie)).status,400,'same batch cannot be replayed after lost response');
  const freshCard=await save(s,{...card(),batchId:'batch2',jobs:[{platformId:'kufar-general',batchId:'batch2',status:'ready'}]},a.cookie);
  const fresh={...item,recordId:freshCard.id,batchId:'batch2'};
  assert.equal((await req(s,'extension-config',{reserve:true,items:[fresh,{...item,batchId:'new'}]},a.cookie)).status,400);
  assert.equal((await req(s,'extension-config',{reserve:true,items:[fresh]},a.cookie)).status,200,'first reservation rolled back with rejected second item');
  r=await save(s,{...r,batchId:'batch1',jobs:[{platformId:'kufar-general',batchId:'batch1',status:'link_recorded',url:'https://www.kufar.by/item/12345',message:'Готово'}]},a.cookie);
  assert.equal((await req(s,'ads',{...r,batchId:'different',jobs:[{platformId:'kufar-general',batchId:'different',status:'opening'}]},a.cookie)).status,409);
  const kept=await save(s,{...r,jobs:[]},a.cookie);assert.equal(kept.jobs[0].url,r.jobs[0].url);
 }finally{s.close();}
});
test('reimport updates only mapped nonempty fields and preserves links, photos, category, ownership; source IDs isolate catalogs',async()=>{
 const s=createWorkspace({PUBLIC_ORIGIN:origin,DATA_DIR:':memory:'});try{
  const a=await account(s,'imports');const b=await account(s,'private');const incoming={...card(),externalId:'000123'};
  const first=(await (await req(s,'import',{sourceId:'crm',record:incoming,fields:['price','title']},a.cookie)).json()).ad;
  const linked=await save(s,{...first,jobs:[{platformId:'kufar-general',status:'link_recorded',url:'https://www.kufar.by/item/1234',message:'Готово'}]},a.cookie);
  const updated=await req(s,'import',{sourceId:'crm',expectedRevision:linked.revision,record:{...incoming,photos:[],listing:{...incoming.listing,title:'',price:'200',phone:'wrong',taxonomyId:'auto.cars'}},fields:['price','title']},a.cookie);
  assert.equal(updated.status,200);const r=(await updated.json()).ad;assert.equal(r.id,linked.id);assert.equal(r.listing.price,'200');assert.equal(r.listing.title,'RX 570');assert.equal(r.listing.taxonomyId,'computers.gpu');assert.equal(r.photos.length,1);assert.equal(r.jobs[0].url,linked.jobs[0].url);
  assert.equal((await req(s,'import',{sourceId:'crm',expectedRevision:linked.revision,record:incoming,fields:['price']},a.cookie)).status,409);
  assert.equal((await req(s,'import',{sourceId:'crm',expectedRevision:r.revision,record:{...incoming,listing:{...incoming.listing,currency:''}},fields:['price','currency']},a.cookie)).status,400,'unsupported currencies cannot relabel an updated price');
  assert.equal((await req(s,'import',{sourceId:'crm',expectedRevision:r.revision,record:{...incoming,listing:{...incoming.listing,currency:'USD',price:''}},fields:['currency']},a.cookie)).status,400,'currency changes require a matching price');
  const other=(await (await req(s,'import',{sourceId:'crm2',record:{...incoming,id:crypto.randomUUID()},fields:['price']},a.cookie)).json()).ad;assert.notEqual(other.id,r.id);
  assert.equal((await req(s,'ads/'+r.id,undefined,b.cookie)).status,404);
  assert.equal((await (await req(s,'ads',undefined,a.cookie)).json()).ads.length,2);
 }finally{s.close();}
});
test('bulk edit is atomic on revisions; versions restore content without changing photos or publication links',async()=>{
 const s=createWorkspace({PUBLIC_ORIGIN:origin,DATA_DIR:':memory:'});try{
  const a=await account(s,'history');const first=await save(s,card(),a.cookie),second=await save(s,card(),a.cookie);
  const edit={...emptyBatchEdit,priceMode:'percent',priceValue:'-10',city:'Брест'};
  assert.equal((await req(s,'batch-edit',{items:[{id:first.id,revision:1},{id:second.id,revision:999}],edit},a.cookie)).status,409);
  assert.equal((await (await req(s,'ads/'+first.id,undefined,a.cookie)).json()).ad.listing.price,'150');
  assert.equal((await req(s,'batch-edit',{items:[{id:first.id,revision:1},{id:second.id,revision:1}],edit},a.cookie)).status,200);
  let r=(await (await req(s,'ads/'+first.id,undefined,a.cookie)).json()).ad;assert.equal(r.listing.price,'135');assert.equal(r.contentVersion,2);
  r=await save(s,{...r,jobs:[{platformId:'kufar-general',status:'link_recorded',url:'https://www.kufar.by/item/56789'}]},a.cookie);
  const versions=(await (await req(s,'ads/'+r.id+'/versions',undefined,a.cookie)).json()).versions;assert.equal(versions.length,1);assert.equal(versions[0].data.listing.price,'150');assert.equal(versions[0].data.photos,undefined);
  const restored=await req(s,'ads/'+r.id+'/versions',{version:1,revision:r.revision},a.cookie);assert.equal(restored.status,200);const result=(await restored.json()).ad;assert.equal(result.listing.price,'150');assert.equal(result.jobs[0].url,r.jobs[0].url);assert.equal(result.photos[0].dataUrl,r.photos[0].dataUrl);assert.equal(result.contentVersion,3);
  assert.throws(()=>editListing(first.listing,{...edit,priceValue:'-100'}));
 }finally{s.close();}
});
test('team access is explicit, owner-only, revocable and separate from personal cards; stale tabs cannot write into another workspace',async()=>{
 const s=createWorkspace({PUBLIC_ORIGIN:origin,DATA_DIR:':memory:'});try{
  const a=await account(s,'owner'),b=await account(s,'manager'),c=await account(s,'outsider');
  const r=await save(s,card(),a.cookie),privateCard=await save(s,card(),b.cookie);
  assert.equal((await req(s,'team',{action:'switch',workspaceId:a.profile.id},b.cookie)).status,403);
  assert.equal((await req(s,'team',{action:'add',login:'manager'},a.cookie)).status,200);
  assert.equal((await req(s,'team',{action:'switch',workspaceId:a.profile.id},b.cookie)).status,200);
  assert.equal((await req(s,'ads/'+r.id,undefined,b.cookie)).status,200);assert.equal((await req(s,'ads/'+privateCard.id,undefined,b.cookie)).status,404);
  assert.equal((await req(s,'ads',card(),b.cookie,b.profile.id)).status,409);
  assert.equal((await req(s,'team',{action:'add',login:'outsider'},b.cookie)).status,403);
  const edited=await save(s,{...r,assigneeId:b.profile.id,listing:{...r.listing,price:'170'}},b.cookie);assert.equal(edited.assigneeId,b.profile.id);assert.equal(edited.events.at(-1).actor,'manager');
  assert.equal((await req(s,'ads/'+r.id,undefined,c.cookie)).status,404);
  await req(s,'team',{action:'remove',memberId:b.profile.id},a.cookie);
  assert.equal((await req(s,'ads/'+r.id,undefined,b.cookie)).status,404);assert.equal((await req(s,'ads/'+privateCard.id,undefined,b.cookie)).status,200);
 }finally{s.close();}
});
test('notifications record new exceptions once and read state is workspace-scoped',async()=>{
 const s=createWorkspace({PUBLIC_ORIGIN:origin,DATA_DIR:':memory:'});try{
  const a=await account(s,'notices'),b=await account(s,'other-notices');let r=await save(s,card(),a.cookie);
  r=await save(s,{...r,jobs:[{platformId:'kufar-general',status:'authorization_required',message:'Нужен вход'}]},a.cookie);
  r=await save(s,r,a.cookie);
  let notices=(await (await req(s,'notifications',undefined,a.cookie)).json()).notifications;assert.equal(notices.length,1);assert.equal(notices[0].seen,0);
  await req(s,'notifications',{ids:[notices[0].id]},b.cookie);assert.equal((await (await req(s,'notifications',undefined,a.cookie)).json()).notifications[0].seen,0);
  notices=(await (await req(s,'notifications',{ids:[notices[0].id]},a.cookie)).json()).notifications;assert.equal(notices[0].seen,1);
 }finally{s.close();}
});
test('YML preserves leading zeros, text and photo references; rejects entities, malformed and foreign XML; private feed addresses are rejected',async()=>{
 const win=new Window();const previous=globalThis.DOMParser;globalThis.DOMParser=win.DOMParser;
 try{const table=readYml('<yml_catalog><shop><offers><offer id="00001"><name>RX 570</name><price>150,50</price><currencyId>BYN</currencyId><vendorCode>0002</vendorCode><picture>https://example.com/gpu.jpg</picture><param name="Память">4 GB</param></offer></offers></shop></yml_catalog>');assert.equal(table.rows[0].externalId,'00001');assert.equal(table.rows[0].price,'150.50');assert.equal(table.rows[0].partNumber,'0002');assert.match(table.rows[0].description,/4 GB/);assert.throws(()=>readYml('<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><yml_catalog/>'));assert.throws(()=>readYml('<html/>'));}finally{globalThis.DOMParser=previous;win.happyDOM.abort();}
 for(const ip of ['127.0.0.1','10.1.1.1','172.20.1.1','192.168.1.1','169.254.169.254','100.64.1.1','::1','0.0.0.0','224.1.2.3'])assert.equal(publicIPv4(ip),false,ip);
 assert.equal(publicIPv4('8.8.8.8'),true);
 await assert.rejects(fetchFeed('https://public.example/feed',0,async()=>[{address:'127.0.0.1'}]),/Внутренние/);
 await assert.rejects(fetchFeed('https://user:pass@example.com/'),/публичный/);
});
test('photo suggestions use a server-selected vision model, allow only bounded data images, and never directly publish or change a card',async()=>{
 const real=globalThis.fetch;let captured;
 globalThis.fetch=async(_url,init)=>{captured=JSON.parse(init.body);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({description:'Видеокарта с двумя вентиляторами',candidates:[{id:'computers.gpu'},{id:'invented'}],questions:['Укажите объём памяти']})}}]});};
 const photoRequest=body=>new Request('http://localhost:5173/api/analyze',{method:'POST',headers:{origin:'http://localhost:5173','content-type':'application/json'},body:JSON.stringify({task:'photos',text:'Опиши товар',...body})});
 try{
  const r=await runWithAISettings({AI_API_KEY:'test-server-key',AI_PROVIDER:'openrouter'},()=>POST(photoRequest({photos:[card().photos[0].dataUrl],model:'expensive/model'})));assert.equal(r.status,200);const result=await r.json();assert.deepEqual(result.candidates.map(c=>c.id),['computers.gpu']);assert.equal(captured.model,'google/gemini-3.5-flash-lite');assert.equal(captured.reasoning,undefined,'Vision endpoint requires its default reasoning mode');assert.equal(captured.messages[1].content[1].type,'image_url');assert.equal(result.listing,undefined);
  assert.equal((await POST(photoRequest({photos:['https://internal.example/photo']}))).status,400);
 }finally{globalThis.fetch=real;}
});
