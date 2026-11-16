import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {save,TYPE_ANOMALIES} from './collect.mjs';

export function auditCatalog(state,schema){
  const fields=schema[0].options;
  const root=fields.find(f=>f.id==='kufar.cars_brand_v2');
  if(!root)throw Error('Missing brand field');
  const source=new Map(),normalized=new Map(),ambiguities=[],emptyModels=[],unvisited=[];
  const siblingNames=(nodes,parent)=>{
    const groups=new Map();
    for(const node of nodes){const key=node.labels.ru.normalize('NFC').trim().toLocaleLowerCase('ru');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(node);}
    for(const [name,matches] of groups)if(matches.length>1)ambiguities.push({parent,name,values:matches.map(n=>n.value)});
  };
  const put=(node,parent,level)=>{if(source.has(node.value))throw Error('Duplicate native value '+node.value);source.set(node.value,{name:node.labels.ru,parent,level});};
  siblingNames(state.brands.map(b=>b.node),'category_2010');
  for(const b of state.brands){
    put(b.node,null,'kufar.cars_brand_v2');siblingNames(b.models.map(m=>m.node),b.node.value);
    if(!b.complete)unvisited.push(b.node.value);
    for(const m of b.models){
      put(m.node,b.node.value,'kufar.cars_model_v2');siblingNames(m.generations,m.node.value);
      if(!m.complete)unvisited.push(m.node.value);
      else if(!m.generations.length)emptyModels.push(m.node.value);
      for(const g of m.generations)put(g,m.node.value,'kufar.cars_gen_v2');
    }
  }
  const visit=(node,parent)=>{
    if(normalized.has(node.value))throw Error('Duplicate normalized value '+node.value);
    normalized.set(node.value,{name:node.name,parent,level:node.level});
    for(const c of node.childOptions)visit(c,node.value);
  };
  for(const b of root.options)visit(b,null);
  if(source.size!==normalized.size)throw Error('Catalog node count mismatch');
  for(const [value,expected] of source){const actual=normalized.get(value);if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Changed label/code/parent/level: '+value);}
  const source_type_anomalies=[...TYPE_ANOMALIES].filter(([value])=>source.has(value)).map(([value,types])=>({value,...types,reason:'Native field name cars_gen_v2 and parent-scoped generation code identify the level; original node_type is retained in source evidence.'}));
  return {category_id:'cars_used_sale',platform:'kufar',complete:state.complete,source_nodes:source.size,normalized_nodes:normalized.size,exact_native_value_label_parent_match:true,empty_generation_lists:emptyModels,unvisited_lists:unvisited,ambiguous_sibling_names:ambiguities,source_type_anomalies,policy:'Do not merge or pick the first equal name. Keep native codes and parent context; ambiguous future mappings remain needs_review.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const dir='data/parsing/cars_used_sale';const read=f=>JSON.parse(fs.readFileSync(path.join(dir,f)));
  const result=auditCatalog(read('evidence/kufar-catalog-source.json'),read('cars_used_sale_kufar.json'));
  save(path.join(dir,'evidence/kufar-catalog-audit.json'),result);
  console.log(JSON.stringify({nodes:result.source_nodes,complete:result.complete,empty:result.empty_generation_lists.length,unvisited:result.unvisited_lists.length,ambiguities:result.ambiguous_sibling_names.length}));
}
