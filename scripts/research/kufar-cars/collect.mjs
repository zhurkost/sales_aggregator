import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';

export const BOOTSTRAP = 'https://api.kufar.by/insertion/v1/meta/bootstrap?application=ad_insertion&category=2010&company_ad=0&parent=2000&platform=web&routing=web_ad_insertion&taxonomy-version=2';
export const catalogUrl = tag => 'https://api.kufar.by/catalog/v1/nodes?tag='+encodeURIComponent(tag)+'&view=taxonomy';
export const digest = data => crypto.createHash('sha256').update(data).digest('hex');
// Observed 2026-11-12 in the generation response for Kia Rio X. Preserve the
// original metadata; do not relax validation for arbitrary wrong node types.
export const TYPE_ANOMALIES = new Map([
  ['category_2010.mark_kia.model_riox.generation_riox_i_2020', {expected:'generation',actual:'model'}],
]);
export function save(file, data) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  fs.writeFileSync(file+'.tmp', JSON.stringify(data,null,2)+'\n');
  fs.renameSync(file+'.tmp',file);
}
export function validateNodes(data, tag, type) {
  if (!Array.isArray(data)) throw Error('Expected a complete catalog array: '+tag);
  const seen=new Set();
  for(const n of data) {
    const field={mark:'cars_brand_v2',model:'cars_model_v2',generation:'cars_gen_v2'}[type];
    const exception=TYPE_ANOMALIES.get(n.value);
    const typeMatches=n.params?.node_type===type||(exception?.expected===type&&exception.actual===n.params?.node_type);
    if(typeof n.value!=='string'||!n.value.startsWith(tag+'.')||!n.labels?.ru||!typeMatches||n.params?.name!==field||seen.has(n.value))
      throw Error('Unexpected/duplicate catalog node: '+tag);
    seen.add(n.value);
  }
  return data;
}
export function validateConfiguration({maxRequests=Infinity,interval=1100}={}) {
  if(!Number.isFinite(interval)||interval<1000)throw Error('Minimum request interval is 1000 ms');
  if(maxRequests!==Infinity&&(!Number.isInteger(maxRequests)||maxRequests<0))throw Error('maxRequests must be a nonnegative integer or Infinity');
}
export async function collect({directory='work/kufar-cars-used', maxRequests=Infinity, interval=1100, fetchImpl=fetch, sleepImpl=sleep, now=Date.now}={}) {
  validateConfiguration({maxRequests,interval});
  const cacheDir=path.join(directory,'cache'); fs.mkdirSync(cacheDir,{recursive:true});
  let requests=0,last=0,stop=false,lastProgress=-1,currentUrl=null;
  const onSignal=()=>{stop=true;};process.on('SIGINT',onSignal);process.on('SIGTERM',onSignal);
  const state={category:'cars_used_sale',platform:'kufar',scope:'Used passenger cars; no year filter; GET-only research',startedAt:new Date().toISOString(),requests:0,complete:false,brands:[],failures:[]};
  const previousFile=path.join(directory,'catalog.json');
  if(fs.existsSync(previousFile)){
    const previous=JSON.parse(fs.readFileSync(previousFile,'utf8'));
    state.runHistory=[...(previous.runHistory||[]),{startedAt:previous.startedAt,updatedAt:previous.updatedAt,requests:previous.requests,complete:previous.complete,failures:previous.failures}];
  }
  const checkpoint=()=>{state.requests=requests;state.updatedAt=new Date().toISOString();save(path.join(directory,'catalog.json'),state);};
  const progress=data=>{if(requests!==lastProgress&&requests%20===0){lastProgress=requests;console.log(JSON.stringify({...data,requests}));}};
  async function get(url) {
    currentUrl=url;
    if(!url.startsWith('https://api.kufar.by/catalog/v1/nodes?')&&url!==BOOTSTRAP)throw Error('Endpoint not observed in form');
    const file=path.join(cacheDir,digest(url)+'.json');
    if(fs.existsSync(file)){const x=JSON.parse(fs.readFileSync(file));if(x.url!==url||digest(JSON.stringify(x.data))!==x.sha256)throw Error('Corrupt cache '+file);return x;}
    if(stop||requests>=maxRequests)throw Error('PAUSED');
    for(let attempt=0;attempt<3;attempt++) {
      if(stop||requests>=maxRequests)throw Error('PAUSED');
      await sleepImpl(Math.max(0,last+interval-now()));last=now();requests++;
      const r=await fetchImpl(url,{signal:AbortSignal.timeout(30000),redirect:'error',headers:{Accept:'application/json'}});
      if([429,503].includes(r.status)) {
        const h=r.headers.get('retry-after');
        const wait=h&&/^\d+$/.test(h)?Number(h)*1000:h?Math.max(0,Date.parse(h)-now()):0;
        if(attempt===2)throw Error('Repeated HTTP '+r.status+'; stop affected crawl');
        await sleepImpl(Math.max(Number.isFinite(wait)?wait:0,5000*2**attempt));continue;
      }
      if(!r.ok)throw Error('HTTP '+r.status+' '+url);
      let data=await r.json();
      // The public unauthenticated metadata is configuration, never account records/HAR.
      if(url===BOOTSTRAP)data=Object.fromEntries(Object.entries(data).filter(([k])=>/^(ad|account|account_profile|account_disabled)_metadata$/.test(k)));
      const x={url,observedAt:new Date().toISOString(),sha256:digest(JSON.stringify(data)),data};save(file,x);return x;
    }
  }
  try {
    const boot=await get(BOOTSTRAP);save(path.join(directory,'metadata.json'),boot);
    const brands=await get(catalogUrl('category_2010'));validateNodes(brands.data,'category_2010','mark');
    state.source=brands.url;state.brandsObservedAt=brands.observedAt;
    state.brands=brands.data.map(node=>({node,models:[],complete:false}));checkpoint();
    // Breadth first: save all observed model lists before the longer generation pass.
    for(const b of state.brands){const x=await get(catalogUrl(b.node.value));validateNodes(x.data,b.node.value,'model');b.models=x.data.map(node=>({node,generations:[],complete:false}));b.complete=true;b.observedAt=x.observedAt;checkpoint();progress({phase:'models',brands:state.brands.filter(x=>x.complete).length,models:state.brands.reduce((s,x)=>s+x.models.length,0)});}
    for(const b of state.brands)for(const m of b.models){const x=await get(catalogUrl(m.node.value));validateNodes(x.data,m.node.value,'generation');m.generations=x.data;m.complete=true;m.observedAt=x.observedAt;if(requests%20===0&&requests!==lastProgress)checkpoint();progress({phase:'generations',done:state.brands.reduce((s,x)=>s+x.models.filter(m=>m.complete).length,0),models:state.brands.reduce((s,x)=>s+x.models.length,0)});}
    state.complete=true;checkpoint();console.log(JSON.stringify({complete:true,brands:state.brands.length,models:state.brands.reduce((s,b)=>s+b.models.length,0),generations:state.brands.reduce((s,b)=>s+b.models.reduce((n,m)=>n+m.generations.length,0),0),requests}));
  } catch(e) {state.failures.push({at:new Date().toISOString(),url:currentUrl,message:e.message});checkpoint();console.log(JSON.stringify({complete:false,reason:e.message,requests,checkpoint:path.join(directory,'catalog.json')}));if(e.message!=='PAUSED')throw e;
  } finally {process.off('SIGINT',onSignal);process.off('SIGTERM',onSignal);}
  return state;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args=process.argv.slice(2);const value=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
 await collect({directory:value('--directory','work/kufar-cars-used'),maxRequests:Number(value('--max-requests',Infinity)),interval:Number(value('--interval',1100))});
}
