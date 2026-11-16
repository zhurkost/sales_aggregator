import test from 'node:test';
import assert from 'node:assert/strict';
import {readCheckpoint} from './checkpoint.mjs';
import {newState as avState} from '../av-cars/core.mjs';
import {newState as abwState} from '../abw-cars/core.mjs';
const bundle=(p,s)=>({format:p+'-research-bundle-1',files:{[`evidence/${p}-catalog-source.json`]:s}});
for(const [platform,make]of [['av',avState],['abw',abwState]])test(platform+' restores existing v1 progress without resetting counters or completed models',()=>{
  const s=make();s.requests=12683;s.status='paused';s.completedModels=Array.from({length:30},(_,i)=>'number:254/number:'+i);
  const restored=readCheckpoint(bundle(platform,s),platform);assert.deepEqual(restored,s);assert.notEqual(restored,s);
  restored.completedModels.push('new');assert.equal(s.completedModels.length,30);
});
test('wrong platform, raw HAR, malformed tree and persisted years are rejected',()=>{
  assert.throws(()=>readCheckpoint(bundle('av',avState()),'abw'));
  assert.throws(()=>readCheckpoint({log:{entries:[]}},'av'));
  const s=avState();s.brands.push({name:'Kia',value:545});assert.throws(()=>readCheckpoint(bundle('av',s),'av'));
  const years=abwState();years.observations.push({context:{year:138}});assert.throws(()=>readCheckpoint(bundle('abw',years),'abw'));
});
