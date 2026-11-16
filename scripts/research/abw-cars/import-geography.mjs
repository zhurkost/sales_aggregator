// Offline import of the city dictionary from a user-exported browser HAR.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {GEOGRAPHY_API} from './geography.mjs';
import {readHar,importHar,resultFiles} from './core.mjs';
import {validate} from './schema.mjs';
import {readCheckpoint} from '../shared/checkpoint.mjs';
const [input]=process.argv.slice(2);
if(!input)throw Error('Usage: node scripts/research/abw-cars/import-geography.mjs <abw-cities.har>');
const root=fileURLToPath(new URL('../../../',import.meta.url)),dir=path.join(root,'data/parsing/cars_used_sale');
const read=n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'));
const bytes=fs.readFileSync(input),har=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
// Retain only the public dictionary response; never persist the HAR or account data.
const entries=har.log.entries.filter(e=>e.request.url===GEOGRAPHY_API);
const records=readHar({log:{entries}}).filter(r=>r.geography);
if(!records.length)throw Error('No grouped city dictionary found');
const hashes=new Set(records.map(r=>createHash('sha256').update(JSON.stringify(r.geography)).digest('hex')));
if(hashes.size!==1)throw Error('City dictionaries differ; review snapshots before import');
const state=read('evidence/abw-catalog-source.json');
const carBefore=JSON.stringify([state.brands,state.flat,state.completedModels,state.requests,state.issues]);
importHar(records,state);
if(carBefore!==JSON.stringify([state.brands,state.flat,state.completedModels,state.requests,state.issues]))throw Error('Car progress changed');
const generated=resultFiles(state,read('evidence/abw-ui-observations.json'));
const schemaName='cars_used_sale_abw.json',bindingName='binding_cars_used_sale_abw.json';
const schema=read(schemaName),binding=read(bindingName),geoIds=new Set(['abw.region','abw.city']);
const fields=schema[0].options;
const geoFields=generated[schemaName][0].options.filter(f=>geoIds.has(f.id));
const existingRegion=fields.findIndex(f=>f.id==='abw.region');
if(existingRegion>=0)fields.splice(existingRegion,1);
fields.splice(fields.findIndex(f=>f.id==='abw.city'),1,...geoFields);
for(const b of generated[bindingName].fields.filter(f=>geoIds.has(f.option_id))){
  const i=binding.fields.findIndex(f=>f.option_id===b.option_id);
  if(i<0)binding.fields.push(b);else binding.fields[i]={...binding.fields[i],...b};
}
const validation=validate({schema,binding});
const audit={source_file:path.basename(input),source_sha256:createHash('sha256').update(bytes).digest('hex'),source_endpoint:GEOGRAPHY_API,
  imported_at:new Date().toISOString(),matching_recorded_responses:records.length,city_dictionary_sha256:[...hashes][0],
  regions:state.regions.map(r=>({name:r.name,native_id:r.value,cities:r.children.length})),
  unique_cities:state.regions.reduce((n,r)=>n+r.children.length,0),popular_duplicates_excluded:state.popularCities.length,
  completeness:'Complete grouped city menu returned by create/options, not all geographical settlements in Belarus',
  native_region_ids_available:false,network_requests_during_import:0,browser_fill_verified:false,validation};
state.geographyProvenance={audit:'evidence/abw-geography-review.json',source_sha256:audit.source_sha256};
const reportName='report_cars_used_sale_abw.txt';
const priorReport=fs.readFileSync(path.join(dir,reportName),'utf8');
const report=priorReport.split('\nГЕОГРАФИЯ — 2026-11-15')[0]+'\nГЕОГРАФИЯ — 2026-11-15\n'+
  'Этот раздел заменяет прежние замечания об отсутствии географии выше.\n'+
  `${audit.regions.length} областей, ${audit.unique_cities} населённый пункт; ${records.length} одинаковых ответов create/options в пользовательском HAR. Новых запросов нет.\n`+
  'Области — группы списка без API ID, value=null. Города имеют исходные числовые ID. «Популярные» исключены как дубли.\n'+
  'Полнота относится к меню ABW, не ко всем населённым пунктам страны. Binding города не проверялся; область не отдельное поле формы.\n'+
  'Автомобильные деревья, плоские списки, requests и completedModels не изменены.\n';
const files={[schemaName]:schema,[bindingName]:binding,[reportName]:report,'evidence/abw-catalog-source.json':state,
  'evidence/abw-geography-review.json':audit,
  'evidence/abw-geography-source.json':{source_endpoint:GEOGRAPHY_API,groups:records[0].geography}};
readCheckpoint({format:'abw-research-bundle-1',files},'abw');
const backup=path.join(root,'work/abw-geography-backups',new Date().toISOString().replaceAll(':','-'));
for(const [name,value] of Object.entries(files)){
  const target=path.join(dir,name);if(fs.existsSync(target)){const dest=path.join(backup,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(target,dest);}
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
}
const result=path.join(root,'outputs/abw-research-result-reviewed.json');
if(fs.existsSync(result)){fs.mkdirSync(backup,{recursive:true});fs.copyFileSync(result,path.join(backup,'abw-research-result-reviewed.json'));}
fs.writeFileSync(result,JSON.stringify({format:'abw-research-bundle-1',files},null,2)+'\n');
console.log(JSON.stringify({audit,backup,result},null,2));
