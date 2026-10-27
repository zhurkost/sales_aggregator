import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createWorkspace} from '../vps/workspace.mjs';
import {emptyListing} from '../lib/listing.ts';
const config={PUBLIC_ORIGIN:'https://autopost.test',DATA_DIR:':memory:'};
const request=(store,route,body,cookie='',origin=config.PUBLIC_ORIGIN)=>store.handle(new Request(config.PUBLIC_ORIGIN+'/api/workspace/'+route,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',cookie},...(body===undefined?{}:{body:JSON.stringify(body)})}));
async function register(store,login){const r=await request(store,'register',{login,password:'test-password-123',name:login});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];assert.match(r.headers.get('set-cookie'),/HttpOnly/);assert.match(r.headers.get('set-cookie'),/Secure/);assert.match(r.headers.get('set-cookie'),/SameSite=Strict/);return {cookie,...await r.json()};}
const ad=()=>({id:crypto.randomUUID(),revision:0,listing:{...emptyListing,category:'parts',taxonomyId:'auto.parts.optics',title:'Фара',description:'Царапина на стекле',partName:'Фара',partNumber:'000123-AB',price:'450',currency:'BYN'},photos:[],selected:['bamper','kufar-parts'],jobs:[],text:'Фара с царапиной',categoryConfirmed:true});

test('server returns only the selected category recipe and honors corrections without transferring catalogs',async()=>{
  const store=createWorkspace(config);try{
    const account=await register(store,'catalog');
    const item={listing:{...emptyListing,category:'general',taxonomyId:'onliner.286'},platforms:[{id:'kufar-general'},{id:'onliner-general'}],categoryOverrides:{onliner:'17'}};
    assert.equal((await request(store,'extension-config',{items:[item]})).status,401);
    const response=await request(store,'extension-config',{profileId:account.profile.id,items:[item]},account.cookie);
    assert.equal(response.status,200);const body=await response.json();
    assert.equal(body.recipes[0].taxonomyId,'computers.gpu');assert.equal(body.recipes[0].mappings.onliner.id,'17');
    assert.equal(body.recipes[0].mappings.kufar.attributes[0].value,'11');assert.equal(body.recipes[0].mappings.flagma,undefined);
    assert.ok(JSON.stringify(body).length<5000);
    assert.equal((await request(store,'extension-config',{items:[{...item,categoryOverrides:{onliner:'999999999'}}]},account.cookie)).status,400);
    assert.equal((await request(store,'extension-config',{profileId:'someone-else',items:[item]},account.cookie)).status,403);
  }finally{store.close();}
});
test('checked marketplace status persists with the link and rejects unknown states',async()=>{
  const store=createWorkspace(config);try{
    const account=await register(store,'status');const input=ad();input.jobs=[{platformId:'kufar-parts',status:'link_recorded',url:'https://www.kufar.by/item/123456',remoteStatus:{state:'rejected',checkedAt:new Date().toISOString(),message:'Исправьте фото'}}];
    const saved=(await (await request(store,'ads',input,account.cookie)).json()).ad;
    assert.equal(saved.jobs[0].remoteStatus.state,'rejected');
    const read=(await (await request(store,'ads/'+saved.id,undefined,account.cookie)).json()).ad;assert.equal(read.jobs[0].remoteStatus.message,'Исправьте фото');
    const updated=(await (await request(store,'ads',{...saved,jobs:[{...saved.jobs[0],remoteStatus:{...saved.jobs[0].remoteStatus,state:'invented'}}]},account.cookie)).json()).ad;
    assert.equal(updated.jobs[0].remoteStatus,undefined);
  }finally{store.close();}
});

test('private contacts merge with integration settings, validate phone, and never rewrite existing cards',async()=>{
 const store=createWorkspace(config);try{
  const a=await register(store,'contacts-a'),b=await register(store,'contacts-b');
  await request(store,'settings',{integrations:{kufar:{enabled:true,notes:'Contract'}}},a.cookie);
  const saved=await request(store,'settings',{phone:'+375 (29) 111-22-33',city:'Минск'},a.cookie);assert.equal(saved.status,200);
  assert.equal((await saved.json()).settings.integrations.kufar.enabled,true);
  const card=(await (await request(store,'ads',{...ad(),attributes:{bamper_modification:'B8',unknown:'drop'}},a.cookie)).json()).ad;
  assert.equal(card.attributes.bamper_modification,'B8');assert.equal(card.attributes.unknown,undefined);
  await request(store,'settings',{city:'Брест'},a.cookie);
  const settings=(await (await request(store,'settings',undefined,a.cookie)).json()).settings;assert.equal(settings.phone,'+375 (29) 111-22-33');assert.equal(settings.city,'Брест');
  assert.deepEqual((await (await request(store,'settings',undefined,b.cookie)).json()).settings,{});
  const restored=(await (await request(store,'ads/'+card.id,undefined,a.cookie)).json()).ad;assert.equal(restored.listing.city,'');assert.equal(restored.attributes.bamper_modification,'B8');
  assert.equal((await request(store,'settings',{phone:'invalid'},a.cookie)).status,400);
  await request(store,'settings',{phone:''},a.cookie);assert.equal((await (await request(store,'settings',undefined,a.cookie)).json()).settings.phone,'');
 }finally{store.close();}
});

test('legacy GPU cards reopen with canonical category and marketplace corrections survive saving',async()=>{
 const store=createWorkspace(config);try{
  const user=await register(store,'routing');const old={...ad(),listing:{...emptyListing,category:'general',taxonomyId:'onliner.286',title:'RX 570'},selected:['onliner-general'],categoryOverrides:{onliner:'17',kufar:'not-in-catalog'}};
  const saved=await request(store,'ads',old,user.cookie);assert.equal(saved.status,200);const record=(await saved.json()).ad;
  assert.equal(record.listing.taxonomyId,'computers.gpu');assert.deepEqual(record.categoryOverrides,{onliner:'17'});
  const restored=(await (await request(store,'ads/'+record.id,undefined,user.cookie)).json()).ad;assert.deepEqual(restored.categoryOverrides,{onliner:'17'});assert.equal(restored.listing.title,'RX 570');
 }finally{store.close();}
});
test('profiles enforce password, origin, owner isolation, concurrency and logout',async()=>{
 const store=createWorkspace(config);try{
  const alice=await register(store,'alice');const bob=await register(store,'bob');
  const denied=await request(store,'login',{login:'alice',password:'wrong-password'});assert.equal(denied.status,401);
  assert.equal((await request(store,'ads',undefined)).status,401);
  assert.equal((await request(store,'ads',ad(),alice.cookie,'https://evil.invalid')).status,403);
  assert.equal((await request(store,'ads',{...ad(),profileId:alice.profile.id},bob.cookie)).status,403);
  const original=ad();const saved=await request(store,'ads',original,alice.cookie);assert.equal(saved.status,200);const {ad:record}=await saved.json();assert.equal(record.revision,1);assert.equal(record.listing.partNumber,'000123-AB');
  const bobs=await (await request(store,'ads',undefined,bob.cookie)).json();assert.equal(bobs.ads.length,0);
  assert.equal((await request(store,'ads/'+record.id,undefined,bob.cookie)).status,404);
  const list=await (await request(store,'ads',undefined,alice.cookie)).json();assert.equal(list.ads[0].photoCount,0);assert.ok(!('photos'in list.ads[0]));
  assert.equal((await request(store,'ads',original,alice.cookie)).status,409);
  const updated=await request(store,'ads',{...record,archived:true,jobs:[{platformId:'kufar-parts',status:'link_recorded',url:'https://evil.invalid/steal',message:'test'}]},alice.cookie);assert.equal(updated.status,200);assert.equal((await updated.json()).ad.jobs[0].url,undefined);
  const session=await (await request(store,'session',undefined,alice.cookie)).json();assert.equal(session.profile.id,alice.profile.id);assert.ok(!JSON.stringify(session).includes('password'));assert.ok(!JSON.stringify(session).includes('salt'));
  await request(store,'logout',{},alice.cookie);assert.equal((await request(store,'ads',undefined,alice.cookie)).status,401);
 }finally{store.close();}
});
test('profiles, sessions and cards survive reopening the database',async()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'autopost-workspace-test-'));let store=createWorkspace({...config,DATA_DIR:directory});
 try{const alice=await register(store,'persisted');const record=ad();await request(store,'ads',record,alice.cookie);store.close();store=createWorkspace({...config,DATA_DIR:directory});const result=await (await request(store,'ads/'+record.id,undefined,alice.cookie)).json();assert.equal(result.ad.listing.partNumber,'000123-AB');}finally{store.close();const target=path.resolve(directory);assert.equal(path.dirname(target),path.resolve(tmpdir()));assert.ok(path.basename(target).startsWith('autopost-workspace-test-'));rmSync(target,{recursive:true});}
});
