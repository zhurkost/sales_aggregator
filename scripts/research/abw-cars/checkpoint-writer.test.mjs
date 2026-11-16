import test from 'node:test';
import assert from 'node:assert/strict';
import {createCheckpointWriter} from './checkpoint-writer.mjs';
test('coalesces response snapshots, forces error/stop checkpoints, and retains dirty data on storage failure',async()=>{
  let now=0,fail=false;const writes=[];
  const writer=createCheckpointWriter(async state=>{if(fail)throw Error('disk');writes.push(structuredClone(state));},{now:()=>now});
  await writer.save({requests:1},{force:false});
  for(let i=2;i<=100;i++){now+=10;await writer.save({requests:i},{force:false});}
  assert.equal(writes.length,1);assert.equal(writer.dirty,true);
  now=2000;await writer.save({requests:101},{force:false});assert.equal(writes.length,2);
  await writer.save({requests:102,status:'blocked'});assert.equal(writes.at(-1).requests,102);assert.equal(writer.dirty,false);
  fail=true;await assert.rejects(writer.save({requests:103}),/disk/);assert.equal(writer.dirty,true);
  fail=false;await writer.save({requests:103});assert.equal(writer.dirty,false);
});
test('concurrent forced saves serialize and latest state wins',async()=>{
  let live=0,peak=0;const writes=[];
  const writer=createCheckpointWriter(async state=>{live++;peak=Math.max(peak,live);await new Promise(r=>setTimeout(r,2));writes.push(structuredClone(state));live--;});
  await Promise.all([writer.save({requests:1}),writer.save({requests:2}),writer.save({requests:3})]);
  assert.equal(peak,1);assert.equal(writes.at(-1).requests,3);assert.equal(writer.dirty,false);
});
