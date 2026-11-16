import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {GEOGRAPHY_API,parseGeography} from './geography.mjs';
import {readHar,importHar,newState,resultFiles} from './core.mjs';
import {readCheckpoint} from '../shared/checkpoint.mjs';
const groups=[{title:'Популярные',options:[{id:1,title:'Минск'}]},{title:'Минская область',options:[{id:1,title:'Минск'},{id:2,title:'Борисов'}]}];
test('geography excludes popular aliases and retains native city IDs without fabricating region IDs',()=>{
  const g=parseGeography(groups);assert.equal(g.regions.length,1);assert.equal(g.regions[0].value,null);assert.equal(g.regions[0].children.length,2);
  assert.throws(()=>parseGeography([...groups,{title:'Брестская область',options:[{id:1,title:'Минск'}]}]),/multiple/);
  assert.throws(()=>parseGeography([{title:'Популярные',options:[{id:9,title:'Другой'}]},groups[1]]),/missing/);
});
test('HAR geography import preserves car progress and roundtrips grouped schema without personal data',()=>{
  const h={log:{entries:[{request:{url:GEOGRAPHY_API,method:'GET',headers:[{name:'Cookie',value:'secret'}]},response:{status:200,content:{text:JSON.stringify({city:groups,phone:'private',engine:[{id:1,title:'ignored'}]})}}}]}};
  const s=newState();s.requests=56338;s.completedModels=['existing'];s.flat={engine:[{name:'old',value:7}]};
  importHar(readHar(h),s);assert.equal(s.requests,56338);assert.deepEqual(s.completedModels,['existing']);assert.equal(s.flat.engine[0].value,7);
  const ui=JSON.parse(fs.readFileSync(new URL('../../../data/parsing/cars_used_sale/evidence/abw-ui-observations.json',import.meta.url)));
  const files=resultFiles(s,ui),schema=files['cars_used_sale_abw.json'][0];
  const region=schema.options.find(f=>f.id==='abw.region'),city=schema.options.find(f=>f.id==='abw.city');
  assert.equal(region.options[0].childOptions[1].value,2);assert.equal(city.parent_option_id,'abw.region');assert.equal(city.options_complete,true);
  assert.deepEqual(readCheckpoint({format:'abw-research-bundle-1',files},'abw'),s);
  assert(!JSON.stringify(files).includes('secret'));assert(!JSON.stringify(files).includes('private'));assert(!JSON.stringify(files).includes('ignored'));
  s.regions[0].children[0].value=null;assert.throws(()=>readCheckpoint({format:'abw-research-bundle-1',files},'abw'));
});
