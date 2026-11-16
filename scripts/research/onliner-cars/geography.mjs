import fs from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
import {ROOT,save,digest,checkList} from './collect.mjs';

// Belarus is the researched publication scope. Do not pretend that the other
// countries offered by Onliner have been exhaustively researched.
const directory='work/onliner-cars-used';
async function get(suffix){
  const url=ROOT+suffix,file=directory+'/cache/'+digest(url)+'.json';
  if(fs.existsSync(file)){const x=JSON.parse(fs.readFileSync(file));if(x.url!==url||x.sha256!==digest(JSON.stringify(x.data)))throw Error('Corrupt geographic cache');return x;}
  await sleep(1200);
  const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error('Geography HTTP '+r.status+'; stop, do not retry aggressively');
  const data=await r.json(),x={url,observedAt:new Date().toISOString(),data,sha256:digest(JSON.stringify(data))};save(file,x);return x;
}
const country=await get('/countries/248');
if(country.data.id!==248)throw Error('Wrong country');
checkList(country.data.regions,'Belarus regions');
const regions=[];
for(const region of country.data.regions){
  const x=await get('/countries/248/regions/'+region.id);
  if(x.data.id!==region.id)throw Error('Wrong region');
  checkList(x.data.cities,'cities '+region.id);regions.push(x);
}
save(directory+'/geography.json',{scope:'Belarus',country,regions,complete:true});
console.log(JSON.stringify({regions:regions.length,cities:regions.reduce((n,r)=>n+r.data.cities.length,0)}));
