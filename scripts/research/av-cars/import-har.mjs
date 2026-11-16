import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {parseHar,importRecords,resultFiles,stats} from './core.mjs';
import {build,OUTPUT} from './seed.mjs';

const [input,destination]=process.argv.slice(2);
if(!input)throw Error('Usage: node scripts/research/av-cars/import-har.mjs <local HAR> [output directory]');
const out=destination?path.resolve(destination):fileURLToPath(new URL('../../../work/av-har-research/',import.meta.url));
const bytes=fs.readFileSync(input);
const parsed=parseHar(JSON.parse(bytes.toString('utf8')));
const state=importRecords(parsed.records);
// Retain only a hash and indices as provenance, not the HAR or authorization headers.
state.provenance={har_sha256:createHash('sha256').update(bytes).digest('hex'),entries:parsed.records.map(r=>r.index),imported_at:new Date().toISOString()};
const read=name=>JSON.parse(fs.readFileSync(path.join(OUTPUT,'evidence',name),'utf8'));
const seed=build(read('av-historical-recovery.json'),read('av-video-observations.json'));
for(const [name,value]of Object.entries(resultFiles(state,seed.schema,seed.binding))){
  const target=path.join(out,name);fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
}
console.log(JSON.stringify({output:out,...stats(state)},null,2));
