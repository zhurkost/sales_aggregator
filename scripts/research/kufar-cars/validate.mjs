import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const fail = message => {throw Error(message);};
export function validate(schema,binding,{requireComplete=false}={}) {
  if(!Array.isArray(schema)||schema.length!==1)fail('Expected one Category');
  const category=schema[0],ids=new Map(),fields=new Map(),nodes=[];
  const allowed=new Set(['group','text','integer','number','boolean','date','datetime','enum','multi_enum','choice','files']);
  const visit=(o,parentChoice=null,containerField=null)=>{
    if(typeof o.id!=='string'||!o.id||ids.has(o.id))fail('Duplicate/empty ID: '+o.id);
    ids.set(o.id,o);
    if(typeof o.name!=='string'||typeof o.description!=='string'||!allowed.has(o.type)||!Array.isArray(o.options))fail('Invalid option '+o.id);
    if('fill_rule'in o||'finalId'in o)fail('Legacy/abandoned property '+o.id);
    if(o.type==='choice'){
      if(!('value'in o)||o.options.length)fail('Invalid choice '+o.id);
      if(o.level){
        if(!Array.isArray(o.childOptions)||typeof o.options_complete!=='boolean')fail('Missing child completeness '+o.id);
        if(requireComplete&&!o.options_complete)fail('Incomplete children '+o.id);
        nodes.push({node:o,parent:parentChoice,containerField});
        for(const c of o.childOptions){if(c.type!=='choice')fail('Non-choice child '+o.id);visit(c,o,containerField);}
      }else if('childOptions'in o)fail('Tree choice has no level '+o.id);
    }else if(o.type!=='group')fields.set(o.id,o);
    if(['enum','multi_enum'].includes(o.type)){
      if(typeof o.options_complete!=='boolean')fail('Missing enum completeness '+o.id);
      if(requireComplete&&!o.options_complete)fail('Incomplete enum '+o.id);
      for(const c of o.options){if(c.type!=='choice')fail('Non-choice enum option '+o.id);visit(c,null,o);}
    }else for(const c of o.options)visit(c,null,null);
  };
  if(typeof category.id!=='string'||!Array.isArray(category.options)||!Array.isArray(category.categories)||category.categories.length)fail('Expected one flat research category');
  for(const o of category.options)visit(o);
  for(const {node,parent,containerField} of nodes){
    const field=fields.get(node.level);if(field?.type!=='enum')fail('Unknown/non-enum level '+node.id);
    if(parent){if(field.parent_option_id!==parent.level)fail('Wrong parent level '+node.id);}
    else if(field.parent_option_id||field!==containerField)fail('Wrong tree root '+node.id);
  }
  const checkWhen=w=>{
    if(!w)return;
    if(w.all||w.any){for(const c of w.all||w.any)checkWhen(c);return;}
    if(w.not){checkWhen(w.not);return;}
    if(!fields.has(w.option_id))fail('Unknown condition field '+w.option_id);
    if(!['equals','not_equals','in','not_in','exists','gt','gte','lt','lte'].includes(w.operator))fail('Unknown condition operator');
  };
  for(const o of ids.values())checkWhen(o.when);
  for(const f of fields.values())if(f.parent_option_id){
    const seen=new Set([f.id]);let p=f.parent_option_id;
    while(p){if(seen.has(p))fail('Parent cycle '+f.id);seen.add(p);if(!fields.has(p))fail('Missing parent '+p);p=fields.get(p).parent_option_id;}
    if(f.options.length)fail('Dependent level duplicates options '+f.id);
  }
  if(binding.category_id!==category.id||binding.platform!=='kufar')fail('Binding identity mismatch');
  const bound=new Map();
  for(const b of binding.fields){
    if(bound.has(b.option_id)||!fields.has(b.option_id))fail('Duplicate/unknown binding '+b.option_id);
    bound.set(b.option_id,b);
    if(b.status==='ready'){
      if(!b.target?.selectors?.length||!b.action||!b.verify?.kind)fail('Incomplete ready binding '+b.option_id);
      if(!['set_value','select_option','set_checked','choose','click','autocomplete','upload_files','sequence'].includes(b.action))fail('Unknown ready action '+b.option_id);
      if(!['value_equals','selected_text_equals','selected_text_set_equals','checked_equals','files_accepted'].includes(b.verify.kind))fail('Unknown verification '+b.option_id);
      for(const t of [b.target,b.verify.target].filter(Boolean))if(!Array.isArray(t.selectors)||!t.selectors.length||t.selectors.some(s=>typeof s!=='string'||!s.trim()))fail('Invalid selector target '+b.option_id);
      if(b.action==='upload_files'&&b.verify.kind!=='files_accepted')fail('Upload requires server acceptance');
      if(fields.get(b.option_id).type==='multi_enum'){
        if(b.action!=='choose'||b.selection_mode!=='replace_set'||!b.suggestions?.checkbox_selector||!b.commit?.target?.selectors?.length||b.verify.kind!=='selected_text_set_equals'||!b.verify.target?.selectors?.length||!b.verify.items_selector||b.verify.reopen!==true)fail('Incomplete multi-set recipe '+b.option_id);
      }
      if(b.action==='upload_files'){
        if(!b.verify.items_selector||!b.verify.image_selector||!b.verify.accepted_src_prefix?.startsWith('https://')||b.verify.require_loaded!==true||!b.verify.counter_target?.selectors?.length)fail('Incomplete server-photo recipe '+b.option_id);
      }
    }else if(!['needs_review','unsupported'].includes(b.status)||!b.reason)fail('Unexplained binding '+b.option_id);
    for(const dependency of b.depends_on||[])if(!fields.has(dependency))fail('Unknown dependency '+dependency);
  }
  for(const f of fields.keys())if(!bound.has(f))fail('Missing binding '+f);
  const seen=new Set(),active=new Set();
  const walk=x=>{if(active.has(x))fail('Binding dependency cycle');if(seen.has(x))return;active.add(x);for(const p of bound.get(x).depends_on||[])walk(p);active.delete(x);seen.add(x);};
  for(const f of bound.keys())walk(f);
  const condition=fields.get('kufar.condition');
  if(condition?.options.length!==1||condition.options[0].value!=='1')fail('Out-of-scope new cars');
  const root=fields.get('kufar.cars_brand_v2');
  if(!root)fail('Missing brand tree');
  const kia=root.options.find(x=>x.name==='Kia'),rio=kia?.childOptions.find(x=>x.name==='Rio');
  if(requireComplete&&!rio?.childOptions.some(x=>x.name==='IV Рестайлинг'))fail('Sample generation missing');
  return {fields:fields.size,options:ids.size,treeNodes:nodes.length,ready:[...bound.values()].filter(b=>b.status==='ready').length,needs_review:[...bound.values()].filter(b=>b.status==='needs_review').length,unsupported:[...bound.values()].filter(b=>b.status==='unsupported').length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const dir='data/parsing/cars_used_sale';const read=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
  console.log(JSON.stringify(validate(read('cars_used_sale_kufar.json'),read('binding_cars_used_sale_kufar.json'),{requireComplete:!process.argv.includes('--allow-partial')})));
}
