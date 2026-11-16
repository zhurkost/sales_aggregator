import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';

export const ROOT='https://ab.onliner.by/sdapi/ab.api';
export const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
export function save(file,data){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(data,null,2)+'\n');fs.renameSync(file+'.tmp',file);}
export function checkList(items,label){
  if(!Array.isArray(items))throw Error('Not an array: '+label);
  const ids=new Set();for(const item of items){if(!Number.isInteger(item.id)||item.id<1||!item.name||ids.has(item.id))throw Error('Invalid/duplicate ID: '+label);ids.add(item.id);}return items;
}
const node=({id,name,slug,counters})=>({id,name,slug,...(counters?{counters}:{})});
export async function collect({directory='work/onliner-cars-used',interval=600,maxRequests=Infinity,fetchImpl=fetch,sleepImpl=sleep}={}){
  if(!Number.isFinite(interval)||interval<500)throw Error('Minimum start interval 500ms');
  if(maxRequests!==Infinity&&(!Number.isInteger(maxRequests)||maxRequests<0))throw Error('Invalid request limit');
  const cache=path.join(directory,'cache');let requests=0,last=0,stopped=false;
  const stop=()=>{stopped=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
  const state={platform:'onliner',category_id:'cars_used_sale',startedAt:new Date().toISOString(),complete:false,year_filter:false,brands:[],failures:[]};
  const checkpoint=()=>{state.requests=requests;state.updatedAt=new Date().toISOString();save(path.join(directory,'catalog.json'),state);};
  async function get(url){
    if(!/^https:\/\/ab\.onliner\.by\/sdapi\/ab\.api\/(dictionaries|manufacturers\/\d+(\/models\/\d+)?)$/.test(url))throw Error('Unobserved endpoint');
    const file=path.join(cache,digest(url)+'.json');
    if(fs.existsSync(file)){const x=JSON.parse(fs.readFileSync(file));if(x.url!==url||x.sha256!==digest(JSON.stringify(x.data)))throw Error('Corrupt cache');return x;}
    for(let attempt=0;attempt<3;attempt++){
      if(stopped||requests>=maxRequests)throw Error('PAUSED');
      await sleepImpl(Math.max(0,last+interval-Date.now()));last=Date.now();requests++;
      const r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(30000),headers:{Accept:'application/json'}});
      if([429,503].includes(r.status)){const h=r.headers.get('retry-after');const wait=h&&/^\d+$/.test(h)?Number(h)*1000:h?Date.parse(h)-Date.now():0;if(attempt===2)throw Error('Repeated HTTP '+r.status);await sleepImpl(Math.max(Number.isFinite(wait)?wait:0,5000*2**attempt));continue;}
      if(!r.ok)throw Error('HTTP '+r.status+' '+url);
      const raw=await r.json();
      // Deliberately do not collect per-generation years or images. Keep the
      // authoritative IDs/names and counts; no request ever includes a year.
      const data=url.endsWith('/dictionaries')?raw:{...node(raw),...(raw.models?{models:raw.models.map(node)}:{}),...(raw.generations?{generations:raw.generations.map(node)}:{})};
      const x={url,observedAt:new Date().toISOString(),sha256:digest(JSON.stringify(data)),data};save(file,x);return x;
    }
  }
  try{
    const dict=await get(ROOT+'/dictionaries');save(path.join(directory,'dictionaries.json'),dict);
    state.brands=checkList(dict.data.manufacturer,'manufacturers').map(b=>({node:node(b),models:[],complete:false}));checkpoint();
    for(const b of state.brands){
      const x=await get(ROOT+'/manufacturers/'+b.node.id);if(x.data.id!==b.node.id)throw Error('Wrong manufacturer response');
      const models=checkList(x.data.models,'models '+b.node.id);if(x.data.counters.models!==models.length)throw Error('Incomplete models '+b.node.id);
      b.models=models.map(m=>({node:node(m),generations:[],complete:false}));b.complete=true;checkpoint();
      if(requests%20===0)console.log(JSON.stringify({phase:'models',brands:state.brands.filter(x=>x.complete).length,requests}));
    }
    let done=0;const total=state.brands.reduce((n,b)=>n+b.models.length,0);
    for(const b of state.brands)for(const m of b.models){
      const x=await get(ROOT+'/manufacturers/'+b.node.id+'/models/'+m.node.id);if(x.data.id!==m.node.id)throw Error('Wrong model response');
      m.generations=checkList(x.data.generations,'generations '+m.node.id);
      if(x.data.counters.generations!==m.generations.length||m.node.counters.generations!==m.generations.length)throw Error('Incomplete/changed generations '+m.node.id);
      m.complete=true;done++;if(done%20===0){checkpoint();console.log(JSON.stringify({phase:'generations',done,total,requests}));}
    }
    state.complete=true;checkpoint();console.log(JSON.stringify({complete:true,brands:state.brands.length,models:total,generations:state.brands.reduce((n,b)=>n+b.models.reduce((s,m)=>s+m.generations.length,0),0),requests}));
  }catch(e){state.failures.push({at:new Date().toISOString(),message:e.message});checkpoint();if(e.message!=='PAUSED')throw e;}
  finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
  return state;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await collect();
