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
test('profiles enforce password, origin, owner isolation, concurrency and logout',async()=>{
 const store=createWorkspace(config);try{
  const alice=await register(store,'alice');const bob=await register(store,'bob');
  const denied=await request(store,'login',{login:'alice',password:'wrong-password'});assert.equal(denied.status,401);
  assert.equal((await request(store,'ads',undefined)).status,401);
  assert.equal((await request(store,'ads',ad(),alice.cookie,'https://evil.invalid')).status,403);
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
