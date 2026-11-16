import fs from 'node:fs';
import {equivalentGenerationReason,conflictingGenerationOrdinals} from './cars-generation-fallbacks.mjs';
import {generationName} from './cars-canonicalization.mjs';
const dir='data/parsing/cars_used_sale',out='data/automotive/cars_used_sale';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const data=read(`${out}/runtime.json`),identities=read(`${out}/source-identities.json`);
const baseline=read(`${dir}/evidence/three-platform-review-baseline.json`);
const platforms=data.platforms.map(p=>p.id),native={};
for(const p of platforms){
 native[p]={};
 const walk=items=>{for(const n of items){
  const id=identities[n.id];
  if(data.nodes[id]?.field==='car.model'){
   (native[p][id]??=[]).push(...(n.childOptions||[]));
  }
  walk(n.options||[]);walk(n.childOptions||[]);
 }};
 walk(read(`${dir}/cars_used_sale_${p}.json`)[0].options);
}
const proposals=[],items=[];
const withoutPhase=name=>generationName('','',name).replace(/(?:^|\s|\()Рестайлинг(?:\s+\d+)?(?=\s|\)|$)/iu,' ').trim();
for(const original of baseline.items){
 const id=data.identityAliases[original.id]||original.id,node=data.nodes[id];
 if(!node)throw Error('Review lost an identity: '+original.id);
 const model=data.nodes[node.parentId],brand=data.nodes[model.parentId],p=original.platform;
 const missing=platforms.filter(p=>!data.mappings[p].nodes[id]);
 const candidates=[...new Map((native[p][model.id]||[]).map(n=>[n.id,n])).values()].map(n=>{
  const conflict=conflictingGenerationOrdinals(brand.name,model.name,node.name,n.name);
  const evidence=conflict?null:[node.name,...node.aliases].find(name=>equivalentGenerationReason(brand.name,model.name,name,n.name));
  const sameIdentityIgnoringPhase=[node.name,...node.aliases].some(name=>equivalentGenerationReason(brand.name,model.name,withoutPhase(name),withoutPhase(n.name)));
  return {id:n.id,name:n.name,commonId:identities[n.id],ordinalConflict:conflict,sameIdentityIgnoringPhase,evidence:evidence||null};
 });
 const matches=candidates.filter(c=>c.evidence&&data.nodes[c.commonId]?.field==='car.generation'&&data.nodes[c.commonId].parentId===model.id);
 let status;
 if(!missing.length)status='resolved';
 else if(matches.length===1){
  const c=matches[0];status='verified_equivalent';
  proposals.push({common_option_id:id,platform:p,platform_option_id:c.id,target_common_option_id:c.commonId,reason:equivalentGenerationReason(brand.name,model.name,c.evidence,c.name),evidence:c.evidence});
 }else if(matches.length>1)status='ambiguous_equivalents';
 else if(!data.mappings[p].nodes[model.id])status='model_not_mapped_in_source_files';
 else if(!candidates.length)status='no_generation_options_in_source_files';
 else status='no_verified_equivalent';
 const reason=status==='no_verified_equivalent'?(candidates.some(c=>c.ordinalConflict&&c.sameIdentityIgnoringPhase)?'Conflicting generation ordinals despite a shared chassis code; confirmation required.':candidates.some(c=>c.sameIdentityIgnoringPhase)?'Same base identity exists, but the exact restyling phase is not confirmed.':'Available names/codes do not establish an equivalent or broader generation; external taxonomy or new source evidence required.'):
  status==='model_not_mapped_in_source_files'?'No mapped model branch in this platform snapshot; this does not prove absence on the live site.':
  status==='no_generation_options_in_source_files'?'Model is mapped, but its source branch has no generation options.':
  status==='resolved'?'Native counterpart is now mapped on every platform.':'See candidate evidence; ambiguous candidates are not selected automatically.';
 items.push({originalId:original.id,id,brand:brand.name,model:model.name,name:node.name,platform:p,status,reason,missingPlatforms:missing,candidates});
}
const counts={};for(const n of items)counts[n.status]=(counts[n.status]||0)+1;
const report={scope:'All 1961 generations originally mapped on exactly three platforms. Review is based on local scraped files, not live site availability.',total:items.length,counts,items};
fs.writeFileSync(`${dir}/evidence/three-platform-review.json`,JSON.stringify(report,null,2)+'\n');
if(process.argv.includes('--write-mappings')){
 const file=`${out}/reviewed-generation-mappings.json`,existing=fs.existsSync(file)?read(file):[];
 const mappings=new Map([...existing,...proposals].map(n=>[n.platform+'/'+n.common_option_id,n]));
 fs.writeFileSync(file,JSON.stringify([...mappings.values()],null,2)+'\n');
}
console.log(JSON.stringify({total:items.length,counts,proposals:proposals.length}));
