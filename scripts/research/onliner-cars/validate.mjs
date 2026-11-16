import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

export function validate(schema,binding,state){
  assert.equal(schema.length,1);const category=schema[0];
  assert.equal(category.id,'cars_used_sale');assert.equal(binding.category_id,category.id);assert.equal(binding.platform,'onliner');
  const ids=new Set(),fields=new Map(),nodes=[];
  function visit(o,parent=null){
    assert.equal(typeof o.id,'string');assert(!ids.has(o.id),'Duplicate ID '+o.id);ids.add(o.id);
    assert.equal(typeof o.name,'string');assert.equal(typeof o.description,'string');assert(Array.isArray(o.options));
    assert(['text','number','integer','boolean','enum','multi_enum','choice','files','group'].includes(o.type));
    assert(!('finalId'in o));assert(!('fill_rule'in o));
    if(o.type==='choice'){
      assert('value'in o);assert.equal(o.options.length,0);
      if(o.level){assert.equal(o.options_complete,true);assert(Array.isArray(o.childOptions));nodes.push({o,parent});for(const c of o.childOptions)visit(c,o);}
    }else if(o.type!=='group')fields.set(o.id,o);
    if(['enum','multi_enum'].includes(o.type))assert.equal(o.options_complete,true,'Incomplete enum '+o.id);
    for(const c of o.options)visit(c);
  }
  category.options.forEach(o=>visit(o));
  function checkWhen(w){if(!w)return;if(w.all||w.any){for(const c of w.all||w.any)checkWhen(c);return;}if(w.not){checkWhen(w.not);return;}assert(fields.has(w.option_id),'Unknown condition field');assert(['equals','not_equals','in','not_in','exists','gt','gte','lt','lte'].includes(w.operator));}
  for(const f of fields.values())checkWhen(f.when);
  for(const {o,parent} of nodes){assert.equal(fields.get(o.level)?.type,'enum');if(parent)assert.equal(fields.get(o.level).parent_option_id,parent.level);else assert(!fields.get(o.level).parent_option_id);}
  for(const f of fields.values())if(f.parent_option_id){assert(fields.has(f.parent_option_id));assert.equal(f.options.length,0);const seen=new Set([f.id]);let p=f.parent_option_id;while(p){assert(!seen.has(p));seen.add(p);p=fields.get(p)?.parent_option_id;}}
  const bound=new Map();
  for(const b of binding.fields){assert(fields.has(b.option_id));assert(!bound.has(b.option_id));bound.set(b.option_id,b);assert(['ready','needs_review','unsupported'].includes(b.status));
    if(b.status==='ready'){
      assert(b.target?.selectors?.length);assert(b.action);assert(b.verify?.kind);
      for(const t of [b.target,b.verify.target].filter(Boolean))assert(t.selectors.every(s=>typeof s==='string'&&s.trim()));
      if(b.action==='upload_files'){
        const v=b.verify;assert.equal(v.kind,'files_accepted');assert.equal(v.image_source,'background_image');assert.equal(v.items_selector,'.drop-style__upload-item_primary');assert.equal(v.image_selector,'.drop-style__upload-image');assert.equal(v.accepted_src_prefix,'https://content.onliner.by/automarket/');assert.equal(v.require_loaded,true);assert(v.counter_target.selectors.length);assert.equal(v.counter.mode,'remaining');assert.equal(v.counter.capacity,fields.get(b.option_id).validation.max_items);assert(new RegExp(v.counter.pattern,'i').test('Осталось 47 фото'));assert(new RegExp(v.counter.empty_pattern,'i').test('Перетащите сюда до 50 фотографий'));
      }
      if(b.option_id==='onliner.phone'){
        assert.equal(b.action,'set_value');assert.equal(b.verify.kind,'value_equals');assert.equal(b.overwrite,'if_empty');assert.deepEqual(b.depends_on,['onliner.onlyChat']);assert.deepEqual(b.target.selectors,['.vehicle-form__field > .vehicle-form__line_condensed-either:first-child input[type=tel].vehicle-form__input_width_xxssmm']);assert.equal(fields.get(b.option_id).type,'text');assert.equal(fields.get(b.option_id).validation.max_length,55);assert.equal(fields.get(b.option_id).required,null);assert(!fields.get(b.option_id).when,'Chat mode makes phone optional, not inapplicable');
      }
      if(b.option_id==='onliner.year'){
        const root='.vehicle-form__group:has(select.vehicle-form__button-select)';
        assert.equal(b.action,'choose');assert.equal(b.match,'text');assert.equal(b.suggestions.option_action,'select_option');assert.equal(b.suggestions.match,'exact_text');assert.equal(b.suggestions.selector,root+' a.vehicle-form__button_choose, '+root+' select.vehicle-form__button-select option');assert.equal(b.verify.kind,'selected_text_equals');assert.deepEqual(b.verify.target.selectors,[root+' a.button-style_active, '+root+' div.button-style_active > select.vehicle-form__button-select > option:checked']);assert.deepEqual(b.depends_on,['onliner.model']);assert.deepEqual(b.events,['input','change']);assert.equal(b.overwrite,'if_empty');
      }
      if(fields.get(b.option_id).type==='multi_enum'){assert.equal(b.selection_mode,'replace_set');assert(b.suggestions.checkbox_selector);assert(b.commit.target.selectors.length);assert.equal(b.verify.kind,'selected_text_set_equals');assert.equal(b.verify.reopen,true);}
    }else assert(b.reason);
    for(const d of b.depends_on||[])assert(fields.has(d));
  }
  assert.equal(bound.size,fields.size);
  const seen=new Set(),active=new Set();function dep(k){assert(!active.has(k),'Dependency cycle');if(seen.has(k))return;active.add(k);for(const d of bound.get(k).depends_on||[])dep(d);active.delete(k);seen.add(k);}for(const k of bound.keys())dep(k);
  assert.equal(fields.get('onliner.year').type,'integer');assert.equal(fields.get('onliner.year').options.length,0);
  assert(!fields.get('onliner.state').options.some(o=>o.value==='new'));
  const brands=fields.get('onliner.manufacturer').options;
  let models=0,generations=0;
  if(state){
    assert.equal(state.complete,true);assert.equal(state.failures.length,0);assert.equal(state.year_filter,false);
    assert.equal(brands.length,state.brands.length);
    for(const b of state.brands){const x=brands.find(x=>x.value===b.node.id);assert(x);assert.equal(x.name,b.node.name);assert.equal(b.complete,true);assert.equal(x.childOptions.length,b.models.length);
      for(const m of b.models){models++;assert.equal(m.complete,true);const y=x.childOptions.find(y=>y.value===m.node.id);assert(y);assert.equal(y.name,m.node.name);assert.equal(y.childOptions.length,m.generations.length);
        for(const g of m.generations){generations++;assert(!('year'in g));assert(!('images'in g));const z=y.childOptions.find(z=>z.value===g.id);assert(z);assert.equal(z.name,g.name);assert.equal(z.childOptions.length,0);}
      }
    }
  }else{models=brands.reduce((n,b)=>n+b.childOptions.length,0);generations=brands.reduce((n,b)=>n+b.childOptions.reduce((n,m)=>n+m.childOptions.length,0),0);}
  const rio=brands.find(b=>b.value===32)?.childOptions.find(m=>m.value===884);assert(rio?.childOptions.some(g=>g.value===6682&&g.name==='(FB) Рестайлинг'));
  const statuses=Object.fromEntries(['ready','needs_review','unsupported'].map(s=>[s,binding.fields.filter(b=>b.status===s).length]));
  return {brands:brands.length,models,generations,fields:fields.size,treeNodes:nodes.length,...statuses};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const dir='data/parsing/cars_used_sale/';const read=p=>JSON.parse(fs.readFileSync(p));console.log(JSON.stringify(validate(read(dir+'cars_used_sale_onliner.json'),read(dir+'binding_cars_used_sale_onliner.json'),read(dir+'evidence/onliner-catalog-source.json'))));}
