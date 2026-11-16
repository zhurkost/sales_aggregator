import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateNodes,validateConfiguration,save,digest,collect,BOOTSTRAP,catalogUrl} from './collect.mjs';
import {catalogTree} from './normalize.mjs';
import {validate} from './validate.mjs';
import {auditCatalog} from './audit.mjs';

const node=(value,name,type)=>({value,labels:{ru:name},params:{node_type:type,name:{mark:'cars_brand_v2',model:'cars_model_v2',generation:'cars_gen_v2'}[type]}});
function removeTemporary(dir){
  const resolved=path.resolve(dir);
  if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('kufar-catalog-test-'))throw Error('Unexpected temporary directory');
  fs.rmSync(resolved,{recursive:true,force:true});
}
const state=()=>({brands:[{node:node('category_2010.mark_kia','Kia','mark'),complete:true,models:[{node:node('category_2010.mark_kia.model_rio','Rio','model'),complete:true,generations:[node('category_2010.mark_kia.model_rio.generation_iv','IV Рестайлинг','generation')]}]}]});
test('native IDs and every level are preserved, years never become a level',()=>{
  const s=state();s.brands[0].models[0].generations[0].params.start_year=2020;
  const tree=catalogTree(s),model=tree[0].childOptions[0],generation=model.childOptions[0];
  assert.equal(tree[0].value,'category_2010.mark_kia');assert.equal(model.level,'kufar.cars_model_v2');assert.equal(generation.level,'kufar.cars_gen_v2');
  assert.deepEqual(generation.childOptions,[]);assert.equal(generation.options_complete,true);assert.ok(!JSON.stringify(tree).includes('2020'));
});
test('known empty and unvisited branches remain distinguishable',()=>{
  const s=state();s.brands[0].models[0].generations=[];
  assert.equal(catalogTree(s)[0].childOptions[0].options_complete,true);
  s.brands[0].models[0].complete=false;
  assert.equal(catalogTree(s)[0].childOptions[0].options_complete,false);
});
test('audit preserves homonyms but detects a changed native code or ancestry',()=>{
  const s=state(),model=s.brands[0].models[0];
  model.generations.push(node(model.node.value+'.generation_iv_other','IV Рестайлинг','generation'));
  const schema=[{options:[{id:'kufar.cars_brand_v2',options:catalogTree(s)}]}];
  const a=auditCatalog(s,schema);assert.equal(a.ambiguous_sibling_names.length,1);assert.equal(a.source_nodes,4);
  schema[0].options[0].options[0].childOptions[0].childOptions[0].value='wrong';
  assert.throws(()=>auditCatalog(s,schema),/Changed/);
});
test('reject cross-parent contamination, duplicate native IDs and wrong level',()=>{
  const n=node('category_2010.mark_kia.model_rio','Rio','model');
  assert.throws(()=>validateNodes([n],'category_2010.mark_audi','model'));
  assert.throws(()=>validateNodes([n,n],'category_2010.mark_kia','model'));
  assert.throws(()=>validateNodes([n],'category_2010.mark_kia','generation'));
  assert.throws(()=>validateNodes({items:[n]},'category_2010.mark_kia','model'));
  assert.deepEqual(validateNodes([],'category_2010.mark_kia','model'),[]);
});
test('rate/request configuration rejects NaN, negative and faster-than-policy intervals',()=>{
  for(const interval of [0,999,NaN,Infinity])assert.throws(()=>validateConfiguration({interval}));
  for(const maxRequests of [-1,1.1,NaN])assert.throws(()=>validateConfiguration({maxRequests}));
  validateConfiguration({interval:1000,maxRequests:0});
});
test('known Rio X metadata anomaly is narrow and preserves the original response',()=>{
  const tag='category_2010.mark_kia.model_riox';
  const n=node(tag+'.generation_riox_i_2020','I','generation');n.params.node_type='model';
  assert.equal(validateNodes([n],tag,'generation')[0].params.node_type,'model');
  assert.throws(()=>validateNodes([{...n,value:tag+'.generation_unknown'}],tag,'generation'));
  assert.throws(()=>validateNodes([{...n,params:{...n.params,name:'cars_model_v2'}}],tag,'generation'));
});
test('cached crawl resumes without HTTP and detects tampering',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kufar-catalog-test-'));
  try{
    const s=state();
    const cache=(url,data)=>save(path.join(dir,'cache',digest(url)+'.json'),{url,data,sha256:digest(JSON.stringify(data)),observedAt:'2026-11-12T00:00:00Z'});
    cache(BOOTSTRAP,{ad_metadata:{}});
    cache(catalogUrl('category_2010'),s.brands.map(b=>b.node));
    cache(catalogUrl(s.brands[0].node.value),s.brands[0].models.map(m=>m.node));
    let partial=await collect({directory:dir,maxRequests:0});assert.equal(partial.complete,false);assert.equal(partial.brands[0].models[0].complete,false);
    cache(catalogUrl(s.brands[0].models[0].node.value),s.brands[0].models[0].generations);
    let full=await collect({directory:dir,maxRequests:0});assert.equal(full.complete,true);assert.equal(full.requests,0);
    const file=path.join(dir,'cache',digest(BOOTSTRAP)+'.json');const x=JSON.parse(fs.readFileSync(file));x.data.changed=true;save(file,x);
    await assert.rejects(()=>collect({directory:dir,maxRequests:0}),/Corrupt cache/);
  }finally{removeTemporary(dir);}
});
test('Retry-After and minimum start interval are respected without real network',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kufar-catalog-test-'));
  try{
    let clock=100000;const starts=[];
    const result=await collect({directory:dir,now:()=>clock,sleepImpl:async ms=>{clock+=ms;},fetchImpl:async url=>{
      starts.push(clock);
      if(starts.length===1)return new Response('',{status:429,headers:{'retry-after':'7'}});
      return new Response(JSON.stringify(url===BOOTSTRAP?{ad_metadata:{}}:[]),{status:200});
    }});
    assert.equal(result.complete,true);assert.equal(result.requests,3);assert.ok(starts[1]-starts[0]>=7000);assert.ok(starts[2]-starts[1]>=1100);
  }finally{removeTemporary(dir);}
});
test('repeated 503 and non-retryable 403 stop instead of fabricating empty lists',async()=>{
  for(const status of [503,403]){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kufar-catalog-test-'));let requests=0;
    try{
      await assert.rejects(()=>collect({directory:dir,sleepImpl:async()=>{},fetchImpl:async()=>{requests++;return new Response('',{status});}}),new RegExp('HTTP '+status));
      assert.equal(requests,status===503?3:1);
      const checkpoint=JSON.parse(fs.readFileSync(path.join(dir,'catalog.json')));assert.equal(checkpoint.complete,false);assert.equal(checkpoint.failures.length,1);
    }finally{removeTemporary(dir);}
  }
});
const read=name=>JSON.parse(fs.readFileSync(new URL('../../../data/parsing/cars_used_sale/'+name,import.meta.url)));
test('generated schema and binding cover exactly the same leaf fields',()=>{
  const schema=read('cars_used_sale_kufar.json'),binding=read('binding_cars_used_sale_kufar.json');
  assert.equal(validate(schema,binding).fields,45);
  const fields=schema[0].options;assert.equal(fields.find(f=>f.id==='kufar.currency').options[0].value,'BYR');
  assert.equal(fields.find(f=>f.id==='kufar.images').type,'files');
  assert.equal(fields.find(f=>f.id==='kufar.cars_lights').type,'multi_enum');
  assert.equal(fields.find(f=>f.id==='kufar.cars_battery_capacity').when.value,'5');
  assert.equal(fields.find(f=>f.id==='kufar.cars_capacity').options.find(v=>v.name==='1.6 л').value,'8');
  assert.equal(fields.find(f=>f.id==='kufar.cars_seats').options.find(v=>v.name==='5').value,'2');
  const region=fields.find(f=>f.id==='kufar.region'),area=fields.find(f=>f.id==='kufar.area');
  assert.ok(region.options.every(v=>v.level==='kufar.region'&&v.childOptions.length>0));
  assert.equal(area.parent_option_id,'kufar.region');
  assert.deepEqual(area.options,[]);
  assert.ok(region.options.every(v=>v.childOptions.every(c=>c.level==='kufar.area'&&c.childOptions.length===0)));
});
test('authenticated review keeps profile restrictions and verifies seven remaining recipes',()=>{
  const fields=read('cars_used_sale_kufar.json')[0].options;
  const bindings=read('binding_cars_used_sale_kufar.json').fields;
  const get=name=>fields.find(f=>f.id==='kufar.'+name);
  const bound=name=>bindings.find(f=>f.option_id==='kufar.'+name);
  assert.equal(get('images').validation.max_items,30);
  assert.equal(get('images').validation.max_file_size_bytes,undefined);
  for(const name of ['name','phone','email'])assert.equal(bound(name).status,'unsupported');
  for(const name of ['images','vehicle_vin','phone_hidden','cars_lights','cars_features','possible_exchange','auction'])assert.equal(bound(name).status,'ready');
  assert.deepEqual(bound('images').target.selectors,['#imageLoaderDropzone','#imageLoaderDropzoneSmall']);
  assert.equal(bound('images').verify.require_loaded,true);
  assert.equal(bound('cars_lights').selection_mode,'replace_set');
  assert.equal(bound('cars_features').verify.reopen,true);
  assert.ok(bound('possible_exchange').verify.target.selectors[0].includes('input[type="checkbox"]'));
  assert.equal(get('possible_exchange').type,'boolean');
  assert.deepEqual(get('auction').options.map(v=>[v.value,v.name]),[['1','Без торга'],['2','Торг уместен']]);
  assert.deepEqual(get('phone_hidden').options.map(v=>[v.value,v.name]),[['0','Звонки и сообщения'],['1','Только сообщения']]);
});
test('validator catches broken parents, duplicate IDs, missing binding, cycles and false completeness',()=>{
  const source=read('cars_used_sale_kufar.json'),bindings=read('binding_cars_used_sale_kufar.json');
  const mutate=(fn,pattern)=>{const s=structuredClone(source),b=structuredClone(bindings);fn(s,b);assert.throws(()=>validate(s,b),pattern);};
  mutate(s=>s[0].options.push(s[0].options[0]),/Duplicate/);
  mutate((s,b)=>b.fields.pop(),/Missing binding/);
  mutate(s=>s[0].options.find(f=>f.id==='kufar.cars_model_v2').parent_option_id='missing',/parent/i);
  mutate((s,b)=>b.fields[0].depends_on=[b.fields[0].option_id],/cycle/);
  mutate((s,b)=>b.fields.find(f=>f.status==='ready').verify.kind='text_exists',/Unknown verification/);
  mutate((s,b)=>b.fields.find(f=>f.status==='ready').verify.target={selectors:[]},/Invalid selector/);
  mutate((s,b)=>b.fields.find(f=>f.option_id==='kufar.cars_lights').verify.reopen=false,/multi-set/);
  mutate((s,b)=>b.fields.find(f=>f.option_id==='kufar.cars_features').selection_mode='append',/multi-set/);
  mutate((s,b)=>b.fields.find(f=>f.option_id==='kufar.images').verify.accepted_src_prefix='blob:',/server-photo/);
  mutate((s,b)=>b.fields.find(f=>f.option_id==='kufar.images').verify.require_loaded=false,/server-photo/);
  const incomplete=structuredClone(source);incomplete[0].options.find(f=>f.id==='kufar.cars_gen_v2').options_complete=false;
  assert.throws(()=>validate(incomplete,bindings,{requireComplete:true}),/Incomplete/);
});
