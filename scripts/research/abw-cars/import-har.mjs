import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readHar,importHar,resultFiles,stats,newState} from './core.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const [input,output,...additional]=process.argv.slice(2);
const ui=JSON.parse(fs.readFileSync(path.join(root,'data/parsing/cars_used_sale/evidence/abw-ui-observations.json'),'utf8'));
let state=newState();
const sources=[];
for(const file of [input,...additional].filter(Boolean)){
  const bytes=fs.readFileSync(file);
  state=importHar(readHar(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''))),state);
  sources.push({har_sha256:createHash('sha256').update(bytes).digest('hex')});
}
state.provenance={sources,source:'User-exported existing network logs; imported offline'};
const out=output?path.resolve(output):path.join(root,'work/abw-research');
for(const [name,value] of Object.entries(resultFiles(state,ui))){const target=path.join(out,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');}
console.log(JSON.stringify({output:out,...stats(state)},null,2));
