import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {extensionRecipe} from '../lib/extension-config.ts';
import {categories,mappingOptions} from '../lib/taxonomy.ts';
const require=createRequire(import.meta.url);
const core=require('../extension/core.js');

test('all primary categories and marketplace corrections fit the small data-only extension protocol',()=>{
  for(const category of categories) {
    const recipe=extensionRecipe({listing:{taxonomyId:category.id}});
    assert.equal(core.validateRecipe(recipe).taxonomyId,category.id);
    assert.ok(JSON.stringify(recipe).length<10000,category.id);
  }
  for(const platform of ['kufar','onliner','flagma']) for(const option of mappingOptions(platform)) {
    const recipe=extensionRecipe({listing:{taxonomyId:'computers.gpu'},categoryOverrides:{[platform]:option.optionId}});
    assert.equal(core.validateRecipe(recipe).mappings[platform].id,option.id);
  }
});
test('extension manifest and worker do not load bundled catalogs or remote scripts',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../extension/manifest.json',import.meta.url),'utf8'));
  assert.ok(manifest.content_scripts.every(c=>c.js.every(f=>!['taxonomy.js','attributes.js'].includes(f))));
  const worker=readFileSync(new URL('../extension/background.js',import.meta.url),'utf8');
  assert.doesNotMatch(worker,/importScripts\([^)]*(?:https?:|taxonomy\.js|attributes\.js)/);
  const recipe=extensionRecipe({listing:{taxonomyId:'computers.gpu'}});
  assert.throws(()=>core.validateRecipe({...recipe,protocol:99}));
  assert.throws(()=>core.validateRecipe({...recipe,entries:[{key:'__proto__',platform:'kufar'}]}));
  const checked=core.validateRecipe({...recipe,script:'malicious()',mappings:{...recipe.mappings,kufar:{...recipe.mappings.kufar,selector:'body',script:'malicious()'}}});
  assert.equal(checked.script,undefined);assert.equal(checked.mappings.kufar.selector,undefined);
});
