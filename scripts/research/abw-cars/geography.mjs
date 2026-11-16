import {choice,typed} from './schema.mjs';
export const GEOGRAPHY_API='https://b.abw.by/api/v2/create/options';

// This endpoint returns the complete grouped city menu, not search suggestions.
export function parseGeography(groups){
  if(!Array.isArray(groups)||!groups.length)throw Error('Missing city groups');
  const regions=[],popular=[],names=new Set(),cities=new Map();
  for(const group of groups){
    if(typeof group.title!=='string'||!Array.isArray(group.options)||!group.options.length)throw Error('Invalid city group');
    const items=group.options.map(o=>{
      if(!['string','number'].includes(typeof o.id)||typeof o.title!=='string'||!o.title.trim())throw Error('Invalid city code/title');
      return {name:o.title,value:o.id,children:[],listComplete:true};
    });
    if(group.title==='Популярные'){popular.push(...items);continue;}
    if(!group.title.endsWith(' область')||names.has(group.title))throw Error('Unknown or duplicate geographical group');
    names.add(group.title);
    for(const city of items){const key=typed(city.value);if(cities.has(key))throw Error('City occurs in multiple region positions');cities.set(key,city.name);}
    // The API supplies no region IDs; never substitute a fabricated native code.
    regions.push({name:group.title,value:null,groupOnly:true,children:items,listComplete:true});
  }
  if(!regions.length)throw Error('Missing regions');
  for(const city of popular)if(cities.get(typed(city.value))!==city.name)throw Error('Popular city missing from regions or has conflicting name');
  return {regions,popular:popular.map(({name,value})=>({name,value}))};
}

export function attachGeography(state,schema,binding){
  if(!state.geographyComplete||!state.regions.length)return;
  const fields=schema[0].options,city=fields.find(f=>f.id==='abw.city');
  const region={id:'abw.region',name:'Область',type:'enum',options_complete:true,required:null,
    description:'Группы списка «Город» ABW. Отдельного поля области и нативных кодов групп нет; value=null. При заполнении выбирается город по его ID.',
    options:state.regions.map(n=>{
      const parent=choice('region',n.name,null);
      return {...parent,description:'Название группы из city[].title; нативный ID отсутствует.',level:'abw.region',options_complete:true,
        childOptions:n.children.map(c=>({...choice('city',c.name,c.value,parent.id+'.'),level:'abw.city',options_complete:true,childOptions:[]}))};
    })};
  fields.splice(fields.indexOf(city),0,region);
  city.options=[];city.parent_option_id=region.id;city.options_complete=true;
  city.description='Полный список населённых пунктов из GET create/options, сгруппированный по областям. Популярные — повторные ссылки, исключены из дерева. Нативный ID города числовой.';
  binding.fields.push({option_id:region.id,status:'needs_review',reason:'Служебная группировка списка города, не самостоятельный элемент формы. Нативного ID области нет.'});
  const b=binding.fields.find(f=>f.option_id===city.id);
  b.reason='Справочник и ID подтверждены записанным ответом create/options. Город выбирается в одном списке с группами областей; запись/чтение через DOM ещё не проверены.';
}
