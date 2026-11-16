import fs from 'node:fs';
import {groupChoices,generationDisplay,isModelGeneration} from './cars-canonicalization.mjs';
import {flatName,flatMappingRules} from './cars-flat-options.mjs';
import {broaderGenerationReason,equivalentGenerationReason,conflictingGenerationOrdinals} from './cars-generation-fallbacks.mjs';
import {randomUUID,createHash} from 'node:crypto';
const dir='data/parsing/cars_used_sale',out='data/automotive/cars_used_sale';
fs.mkdirSync(out,{recursive:true});
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const platforms=['kufar','onliner','av','abw'];
const source=Object.fromEntries(platforms.map(p=>[p,read(`${dir}/cars_used_sale_${p}.json`)[0].options]));
const bindings=Object.fromEntries(platforms.map(p=>[p,read(`${dir}/binding_cars_used_sale_${p}.json`).fields]));
const overrides=read(`${out}/browser-overrides.json`);
for(const [p,items]of Object.entries(overrides))bindings[p]=bindings[p].map(b=>({...b,...items[b.option_id]}));
const registryPath=`${out}/identity-registry.json`;
const registry=fs.existsSync(registryPath)?read(registryPath):{};
const sourceIdentityPath=`${out}/source-identities.json`;
const sourceIdentities=fs.existsSync(sourceIdentityPath)?read(sourceIdentityPath):{};
// Explicit reviewed migrations only; never silently coalesce established common IDs.
const merges=read(`${out}/identity-merges.json`);
const migrated=value=>{const seen=new Set();while(merges[value]){if(seen.has(value))throw Error('Identity migration cycle');seen.add(value);value=merges[value].to;}return value;};
for(const entries of [registry,sourceIdentities])for(const key of Object.keys(entries))entries[key]=migrated(entries[key]);
const id=key=>registry[key]??= 'car.option.'+randomUUID();
const norm=s=>s.normalize('NFKC').trim().toLowerCase().replaceAll('ё','е').replace(/\s*[·]\s*/g,' ').replace(/\s+/g,' ');
// Explicit semantic aliases only. No fuzzy matching, translation or global leaf lookup.
const aliases={drive:{'передний привод':'Передний','задний привод':'Задний','полный привод':'Полный'},
 transmission:{'механическая':'Механика','механика':'Механика','автомат':'Автоматическая','автоматическая':'Автоматическая'},
 body:{'хетчбэк':'Хэтчбек','хэтчбек':'Хэтчбек','лифтбэк':'Лифтбек'},engine:{'электро':'Электричество'},currency:{'руб.':'BYN','byn':'BYN','byr':'BYN','$':'USD','usd':'USD','€':'EUR','eur':'EUR'},
 region:{'могилевская область':'Могилёвская область'}};
const canonical=(field,name)=>{if(field==='region')name=name.replace(/обл\.$/i,'область');return flatName(field,aliases[field]?.[norm(name)]||name.trim().replace(/\s*[·]\s*/g,' ').replace(/\s+/g,' '));};
// Field correspondences are authored by meaning; unlike labels, source IDs are never guessed.
const definitions=[
 ['brand','Марка','enum','cars_brand_v2','manufacturer','brand','brand'],
 ['model','Модель','enum','cars_model_v2','model','model','model'],
 ['generation','Поколение','enum','cars_gen_v2','generation','generation','generation'],
 ['year','Год выпуска','integer','regdate','year','year','year'],
 ['body','Кузов','enum','cars_type','bodyType','body_type','body'],
 ['engine','Тип двигателя','enum','cars_engine','engineType','engine_type','engine'],
 ['drive','Привод','enum','cars_drive','drivetrain','drive_type','gear'],
 ['transmission','Коробка передач','enum','cars_gearbox','transmission','transmission_type','transmission'],
 ['engine_capacity','Объём двигателя, л','number','cars_capacity','engineCapacity','engine_capacity',null],
 ['mileage','Пробег, км','integer','mileage','odometer','mileage','mileage'],
 ['color','Цвет кузова','enum','cars_color','color','color','color'],
 ['seats','Количество мест','enum','cars_seats','numberOfSeats','number_of_seats',null],
 ['interior_material','Материал салона','enum','cars_interior_material','compartmentDecoration','interior_material',null],
 ['interior_color','Цвет салона','enum','cars_interior_color','compartmentColor','interior_color',null],
 ['price','Цена','number','price','price','price_amount','price'],
 ['currency','Валюта','enum','currency','currency','price_currency','currency'],
 ['vin','VIN','text','vehicle_vin','vin','vin','vin'],
 ['description','Описание','text','body','description','description','description'],
 ['photos','Фотографии','files','images','images','photo','photo'],
 ['region','Область','enum','region','region','place_region','region'],
 ['city','Город','enum','area','city','place_city','city'],
 ['phone','Телефон','text','phone','phone','phone_number','phone'],
 ['seller_name','Имя продавца','text','name','sellerName','name','seller_name'],
 ['video','Видео','text',null,null,'video_url','video'],
];
const parents={model:'brand',generation:'model',city:'region'},roots={brand:'brand',model:'brand',generation:'brand',region:'region',city:'region'};
const common=[],nodes={},mappings=Object.fromEntries(platforms.map(p=>[p,{category_id:'cars_used_sale',platform:p,fields:[],nodes:[]}]));
const coverage=[],ambiguous=[],reviewedGroups=[],modelGenerationPlaceholders=[];
const reviewIdentities=process.argv.includes('--review-identities');
const sourceIndex={},sourceParents={};for(const p of platforms){sourceIndex[p]={};sourceParents[p]={};const walk=(arr,parent=null)=>arr.forEach(n=>{sourceIndex[p][n.id]=n;sourceParents[p][n.id]=parent;walk(n.options||[],n.id);walk(n.childOptions||[],n.id);});walk(source[p]);}
for(const [key,name,type,...refs]of definitions){
 const f={id:'car.'+key,key,name,type,options:[],options_complete:true,description:name,platforms:[]};
 if(parents[key])f.parent_option_id='car.'+parents[key];if(roots[key])f.root='car.'+roots[key];
 common.push(f);
 for(let i=0;i<platforms.length;i++){const p=platforms[i],s=source[p].find(x=>x.id===p+'.'+refs[i]);if(!s)continue;
 const conversion=key==='engine_capacity'&&p==='av'?{kind:'scale',factor:1000,from_unit:'litre',to_unit:'cm3',exact_integer:true}:key==='engine_capacity'&&p==='kufar'?{kind:'exact_numeric_option',unit:'litre'}:key==='phone'&&p==='av'?{kind:'international_phone_split',supported_prefix:'+375',country_option_id:'av.phone_country.number%3A1'}:{kind:type==='enum'?'node_lookup':'identity'};
 f.platforms.push(p);mappings[p].fields.push({common_option_id:f.id,platform_option_id:s.id,conversion:{...conversion,on_unmapped:'needs_review'}});
 }
}
function collect(fieldKey,parentKey,parentId,sets,ancestry=[]){
 const field=common.find(f=>f.key===fieldKey),all=[];
 for(const [p,options]of Object.entries(sets))for(const s of options){
  if(fieldKey==='generation'&&isModelGeneration(s.name,[nodes[parentId].name,...nodes[parentId].aliases])){
   modelGenerationPlaceholders.push({platform:p,sourceId:s.id,name:s.name,modelId:parentId,onlyNativeChoice:sourceIndex[p][sourceParents[p][s.id]].childOptions.length===1});
  }else all.push({p,s,name:canonical(fieldKey,s.name)});
 }
 const groups=groupChoices(fieldKey,ancestry[0]||'',ancestry[1]||'',all);
 const results=[];
 for(const rows of groups){
  // Prefer explicit ordinal + chassis names; other aliases remain searchable and visible to AI.
  let display=[...rows].sort((a,b)=>Number(/^[IVX]+ \(/.test(b.name))-Number(/^[IVX]+ \(/.test(a.name))||platforms.indexOf(a.p)-platforms.indexOf(b.p))[0].name;
  if(fieldKey==='generation')display=generationDisplay(rows,display);
  const key=parentKey+'/'+fieldKey+'/'+norm(display);
  const prior=[...new Set(rows.map(r=>sourceIdentities[r.s.id]).filter(Boolean).map(migrated))];
  if(prior.length>1&&!reviewIdentities)throw Error('Identity merge requires --review-identities: '+key);
  const nodeId=prior[0]||id(key);registry[key]=nodeId;
  for(const old of prior.slice(1))merges[old]={to:nodeId,reason:'Reviewed scoped lexical/code equivalence: '+key};
  if(new Set(rows.map(r=>norm(r.s.name))).size>1)reviewedGroups.push({field:field.id,path:[...ancestry,display],id:nodeId,aliases:[...new Set(rows.map(r=>r.s.name))],sourceIds:rows.map(r=>r.s.id)});
  const node={id:nodeId,name:display,type:'choice',options:[],level:field.id,value:null,description:display,aliases:[...new Set(rows.map(r=>r.s.name))],platforms:[],options_complete:rows.every(r=>r.s.options_complete!==false)};
  const next={brand:'model',model:'generation',region:'city'}[fieldKey],childSets={};
  for(const r of rows)sourceIdentities[r.s.id]=nodeId;
  for(const p of platforms){
   const matches=rows.filter(r=>r.p===p);if(!matches.length)continue;
   if(next)childSets[p]=matches.flatMap(r=>r.s.childOptions||[]);
   const equivalentValues=new Set(matches.map(r=>JSON.stringify(r.s.value))).size===1;
   if(matches.length>1&&!equivalentValues){ambiguous.push({field:field.id,parent:parentId,name:display,platform:p,candidates:matches.map(r=>r.s.id),resolution:['brand','model','generation'].includes(fieldKey)?'preferred_native_variant':'needs_review'});if(!['brand','model','generation'].includes(fieldKey))continue;}
   // A site's duplicate model branches are retained in each generation's native path.
   // Prefer the branch with most descendants, then a stable source ID; retain alternatives in review.
   const s=[...matches].sort((a,b)=>(b.s.childOptions?.length||0)-(a.s.childOptions?.length||0)||a.s.id.localeCompare(b.s.id))[0].s;
   const review=ambiguous.findLast(r=>r.field===field.id&&r.parent===parentId&&r.name===display&&r.platform===p);if(review)review.selected=s.id;
   node.platforms.push(p);mappings[p].nodes.push({common_option_id:nodeId,platform_option_id:s.id});
  }
  if(nodes[nodeId])throw Error('Common ID belongs to more than one branch: '+nodeId);
  nodes[nodeId]={id:nodeId,field:field.id,root:field.root||field.id,parentId,name:node.name,aliases:node.aliases,platforms:node.platforms};
  if(next)node.childOptions=collect(next,key,nodeId,childSets,[...ancestry,display]);else if(roots[fieldKey])node.childOptions=[];
  results.push(node);
 }
 return results.sort((a,b)=>a.name.localeCompare(b.name,'ru'));
}
const country=source.onliner.find(f=>f.id==='onliner.country')?.options.find(o=>o.name==='Беларусь');
if(!country)throw Error('Missing confirmed Belarus context');
mappings.onliner.context={option_id:'onliner.country',choice_id:country.id,value:country.value,reason:'The category geography is explicitly scoped to Belarus.'};
for(const f of common){if(f.type!=='enum'||f.parent_option_id)continue;const sets={};for(const p of platforms){const m=mappings[p].fields.find(x=>x.common_option_id===f.id);if(m)sets[p]=f.key==='region'&&p==='onliner'?country.childOptions:sourceIndex[p][m.platform_option_id].options;}f.options=collect(f.key,'',null,sets);}
const generationChildren=new Map(),mappedIds=Object.fromEntries(platforms.map(p=>[p,new Set(mappings[p].nodes.map(n=>n.common_option_id))]));
for(const n of Object.values(nodes))if(n.field==='car.generation'){if(!generationChildren.has(n.parentId))generationChildren.set(n.parentId,[]);generationChildren.get(n.parentId).push(n);}
for(const placeholder of modelGenerationPlaceholders){
 const old=migrated(sourceIdentities[placeholder.sourceId]);
 if(old&&old!==placeholder.modelId&&!nodes[old]){
  if(!reviewIdentities)throw Error('Retiring a model-named generation requires --review-identities: '+placeholder.name);
  merges[old]={to:placeholder.modelId,reason:'Model name is not a generation; retain the known model, without guessing an ordinal.'};
 }
 sourceIdentities[placeholder.sourceId]=placeholder.modelId;
 // A site with a single model-named leaf has no finer taxonomy. A selected real generation
 // may use that coarse native leaf, but selecting only a model never invents a generation.
 if(!placeholder.onlyNativeChoice)continue;
 const p=placeholder.platform;
 for(const n of generationChildren.get(placeholder.modelId)||[]){
  if(mappedIds[p].has(n.id))continue;
  mappedIds[p].add(n.id);
  mappings[p].nodes.push({common_option_id:n.id,platform_option_id:placeholder.sourceId,match:'model_placeholder'});
  if(!n.platforms.includes(p))n.platforms.push(p);
 }
}
// Snapshot exact mappings: a fallback must never become evidence for another fallback.
const directGenerations=Object.fromEntries(platforms.map(p=>[p,new Map(mappings[p].nodes.filter(m=>!m.match).map(m=>[m.common_option_id,m]))]));
const generationFallbackReview=[],generationFallbackAmbiguous=[];
for(const [modelId,siblings]of generationChildren){
 const model=nodes[modelId],brand=nodes[model.parentId];
 for(const node of siblings)for(const p of platforms){
  if(mappedIds[p].has(node.id))continue;
  const candidates=new Map();
  for(const broader of siblings){
   if(broader.id===node.id)continue;
   const mapping=directGenerations[p].get(broader.id);if(!mapping)continue;
   const native=sourceIndex[p][mapping.platform_option_id];
   if(conflictingGenerationOrdinals(brand.name,model.name,node.name,native.name))continue;
   const evidence=[node.name,...node.aliases].find(name=>broaderGenerationReason(brand.name,model.name,name,native.name));
   if(evidence)candidates.set(native.id,{broader,mapping,native,evidence});
  }
  if(candidates.size!==1){
   if(candidates.size>1)generationFallbackAmbiguous.push({id:node.id,platform:p,candidates:[...candidates.keys()]});
   continue;
  }
  const {broader,mapping,native,evidence}=[...candidates.values()][0];
  mappings[p].nodes.push({common_option_id:node.id,platform_option_id:mapping.platform_option_id,match:'broader_generation',broader_common_option_id:broader.id});
  mappedIds[p].add(node.id);if(!node.platforms.includes(p))node.platforms.push(p);
  generationFallbackReview.push({id:node.id,brand:brand.name,model:model.name,name:node.name,platform:p,nativeId:native.id,nativeName:native.name,broaderId:broader.id,evidence});
 }
}
const reviewedGenerationFile=`${out}/reviewed-generation-mappings.json`;
for(const r of fs.existsSync(reviewedGenerationFile)?read(reviewedGenerationFile):[]){
 const p=r.platform,id=migrated(r.common_option_id),target=migrated(r.target_common_option_id);
 const node=nodes[id],destination=nodes[target],native=sourceIndex[p]?.[r.platform_option_id];
 const model=nodes[node?.parentId],brand=nodes[model?.parentId];
 if(!node||node.field!=='car.generation'||destination?.parentId!==node.parentId||!native||sourceIdentities[native.id]!==target||sourceIdentities[sourceParents[p][native.id]]!==node.parentId)throw Error('Invalid reviewed generation path: '+id);
 if(conflictingGenerationOrdinals(brand.name,model.name,node.name,native.name)||![node.name,...node.aliases].includes(r.evidence)||!equivalentGenerationReason(brand.name,model.name,r.evidence,native.name))throw Error('Unverified generation equivalence: '+id);
 if(mappedIds[p].has(id))continue; // exact mappings always take precedence
 mappings[p].nodes.push({common_option_id:id,platform_option_id:native.id,match:'reviewed_generation',broader_common_option_id:target});
 mappedIds[p].add(id);if(!node.platforms.includes(p))node.platforms.push(p);
}
const flatReview=[];
for(const rule of flatMappingRules){
 const node=Object.values(nodes).find(n=>n.field==='car.'+rule.field&&norm(n.name)===norm(rule.name));
 if(!node)throw Error('Missing common flat choice: '+rule.field+'/'+rule.name);
 const p=rule.platform,field=mappings[p].fields.find(f=>f.common_option_id===node.field)?.platform_option_id;
 const native=sourceIndex[p][field]?.options.find(o=>norm(o.name)===norm(rule.native));
 if(!native)throw Error('Missing native flat choice: '+p+'/'+rule.native);
 const assignments=(rule.assignments||[]).map(a=>{
  const sourceField=sourceIndex[p][a.field];if(!sourceField)throw Error('Missing compound field: '+a.field);
  if(a.choice){const choice=sourceField.options.find(o=>norm(o.name)===norm(a.choice));if(!choice)throw Error('Missing compound choice');return {field:a.field,id:choice.id,value:choice.value,name:choice.name};}
  if(sourceField.type!=='boolean'||typeof a.value!=='boolean')throw Error('Invalid compound boolean');
  return {field:a.field,value:a.value,name:a.value?'Да':'Нет'};
 });
 const existing=mappings[p].nodes.find(n=>n.common_option_id===node.id);
 if(existing)throw Error('Flat fallback would replace an exact mapping: '+node.name+'/'+p);
 mappings[p].nodes.push({common_option_id:node.id,platform_option_id:native.id,match:rule.match||'broader',...(assignments.length?{assignments}: {})});
 if(!node.platforms.includes(p))node.platforms.push(p);
 flatReview.push({...rule,commonId:node.id,sourceId:native.id,assignments});
}
const commonSourceIds=Object.fromEntries(platforms.map(p=>[p,new Set(mappings[p].fields.map(f=>f.platform_option_id))]));
const excluded=/\.(modification|photo360|number_masking)$/;
const extras=[];for(const p of platforms)for(const f of source[p]){
 if(commonSourceIds[p].has(f.id)||excluded.test(f.id)||f.parent_option_id||f.id==='onliner.country')continue;
 const bind=bindings[p].find(b=>b.option_id===f.id);if(bind?.status==='unsupported')continue;
 extras.push({...f,key:f.id,platform:p,options:f.id.endsWith('.regdate')?[]:f.options});
}
// Runtime is a compact index, not a second independent taxonomy.
const runtimeFields=common.map(({options,...f})=>({...f,optionCount:options.length}));
const runtimeMappings={};for(const p of platforms){runtimeMappings[p]={fields:{},nodes:{},paths:{},extras:extras.filter(f=>f.platform===p).map(f=>f.id)};
 if(mappings[p].context)runtimeMappings[p].context=mappings[p].context;
 for(const f of mappings[p].fields)runtimeMappings[p].fields[f.common_option_id]=f.platform_option_id;
 for(const n of mappings[p].nodes){const s=sourceIndex[p][n.platform_option_id];runtimeMappings[p].nodes[n.common_option_id]={id:s.id,value:s.value,name:s.name,...(n.match?{match:n.match}:{}),...(n.broader_common_option_id?{broader_common_option_id:n.broader_common_option_id}:{}),...(n.assignments?{assignments:n.assignments}:{})};
  if(nodes[n.common_option_id].parentId){
   const path=[];let native=s,commonId=n.common_option_id;
   while(commonId){
    const commonNode=nodes[commonId];
    const coarseLeaf=n.match==='model_placeholder'&&commonId===n.common_option_id&&sourceIdentities[native?.id]===commonNode.parentId;
    const broaderLeaf=['broader_generation','reviewed_generation'].includes(n.match)&&commonId===n.common_option_id&&sourceIdentities[native?.id]===n.broader_common_option_id&&nodes[n.broader_common_option_id].parentId===commonNode.parentId;
    if(!native||sourceIdentities[native.id]!==commonId&&!coarseLeaf&&!broaderLeaf)throw Error('Native parent mismatch: '+s.id);
    path.unshift({common_option_id:commonId,field:runtimeMappings[p].fields[commonNode.field],id:native.id,value:native.value,name:native.name});
    native=sourceIndex[p][sourceParents[p][native.id]];commonId=commonNode.parentId;
   }
   runtimeMappings[p].paths[n.common_option_id]=path;
  }}
}
// Kufar models Minsk as a region with districts, whereas the other sites use a city.
// Resolve that explicit cross-level path without inventing a district or merging identities.
const minskRegion=Object.values(nodes).find(n=>n.field==='car.region'&&n.name==='Минская область');
const minskCity=Object.values(nodes).find(n=>n.field==='car.city'&&n.parentId===minskRegion?.id&&n.name==='Минск');
const nativeMinsk=source.kufar.find(f=>f.id==='kufar.region')?.options.find(n=>n.name==='Минск');
if(!minskCity||!nativeMinsk)throw Error('Reviewed Minsk mapping is missing from source catalogs');
runtimeMappings.kufar.paths[minskCity.id]=[{common_option_id:minskCity.id,field:'kufar.region',id:nativeMinsk.id,value:nativeMinsk.value,name:nativeMinsk.name}];
runtimeMappings.kufar.pathIssues={[minskCity.id]:['Выберите район Минска в форме Kufar.']};
mappings.kufar.pathIssues=runtimeMappings.kufar.pathIssues;
const sourceFields={};for(const p of platforms)for(const f of source[p])sourceFields[f.id]={...f,options:f.parent_option_id?[]:f.options.filter(o=>!o.childOptions)};
for(const p of platforms)mappings[p].paths=runtimeMappings[p].paths;
const identityAliases=Object.fromEntries(Object.keys(merges).map(old=>[old,migrated(old)]));
const output={version:1,identityAliases,categoryId:'cars_used_sale',fields:runtimeFields,extras,nodes,mappings:runtimeMappings,sourceFields,bindings,
 platforms:[{id:'kufar',name:'Kufar',url:'https://www.kufar.by/ain/create'},{id:'onliner',name:'Onliner',url:'https://ab.onliner.by/create'},{id:'av',name:'AV.by',url:'https://av.by/offer/draft/cars'},{id:'abw',name:'ABW',url:'https://abw.by/create/cars'}]};
const schema=[{id:'cars_used_sale',name:'Легковые автомобили с пробегом',description:'Общий справочник. Согласованные обозначения в контексте родителей; спорные варианты объединяются в пользу совпадения, выбор площадки фиксируется в отчёте.',categories:[],options:common}];
const write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n');
write(`${dir}/evidence/generation-broader-mappings.json`,{rule:'Specific to broader only, within one model and the same restyling phase. Compare real native labels, retain exact mappings, require a unique target. No inverse aliases, ID merges or fallback chains.',count:generationFallbackReview.length,items:generationFallbackReview,ambiguous:generationFallbackAmbiguous});
const generationAvailability=Object.values(nodes).filter(n=>n.field==='car.generation').map(n=>({
 id:n.id,brand:nodes[nodes[n.parentId].parentId].name,model:nodes[n.parentId].name,name:n.name,
 missingPlatforms:platforms.filter(p=>!runtimeMappings[p].nodes[n.id]),
 coarsePlatforms:platforms.filter(p=>runtimeMappings[p].nodes[n.id]?.match==='model_placeholder'),
 broaderPlatforms:platforms.filter(p=>runtimeMappings[p].nodes[n.id]?.match==='broader_generation')
}));
write(`${dir}/evidence/generation-availability.json`,{
 rule:'Offer generations only when approved mappings exist on all four platforms. Retain raw research and stable IDs. Existing reviewed model_placeholder mappings count as coarse counterparts.',
 total:generationAvailability.length,visible:generationAvailability.filter(n=>!n.missingPlatforms.length).length,items:generationAvailability
});
for(const entries of [registry,sourceIdentities])for(const key of Object.keys(entries))entries[key]=migrated(entries[key]);
write(`${out}/identity-merges.json`,merges);
write(`${dir}/evidence/model-generation-placeholders.json`,{rule:'Do not expose a model name as a generation. Keep raw native choices; use a unique coarse native leaf only for an explicitly selected real generation.',count:modelGenerationPlaceholders.length,items:modelGenerationPlaceholders});
write(`${dir}/evidence/canonicalization-review.json`,{rules:'scripts/cars-canonicalization.mjs',scope:'All brands, models and generations from all four source schemas',policy:'Prefer scoped matches; preserve explicit market/restyling/ordinal distinctions',counts:Object.fromEntries(['brand','model','generation'].map(key=>[key,Object.values(nodes).filter(n=>n.field==='car.'+key).length])),groups:reviewedGroups});
write(`${dir}/evidence/flat-options-review.json`,{rules:'scripts/cars-flat-options.mjs',fields:common.filter(f=>f.type==='enum'&&!['brand','model','generation'].includes(f.key)).map(f=>({field:f.id,count:Object.values(nodes).filter(n=>n.field===f.id).length})),mappings:flatReview,additionalDropdowns:extras.filter(f=>['enum','multi_enum'].includes(f.type)).map(f=>({field:f.id,count:f.options.length})),policy:'Merge lexical duplicates; keep distinct technical characteristics. Map precise common choices to broader site choices or explicit compound controls. Never invent a finer subtype, change currency, or cross a city parent.'});
write(registryPath,registry);write(sourceIdentityPath,sourceIdentities);write(`${dir}/cars_used_sale_common.json`,schema);
for(const p of platforms)write(`${dir}/mapping_cars_used_sale_${p}.json`,mappings[p]);
write(`${out}/runtime.json`,output);
write(`${dir}/evidence/common-review.json`,{created:new Date().toISOString(),sourceHashes:Object.fromEntries(platforms.map(p=>[p,createHash('sha256').update(fs.readFileSync(`${dir}/cars_used_sale_${p}.json`)).digest('hex')])),nodes:Object.keys(nodes).length,fields:common.length,ambiguous,unmappedPolicy:'Scoped equivalence prefers a match; explicit market, restyling and contradictory ordinal distinctions remain separate. Native alternatives are retained in review.',limitations:['Chassis codes are linked to ordinals only by explicit sibling labels or reviewed scoped aliases; market/body qualifiers and restyling remain distinct.','Region grouping differs for Minsk; no cross-parent fallback.','ABW has 18 incomplete generation branches.','AV/ABW browser bindings require live verification.']});
console.log(JSON.stringify({fields:common.length,nodes:Object.keys(nodes).length,extras:extras.length,ambiguous:ambiguous.length}));
