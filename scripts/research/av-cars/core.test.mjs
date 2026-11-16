import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {API,parseHar,importRecords,newState,crawl,resultFiles,stats,requestBody} from './core.mjs';
import {build,OUTPUT,validate} from './seed.mjs';
const read=n=>JSON.parse(fs.readFileSync(path.join(OUTPUT,'evidence',n),'utf8'));
const seed=()=>build(read('av-historical-recovery.json'),read('av-video-observations.json'));
const opt=(id,label)=>({id,label,intValue:id,disabled:false});
const prop=(name,options=[],extra={})=>({name,id:1,label:name,fallbackType:'select',options,visible:true,required:true,...extra});
const initial={formSteps:[{rows:[{properties:[prop('brand',[opt(545,'Kia')]),prop('place_region',[opt(1001,'Брестская обл.')]),prop('price_currency',[opt(1,'BYN'),opt(2,'USD')]),prop('exchange_options',[opt(1,'не интересует')])]}]}]};
initial.formSteps[0].rows[0].properties.push(prop('body_type',[opt(5,'седан'),opt(3,'хэтчбек')]),prop('transmission_type',[opt(1,'автомат'),opt(2,'механика')]),prop('engine_type',[opt(1,'бензин')]),prop('drive_type',[opt(1,'передний привод')]),prop('modification',[opt(999,'Не собирать')]));
function transport({fail=false,stopAfter}={}){
  const calls=[];
  const request=async(method,body)=>{
    calls.push({method,body});if(method==='GET')return structuredClone(initial);
    const p=Object.fromEntries(body.properties.map(p=>[p.name,p.value]));
    const changed=body.properties.find(p=>p.modified).name;
    let properties=[];
    if(changed==='brand')properties=[prop('model',[opt(563,'Rio')])];
    if(changed==='model')properties=[prop('year',[opt(2019,'2019'),opt(2020,'2020')])];
    if(changed==='year')properties=fail?[]:[prop('generation',[opt(3815,'IV'),...(p.year===2020?[opt(11765,'IV · Рестайлинг')]:[])])];
    if(changed==='generation')properties=[prop('body_type',[opt(5,'седан')])];
    if(changed==='body_type')properties=[prop('transmission_type',[opt(2,'механика')])];
    if(changed==='transmission_type')properties=[prop('engine_type',[opt(1,'бензин')])];
    if(changed==='engine_type')properties=[prop('drive_type',[opt(1,'передний привод')])];
    if(changed==='drive_type')properties=[prop('modification',[opt(p.year===2019?10:11,'Модификация '+p.year)])];
    if(changed==='place_region')properties=[prop('place_city',[opt(8,'Брест')])];
    stopAfter?.(calls.length);
    return {properties};
  };
  return {calls,request};
}
test('collect generations across years and flat root dictionaries without any technical traversal',async()=>{
  const state=newState(),t=transport(),positions=[];await crawl({state,request:t.request,progress:s=>positions.push(s.current)});
  assert(positions.some(p=>p?.brand==='Kia'&&p.model==='Rio'&&p.stage==='Начало модели'));
  assert(state.activity.some(p=>p.brand==='Kia'&&p.model==='Rio'&&p.stage==='Модель завершена'));
  assert.equal(state.status,'complete');assert.equal(stats(state).generations,2);assert.equal(stats(state).cities,1);
  assert.equal(state.fields.modification.options.length,0);
  assert.equal(t.calls.filter(c=>c.body?.properties.some(p=>p.name==='year'&&p.modified)).length,2);
  assert.equal(t.calls.filter(c=>c.body?.properties.some(p=>p.name==='drive_type'&&p.modified)).length,0);
  assert.equal(state.completedModels.length,1);
  const yearObjects=state.variants.filter(v=>v.property.name==='year');assert.equal(yearObjects.length,0);
  assert.deepEqual(state.fields.year.options,[]);
  assert(state.variants.every(v=>!Object.hasOwn(v.context,'year')));
  const count=t.calls.length;await crawl({state,request:t.request});
  assert.equal(t.calls.length-count,2); // refresh root + used condition, completed model skipped
});
test('missing generation response blocks, checkpoints and never certifies a partial model',async()=>{
  const state=newState(),t=transport({fail:true});let saved;
  await assert.rejects(crawl({state,request:t.request,save:async s=>saved=structuredClone(s)}),/generation/);
  assert.equal(saved.status,'blocked');assert.equal(saved.completedModels.length,0);assert.equal(saved.brands[0].children[0].list_complete,false);
});
test('all technical selection requests are absent and legacy modification data is preserved without additions',async()=>{
  const state=newState(),t=transport();
  state.fields.modification={name:'modification',options:[{id:77,name:'Старый вариант',value:77,disabled:false}]};
  await crawl({state,request:t.request});
  const forbidden=new Set(['generation','body_type','transmission_type','engine_type','drive_type','modification']);
  assert(!t.calls.some(c=>c.body?.properties.some(p=>p.modified&&forbidden.has(p.name))));
  assert.equal(state.fields.body_type.options.length,2);
  assert.deepEqual(state.fields.modification.options.map(o=>o.value),[77]);
  const s=seed(),files=resultFiles(state,s.schema,s.binding);
  assert.equal(files['cars_used_sale_av.json'][0].options.find(f=>f.id==='av.modification').options_complete,false);
  assert.equal(state.collectionScope,'without_modifications');
});
test('stop and resume restart an incomplete model without persisting a year cursor',async()=>{
  const state=newState();let stopped=false;
  const first=transport({stopAfter:n=>{if(n===9)stopped=true;}});
  await assert.rejects(crawl({state,request:first.request,stopped:()=>stopped}),/Остановлено/);
  assert.equal(state.status,'paused');assert.equal(state.completedModels.length,0);
  const resumed=transport();await crawl({state,request:resumed.request});
  assert.equal(state.status,'complete');assert.equal(stats(state).generations,2);
});
test('HAR parsing retains only schema metadata; keys, personal values and year arrays never reach state',()=>{
  const response=structuredClone(initial);
  response.advert={name:'PRIVATE_NAME',phone:'PRIVATE_PHONE'};
  response.formSteps[0].rows[0].properties.push(prop('year',[opt(2020,'2020')]),prop('name',[],{value:'PRIVATE_NAME'}),prop('phones',[],{value:'PRIVATE_PHONE'}));
  const h={log:{entries:[{request:{url:API,method:'GET',headers:[{name:'x-api-key',value:'PRIVATE_KEY'}]},response:{status:200,content:{text:JSON.stringify(response)}}}]}};
  const parsed=parseHar(h),state=importRecords(parsed.records),text=JSON.stringify(state);
  assert.equal(parsed.headers['x-api-key'],'PRIVATE_KEY');assert(!text.includes('PRIVATE_'));assert.deepEqual(state.fields.year.options,[]);
  assert(!text.includes('yearFrom'));assert(!text.includes('yearTo'));
});
test('base64 HAR decodes Cyrillic as UTF-8 and year ranges are removed from checkpoints',()=>{
  const response=structuredClone(initial);
  response.formSteps[0].rows[0].properties.push(prop('year',[opt(2020,'2020')],{constraints:[{type:'int_min',min:1900},{type:'int_max',max:2026}]}));
  const har={log:{entries:[{request:{url:API,headers:[]},response:{status:200,content:{encoding:'base64',text:Buffer.from(JSON.stringify(response)).toString('base64')}}}]}};
  const state=importRecords(parseHar(har).records);
  assert.equal(state.regions[0].name,'Брестская обл.');
  assert.deepEqual(state.fields.year.options,[]);
  assert.deepEqual(state.fields.year.constraints,[]);
});
test('request construction excludes contact, draft and financial data from contexts',()=>{
  const body=requestBody({brand:545,phone:'PRIVATE',vin:'PRIVATE',price_amount:123456789},'brand');
  assert(!JSON.stringify(body).includes('PRIVATE'));assert(!body.properties.some(p=>p.name==='price_amount'));
  assert.equal(body.properties.find(p=>p.name==='brand').modified,true);
  assert.throws(()=>requestBody({phone:'PRIVATE'},'phone'),/Недопустимое/);
});
test('result preserves local IDs, uses native numeric codes, contains only the two trees, and cannot promote binding',async()=>{
  const state=newState();await crawl({state,request:transport().request});
  const s=seed(),files=resultFiles(state,s.schema,s.binding),category=files['cars_used_sale_av.json'];
  const kia=category[0].options.find(f=>f.id==='av.brand').options[0];
  assert.equal(kia.id,s.schema[0].options.find(f=>f.id==='av.brand').options[0].id);assert.equal(kia.value,545);
  assert.equal(kia.childOptions[0].childOptions.length,2);
  assert(files['binding_cars_used_sale_av.json'].fields.every(f=>f.status!=='ready'));
  validate({schema:category,binding:files['binding_cars_used_sale_av.json']});
});
test('packaged transport has no mutation endpoints or credential persistence',()=>{
  const app=fs.readFileSync(new URL('./extension/app.mjs',import.meta.url),'utf8');
  assert(!/\/(?:draft|check|publish|billing)(?:[/?'"]|$)/.test(app));
  assert(app.includes("redirect:'error'"));assert(app.includes('avResearch:value'));
  const manifest=JSON.parse(fs.readFileSync(new URL('./extension/manifest.json',import.meta.url),'utf8'));
  assert.deepEqual(manifest.host_permissions,['https://web-api.av.by/*']);
  assert(!manifest.permissions.includes('cookies'));assert(!manifest.permissions.includes('debugger'));
});
