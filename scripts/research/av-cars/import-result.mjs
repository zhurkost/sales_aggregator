import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readCheckpoint} from '../shared/checkpoint.mjs';
import {resultFiles,stats} from './core.mjs';
import {validate} from './seed.mjs';
import {fileURLToPath} from 'node:url';

// Local import only. Never executes requests or promotes browser bindings.
const [input,destination]=process.argv.slice(2);
if(!input)throw Error('Usage: node scripts/research/av-cars/import-result.mjs <av-research-result.json> [output directory]');
const root=fileURLToPath(new URL('../../../',import.meta.url));
const out=destination?path.resolve(destination):path.join(root,'data/parsing/cars_used_sale');
const bytes=fs.readFileSync(input),bundle=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
const state=readCheckpoint(bundle,'av');
const schemaName='cars_used_sale_av.json',bindingName='binding_cars_used_sale_av.json';
validate({schema:bundle.files[schemaName],binding:bundle.files[bindingName]});
const readExisting=name=>fs.existsSync(path.join(out,name))?JSON.parse(fs.readFileSync(path.join(out,name),'utf8')):bundle.files[name];
const previous=readExisting(schemaName),binding=readExisting(bindingName);
const files=resultFiles(state,previous,binding);
const validation=validate({schema:files[schemaName],binding:files[bindingName]});
const typed=value=>typeof value+':'+JSON.stringify(value);
const allModels=state.brands.flatMap(brand=>brand.children.map(model=>({brand,model})));
const completed=new Set(state.completedModels);
if(completed.size!==state.completedModels.length)throw Error('Duplicate completed model keys');
const unfinished=allModels.filter(({brand,model})=>!model.complete||!model.list_complete||!completed.has(typed(brand.value)+'/'+typed(model.value)));
if(state.status==='complete'&&(unfinished.length||state.brands.some(b=>!b.complete||!b.list_complete)||state.regions.some(r=>!r.complete||!r.list_complete)))throw Error('Complete status contradicts tree coverage');
const generationEvidence=new Map();
for(const v of state.variants){
  if(v.property.name!=='generation')continue;
  const key=typed(v.context.brand)+'/'+typed(v.context.model);
  if(!generationEvidence.has(key))generationEvidence.set(key,[]);
  generationEvidence.get(key).push(v);
}
const emptyModels=allModels.filter(({model})=>!model.children.length).map(({brand,model})=>{
  const observations=generationEvidence.get(typed(brand.value)+'/'+typed(model.value))||[];
  if(!observations.length||observations.some(v=>v.property.options.length))throw Error('Empty generation branch lacks consistent evidence');
  return {brand:brand.name,model:model.name,brandValue:brand.value,modelValue:model.value,emptyGenerationResponses:observations.length,yearFiltered:observations.some(v=>v.year_filtered),visibleInAnyResponse:observations.some(v=>v.property.visible===true)};
});
function index(schema){
  const result=new Map();
  function walk(options,parent){for(const o of options){const key=o.type==='choice'?parent+'/'+typed(o.value):o.id;
    if(result.has(key))throw Error('Duplicate native choice within one parent');
    result.set(key,o.id);walk(o.options||[],key);walk(o.childOptions||[],key);
  }}
  walk(schema[0].options,'');return result;
}
const oldIndex=index(previous),newIndex=index(files[schemaName]);let retainedIds=0;
for(const [key,id] of oldIndex)if(newIndex.has(key)){if(newIndex.get(key)!==id)throw Error('Existing ID changed: '+id);retainedIds++;}
// These must never be present in an exported research checkpoint.
const forbidden=new Set(['authorization','cookie','cookies','headers','x-api-key','access_token','password','formSteps']);
function inspect(value){if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(forbidden.has(key))throw Error('Unexpected private/raw payload key');inspect(item);}}
inspect(state);
if(state.fields.year.options.length||state.fields.year.constraints.length||state.variants.some(v=>Object.hasOwn(v.context,'year')||(v.property.name==='year'&&(v.property.options.length||v.property.constraints.length))))throw Error('Year dictionary leaked into export');
const audit={source_file:path.basename(input),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,imported_at:new Date().toISOString(),source_status:state.status,scope:state.collectionScope,stats:stats(state),validation,retained_existing_ids:retainedIds,unfinished_models:unfinished.length,empty_generation_models:emptyModels,historical_issues:state.issues.length,historical_modifications:state.fields.modification?.options.length||0,network_requests_during_import:0,browser_binding_executed:false};
files['evidence/av-result-import-review.json']=audit;
files['report_cars_used_sale_av.txt']+='\nПРОВЕРКА ПОЛНОГО РЕЗУЛЬТАТА — 2026-11-15\n'+
  'Источник: '+audit.source_file+'; SHA-256: '+audit.sha256+'\n'+
  'Проверены уникальность ID, типизированные коды, дерево, полнота прохода моделей, отсутствие списков/контекста годов и приватных HTTP-заголовков.\n'+
  'Сохранены существующие ID полей и вариантов: '+retainedIds+'.\n'+
  emptyModels.length+' моделей без поколений: в evidence есть пустые ответы generation; это не выдуманные поколения и не автоматическая ошибка сбора. Полный список в evidence/av-result-import-review.json.\n'+
  'Записи об остановках и HTTP-ошибках выше — история предыдущих запусков; итоговый статус complete, незавершённых моделей '+unfinished.length+'.\n'+
  audit.historical_modifications+' ранее собранных модификаций оставлены как исторические данные; поле исключено из текущего сбора, options_complete=false.\n'+
  'Байндинг: '+validation.needs_review+' needs_review, '+validation.unsupported+' unsupported. Заполнение формы не тестировалось; импорт не означает готовую интеграцию или межплощадочный маппинг.\n';
const backup=path.join(root,'work/av-result-import-backups',new Date().toISOString().replaceAll(':','-'));
for(const name of Object.keys(files)){const target=path.join(out,name);if(fs.existsSync(target)){const dest=path.join(backup,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(target,dest);}}
for(const [name,value] of Object.entries(files)){const target=path.join(out,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');}
console.log(JSON.stringify({output:out,...stats(state),validation,retainedIds,emptyGenerationModels:emptyModels.length,backup},null,2));
