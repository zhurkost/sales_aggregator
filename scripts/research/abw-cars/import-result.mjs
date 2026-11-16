// Offline import with explicit provenance for recovered historical flat lists.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readCheckpoint} from '../shared/checkpoint.mjs';
import {resultFiles,stats} from './core.mjs';
import {validate,typed} from './schema.mjs';
const [input,destination]=process.argv.slice(2);
if(!input)throw Error('Usage: node scripts/research/abw-cars/import-result.mjs <abw-research-result.json> [output directory]');
const root=fileURLToPath(new URL('../../../',import.meta.url));
const data=path.join(root,'data/parsing/cars_used_sale');
const out=destination?path.resolve(destination):data;
const bytes=fs.readFileSync(input),bundle=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
const state=readCheckpoint(bundle,'abw');
const schemaName='cars_used_sale_abw.json',bindingName='binding_cars_used_sale_abw.json';
validate({schema:bundle.files[schemaName],binding:bundle.files[bindingName]});
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const recoveryName='evidence/abw-flat-recovery-2026-11-15.json';
const recovery=read(path.join(data,recoveryName));
const sourceFlatCounts=Object.fromEntries(Object.entries(state.flat).map(([k,v])=>[k,v.length]));
let restored=0;
for(const [field,values] of Object.entries(recovery.fields)){
  state.flat[field]||=[];
  for(const value of values){
    const current=state.flat[field].find(o=>typed(o.value)===typed(value.value));
    if(current){if(current.name!==value.name)throw Error('Conflicting historical label: '+field);}
    else{state.flat[field].push({...value,children:[],listComplete:false});restored++;}
  }
}
state.provenance={source_sha256:createHash('sha256').update(bytes).digest('hex'),flat_recovery:recoveryName,restored_flat_choices:restored};
const rows=state.brands.flatMap(brand=>brand.children.map(model=>({brand:brand.name,model:model.name,key:typed(brand.value)+'/'+typed(model.value),complete:model.listComplete,generations:model.children.length})));
const done=new Set(state.completedModels),keys=new Set(rows.map(r=>r.key)),review=state.issues.filter(i=>i.kind==='coverage');
if(done.size!==state.completedModels.length||[...done].some(k=>!keys.has(k)))throw Error('Invalid completed model keys');
if(rows.some(r=>done.has(r.key)!==r.complete))throw Error('Tree completeness conflicts with completed models');
const unfinished=rows.filter(r=>!done.has(r.key));
if(unfinished.some(r=>!review.some(i=>i.modelKey===r.key)))throw Error('Unexplained unfinished model');
if(state.brands.some(b=>!b.listComplete))throw Error('Not all brand model lists collected');
if(state.observations.some(o=>o.field==='year'||Object.hasOwn(o.context,'year'))||state.flat.year)throw Error('Persisted year dictionary');
const forbidden=new Set(['authorization','cookie','cookies','headers','x-api-key','access_token','password']);
function inspect(v){if(!v||typeof v!=='object')return;for(const [k,x]of Object.entries(v)){if(forbidden.has(k))throw Error('Unexpected private/raw payload key');inspect(x);}}
inspect(state);
const files=resultFiles(state,read(path.join(data,'evidence/abw-ui-observations.json')));
function walk(list,parent,callback){for(const o of list){const key=o.type==='choice'?parent+'/'+(o.value===null?'label:'+o.name:typed(o.value)):o.id;callback(o,key);walk(o.options||[],key,callback);walk(o.childOptions||[],key,callback);}}
const previous=fs.existsSync(path.join(out,schemaName))?read(path.join(out,schemaName)):bundle.files[schemaName],oldIds=new Map();
walk(previous[0].options,'',(o,k)=>{if(oldIds.has(k))throw Error('Ambiguous prior native key');oldIds.set(k,o.id);});
let retained=0;const seen=new Set();
walk(files[schemaName][0].options,'',(o,k)=>{if(seen.has(k))throw Error('Duplicate native code within parent');seen.add(k);if(oldIds.has(k)){o.id=oldIds.get(k);retained++;}});
// Preserve previous browser review details if present; this import cannot certify them.
if(fs.existsSync(path.join(out,bindingName))){
  const prior=read(path.join(out,bindingName));
  files[bindingName].fields=files[bindingName].fields.map(f=>({...f,...prior.fields.find(p=>p.option_id===f.option_id)}));
}
const validation=validate({schema:files[schemaName],binding:files[bindingName]});
const audit={source_file:path.basename(input),sha256:state.provenance.source_sha256,bytes:bytes.length,imported_at:new Date().toISOString(),scope:state.collectionScope,stats:stats(state),validation,retained_existing_ids:retained,source_flat_counts:sourceFlatCounts,merged_flat_counts:Object.fromEntries(Object.entries(state.flat).map(([k,v])=>[k,v.length])),flat_recovery:recoveryName,restored_flat_choices:restored,unresolved_models:unfinished.map(r=>({...r,reason:review.find(i=>i.modelKey===r.key)?.message})),geography_collected:state.regions.length>0,browser_binding_executed:false,network_requests_during_import:0};
files['evidence/abw-result-import-review.json']=audit;
files['report_cars_used_sale_abw.txt']+='\nПРОВЕРКА РЕЗУЛЬТАТА — 2026-11-15\n'+
  'Источник: '+audit.source_file+'; SHA-256: '+audit.sha256+'\n'+
  'Проверены уникальность ID/нативных кодов в ветви, полнота списков моделей марок и согласованность completedModels с деревом. Сохранены прежние ID: '+retained+'.\n'+
  'Незавершённых моделей: '+unfinished.length+'. У всех сохранена причина в evidence/abw-result-import-review.json. Пустой ответ годов не заменяется выдуманными поколениями.\n'+
  'В новом файле плоские массивы сокращены до '+JSON.stringify(sourceFlatCounts)+'. Восстановлено '+restored+' вариантов из ранее прочитанного результата в этом чате: '+JSON.stringify(audit.merged_flat_counts)+'. Источник восстановления: '+recoveryName+'. Полнота списков не объявляется доказанной.\n'+
  (state.geographyComplete?'География собрана из grouped city справочника.':'География не собрана.')+' '+validation.fields+' привязки остаются needs_review. Browser binding не проверялся. Данные не подключены к production/mapping.\n';
const backup=path.join(root,'work/abw-result-import-backups',new Date().toISOString().replaceAll(':','-'));
for(const name of Object.keys(files)){const target=path.join(out,name);if(fs.existsSync(target)){const dest=path.join(backup,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(target,dest);}}
for(const [name,value]of Object.entries(files)){const target=path.join(out,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');}
console.log(JSON.stringify({output:out,...stats(state),validation,restoredFlatChoices:restored,retainedIds:retained,backup},null,2));
