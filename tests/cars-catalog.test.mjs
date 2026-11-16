import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {groupChoices} from '../scripts/cars-canonicalization.mjs';
import {broaderGenerationReason,equivalentGenerationReason,conflictingGenerationOrdinals} from '../scripts/cars-generation-fallbacks.mjs';
const data=JSON.parse(fs.readFileSync(new URL('../data/automotive/cars_used_sale/runtime.json',import.meta.url)));

test('directional generation containment preserves phase, codes and explicit qualifiers',()=>{
 const accepts=(from,to)=>assert(broaderGenerationReason('BMW','7 серия',from,to),`${from} -> ${to}`);
 const rejects=(from,to)=>assert.equal(broaderGenerationReason('BMW','7 серия',from,to),null,`${from} -> ${to}`);
 accepts('G12 (Long)','VI (G11/G12)');
 accepts('G12 (Long) Рестайлинг','VI (G11/G12) Рестайлинг');
 accepts('IV Рестайлинг (Global market)','IV Рестайлинг');
 accepts('II (China)','II');
 accepts('F74','F74-78');
 for(const [from,to]of [['VI (G11/G12)','G12 (Long)'],['G12 (Long)','G11'],['G12 Рестайлинг','G11/G12'],['G12 Рестайлинг 2','G11/G12 Рестайлинг'],['IV (Global market)','III'],['II (China)','II (Europe)'],['IV (Global market)','(FB)'],['II (Unknown market)','II'],['I','I (China)'],['F74/F78','F74'],['F77','F74-78']])rejects(from,to);
 assert.equal(broaderGenerationReason('Kia','Rio','IV (Global market)','(FB)'),null);
 accepts('III (F06/F12/F13)','(Fxx)');
 accepts('I (E85/E86) Рестайлинг','(E8x) Рестайлинг');
 assert.equal(broaderGenerationReason('Toyota','Camry','E85','E8x'),null);
});

test('reviewed formatting matches retain chassis evidence and reject ordinal or phase conflicts',()=>{
 for(const [from,to]of [['I (8U) Рестайлинг','Typ 8U · Рестайлинг'],['I (C253)','(С253)'],['II (E51)','(Е51)'],['I (Series 3)','Series 3'],['I (901, 911)','(901, 911)']])assert(equivalentGenerationReason('test','test',from,to));
 for(const [from,to]of [['VIII (C35)','VII (C35)'],['I (8U) Рестайлинг','Typ 8U'],['I (C253)','С254'],['II','E51'],['I (Series 3)','Series 2']])assert.equal(equivalentGenerationReason('test','test',from,to),null);
 assert(conflictingGenerationOrdinals('Nissan','Laurel','VIII (C35)','VII (C35)'));
});

test('the original 1961 generations are all accounted for and reviewed mappings use real native paths',()=>{
 const audit=JSON.parse(fs.readFileSync(new URL('../data/parsing/cars_used_sale/evidence/three-platform-review.json',import.meta.url)));
 const baseline=JSON.parse(fs.readFileSync(new URL('../data/parsing/cars_used_sale/evidence/three-platform-review-baseline.json',import.meta.url)));
 const reviews=JSON.parse(fs.readFileSync(new URL('../data/automotive/cars_used_sale/reviewed-generation-mappings.json',import.meta.url)));
 assert.equal(audit.total,1961);assert.equal(audit.items.length,1961);
 assert.deepEqual(audit.items.map(n=>n.originalId),baseline.items.map(n=>n.id));
 for(const item of audit.items){
  const missing=data.platforms.filter(p=>!data.mappings[p.id].nodes[item.id]).map(p=>p.id);
  assert.deepEqual(item.missingPlatforms,missing);
  assert.equal(item.status==='resolved',missing.length===0);
 }
 for(const r of reviews){
  const n=data.nodes[r.common_option_id],m=data.mappings[r.platform].nodes[n.id];
  const model=data.nodes[n.parentId],brand=data.nodes[model.parentId];
  assert.equal(m.id,r.platform_option_id);assert.equal(m.match,'reviewed_generation');
  assert(!conflictingGenerationOrdinals(brand.name,model.name,n.name,m.name));
  assert(equivalentGenerationReason(brand.name,model.name,r.evidence,m.name));
  const path=data.mappings[r.platform].paths[n.id];assert.equal(path.at(-1).id,m.id);
 }
});

test('every broader mapping is directed, has an exact native target and preserves source identities',()=>{
 const identities=JSON.parse(fs.readFileSync(new URL('../data/automotive/cars_used_sale/source-identities.json',import.meta.url)));
 let count=0;
 for(const mapping of Object.values(data.mappings))for(const [id,m]of Object.entries(mapping.nodes))if(m.match==='broader_generation'){
  count++;const specific=data.nodes[id],broad=data.nodes[m.broader_common_option_id];
  assert.equal(specific.parentId,broad.parentId);assert.notEqual(id,broad.id);
  assert.equal(identities[m.id],broad.id); // no inverse identity or alias migration
  const direct=mapping.nodes[broad.id];assert(direct);assert.equal(direct.match,undefined);assert.equal(m.id,direct.id);
  const model=data.nodes[specific.parentId],brand=data.nodes[model.parentId];
  assert([specific.name,...specific.aliases].some(name=>broaderGenerationReason(brand.name,model.name,name,m.name)));
  assert.equal(mapping.paths[id].at(-1).common_option_id,id);
  assert.deepEqual(mapping.paths[id].slice(0,-1),mapping.paths[broad.id].slice(0,-1));
 }
 assert(count>0);
});
test('car catalog paths and native mappings refer to existing source nodes in the same branch',()=>{
 const fields=new Map(data.fields.map(f=>[f.id,f]));
 for(const [id,node]of Object.entries(data.nodes)){
  assert.equal(id,node.id);const f=fields.get(node.field);assert(f);
  if(node.parentId){const parent=data.nodes[node.parentId];assert(parent);assert.equal(parent.field,f.parent_option_id);assert.equal(parent.root,node.root);}
  else assert(!f.parent_option_id);
 }
 for(const [platform,mapping]of Object.entries(data.mappings)){
  const source=JSON.parse(fs.readFileSync(new URL(`../data/parsing/cars_used_sale/cars_used_sale_${platform}.json`,import.meta.url)))[0];
  const index=new Map();const visit=(nodes,parent)=>{for(const n of nodes){index.set(n.id,{node:n,parent});visit(n.options||[],n.id);visit(n.childOptions||[],n.id);}};visit(source.options,null);
  for(const [id,mapped]of Object.entries(mapping.nodes)){
   const common=data.nodes[id];assert(common);const native=index.get(mapped.id);assert(native);assert.deepEqual(mapped.value,native.node.value);
   if(common.parentId){
    const path=mapping.paths[id];assert(path);assert.equal(path.at(-1).id,mapped.id);
    let commonParent=null,nativeParent=null;
    for(const part of path){const n=data.nodes[part.common_option_id];assert(n);assert.equal(n.parentId,commonParent);const source=index.get(part.id);assert(source);assert.deepEqual(source.node.value,part.value);if(nativeParent)assert.equal(source.parent,nativeParent);assert.equal(part.field,mapping.fields[n.field]);commonParent=n.id;nativeParent=part.id;}
   }
  }
 }
});

const find=(field,parent,name)=>Object.values(data.nodes).find(n=>n.field===field&&n.parentId===parent&&n.name===name);
test('all BMW series spellings and Rio chassis aliases resolve to a single common variant',()=>{
 const bmw=find('car.brand',null,'BMW');
 for(let i=1;i<=8;i++){
  const model=find('car.model',bmw.id,`${i} серия`);assert(model);
  assert.equal(Object.values(data.nodes).filter(n=>n.parentId===bmw.id&&new RegExp(`^${i} (series|серии|серия)$`,'i').test(n.name)).length,1);
 }
 const kia=find('car.brand',null,'Kia'),rio=find('car.model',kia.id,'Rio');
 const gen=find('car.generation',rio.id,'IV Рестайлинг');assert.deepEqual(gen.platforms,['kufar','onliner','av','abw']);assert(gen.aliases.includes('(FB) Рестайлинг'));
 assert(find('car.generation',rio.id,'IV Рестайлинг (Global market)'));
 assert(find('car.generation',rio.id,'X-Line'));
});

test('merged native model branches retain generation-specific paths',()=>{
 const bmw=find('car.brand',null,'BMW'),two=find('car.model',bmw.id,'2 серия');
 const f22=find('car.generation',two.id,'F22 / F23'),g42=find('car.generation',two.id,'G42');
 assert(f22&&g42);
 assert.notEqual(data.mappings.kufar.paths[f22.id][1].id,data.mappings.kufar.paths[g42.id][1].id);
});

test('generation grouping prefers scoped matches but preserves markets, restylings and conflicting ordinals',()=>{
 const group=names=>groupChoices('generation','Example','Model',names.map(([p,name],i)=>({p,name,s:{id:String(i),name,value:i}})));
 assert.equal(group([['a','IV (B8)'],['b','(B8)'],['c','B8'],['d','IV']]).length,1);
 assert.equal(group([['a','III 2-й рестайлинг'],['b','(III) Рестайлинг 2']]).length,1);
 assert.equal(group([['a','I'],['b','I Рестайлинг'],['c','I Рестайлинг 2'],['d','I (China Market)']]).length,4);
 assert.equal(group([['a','III (W204)'],['b','W204, S204']]).length,1);
 assert.equal(group([['a','I'],['a','I (B5)'],['b','B5']]).length,1);
 assert.equal(group([['a','II (W463)'],['b','III (W463)']]).length,2);
 assert.equal(group([['a','VII (G2x)'],['b','G20/G21']]).length,1);
 const saab=find('car.brand',null,'Saab');assert(find('car.model',saab.id,'93'));assert(find('car.model',saab.id,'9-3'));
});

test('every redirected common ID terminates at an existing node',()=>{
 for(const [old,current]of Object.entries(data.identityAliases)){assert.notEqual(old,current);assert(data.nodes[current],old);assert(!data.identityAliases[current]);}
});

test('model labels do not leak into generations; Roman ordinals remain valid',()=>{
 const ordinal=/^(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|XVII|XVIII|XIX|XX)$/i;
 for(const n of Object.values(data.nodes).filter(n=>n.field==='car.generation')){
  if(ordinal.test(n.name))continue;
  const parent=data.nodes[n.parentId];assert(![parent.name,...parent.aliases].some(name=>name.toLowerCase()===n.name.toLowerCase()),parent.name+'/'+n.name);
 }
 const audi=find('car.brand',null,'Audi'),a2=find('car.model',audi.id,'A2');
 assert(!find('car.generation',a2.id,'A2'));
 const generation=find('car.generation',a2.id,'I (8Z)');assert(generation);
 assert.equal(data.mappings.kufar.nodes[generation.id].name,'A2');
 assert.equal(data.mappings.kufar.nodes[generation.id].match,'model_placeholder');
 assert.equal(data.identityAliases['car.option.8848b514-cfcf-4292-b15c-d57708072809'],a2.id);
});

test('BMW screenshot variants collapse by chassis code including abbreviated dash notation',()=>{
 const bmw=find('car.brand',null,'BMW'),two=find('car.model',bmw.id,'2 серия');
 const f44=find('car.generation',two.id,'F44 Gran Coupe'),f74=find('car.generation',two.id,'F74 / F78 Gran Coupe');assert(f44&&f74);
 assert(f44.aliases.includes('(F44) Gran Coupe'));assert(f74.aliases.includes('F74-78'));assert(f74.aliases.includes('F74, 78'));
 const rows=names=>names.map((name,i)=>({p:String(i),name,s:{id:String(i),value:i,name}}));
 assert.equal(groupChoices('generation','BMW','2 серия',rows(['(F44) Gran Coupe','F44'])).length,1);
 assert.equal(groupChoices('generation','BMW','2 серия',rows(['F74–78','F74, 78','(F74) Gran Coupe'])).length,1);
 assert.equal(groupChoices('generation','BMW','2 серия',rows(['F44','F44 Рестайлинг'])).length,2);
 assert.equal(groupChoices('generation','Example','Example',rows(['(A1) Coupe','A1','(A1) Cabriolet'])).length,2);
});
test('unambiguous lexical aliases share IDs without merging distinct drivetrain types',()=>{
 const find=(field,name)=>Object.values(data.nodes).find(n=>n.field===field&&n.name===name);
 assert.equal(find('car.engine','Электричество').platforms.length,4);
 assert.equal(find('car.body','Лифтбек').platforms.length,4);
 assert(find('car.drive','Подключаемый полный привод'));
 assert(find('car.drive','Постоянный полный привод'));
 assert(!data.fields.some(f=>/modification|finalId/.test(f.id)));
});

test('flat options remove spelling duplicates and preserve specific meanings',()=>{
 const values=field=>Object.values(data.nodes).filter(n=>n.field==='car.'+field);
 assert.deepEqual(values('seats').map(n=>n.name).sort(),['2','3','4','5','6','7','8','9']);
 assert.equal(values('color').length,16);assert(!values('color').some(n=>n.name.includes('/')));
 const gray=find('car.color',null,'Серый'),silver=find('car.color',null,'Серебристый');
 assert(gray&&silver);assert.notEqual(gray.id,silver.id);
 assert.equal(data.mappings.kufar.nodes[gray.id].id,data.mappings.kufar.nodes[silver.id].id);
 assert.notEqual(data.mappings.onliner.nodes[gray.id].id,data.mappings.onliner.nodes[silver.id].id);
 assert.equal(values('interior_material').length,6);assert.equal(values('interior_color').length,3);
 assert(values('body').some(n=>n.name==='Хэтчбек 3 дв.'));assert(values('body').some(n=>n.name==='Хэтчбек 5 дв.'));
 assert(!data.mappings.av.nodes[find('car.currency',null,'EUR').id]);
});

test('all compound mapping assignments use actual source controls and choices',()=>{
 for(const m of Object.values(data.mappings))for(const node of Object.values(m.nodes))for(const a of node.assignments||[]){
  const f=data.sourceFields[a.field];assert(f);
  if(f.type==='boolean')assert.equal(typeof a.value,'boolean');
  else{const choice=f.options.find(o=>o.id===a.id);assert(choice);assert.deepEqual(choice.value,a.value);}
 }
});
