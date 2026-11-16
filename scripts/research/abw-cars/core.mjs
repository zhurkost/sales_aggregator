import {seed,choice,typed,treeFields,validate} from './schema.mjs';
import {GEOGRAPHY_API,parseGeography,attachGeography} from './geography.mjs';
export const API='https://b.abw.by/api/v2/create/suggest';
const params=['brand','model','year','generation','body'];
const lists=new Set(['brand','model','generation','body','engine','gear','transmission','color','condition','availability','region','city']);
const norm=s=>s.trim().toLowerCase().replaceAll('ё','е');
const observationIndexes=new WeakMap();
class CoverageError extends Error {}
export const newState=()=>({version:1,platform:'abw',category_id:'cars_used_sale',status:'partial',brands:[],regions:[],flat:{},observations:[],completedModels:[],requests:0,issues:[],rootComplete:false});
export function cleanList(value) {
  if(!Array.isArray(value))throw Error('Ожидался массив вариантов');
  return value.map(o=>{
    if(!o||!['number','string'].includes(typeof o.id)||typeof o.title!=='string'||!o.title.trim())throw Error('Неизвестный формат id/title');
    return {value:o.id,name:o.title,disabled:o.disabled===true};
  });
}
export function buildUrl(context){
  const url=new URL(API);
  if(!Object.hasOwn(context,'brand'))throw Error('Не задана марка');
  for(const name of params)if(Object.hasOwn(context,name)){
    const v=context[name];if(!['number','string'].includes(typeof v)||!/^\d+$/.test(String(v)))throw Error('Недопустимый код справочника');
    url.searchParams.set(name,String(v));
  }
  if(Object.keys(context).some(k=>!params.includes(k)))throw Error('Неизвестный параметр запроса');
  return url.href;
}
export function readHar(har){
  const records=[];
  for(const [index,e] of (har.log?.entries||[]).entries()){
    let url;try{url=new URL(e.request.url);}catch{continue;}
    if(e.request.method!=='GET'||e.response.status!==200)continue;
    if(url.href===GEOGRAPHY_API){
      const c=e.response.content;if(!c?.text)continue;
      const data=JSON.parse(c.encoding==='base64'?new TextDecoder().decode(Uint8Array.from(atob(c.text),x=>x.charCodeAt(0))):c.text);
      parseGeography(data.city);
      records.push({index,context:{},geography:data.city});continue;
    }
    // Read ONLY the public brand dictionary from a recorded VIN response.
    // Never retain its URL, VIN, advert, preview or inferred vehicle selections.
    if(url.origin==='https://b.abw.by'&&/^\/api\/v2\/create\/vin\/[A-Za-z0-9]{17}$/.test(url.pathname)){
      let x;try{const c=e.response.content;x=JSON.parse(c.encoding==='base64'?new TextDecoder().decode(Uint8Array.from(atob(c.text),x=>x.charCodeAt(0))):c.text);}catch{continue;}
      if(Array.isArray(x.options?.brand)&&x.options.brand.length){cleanList(x.options.brand);records.push({index,context:{},data:{brand:x.options.brand},root:true});}
      continue;
    }
    if(url.origin+url.pathname!==API)continue;
    if([...url.searchParams.keys()].some(k=>!params.includes(k)))continue;
    const context=Object.fromEntries(url.searchParams);if(!context.brand)continue;
    buildUrl(context);
    let response;try{const c=e.response.content;response=JSON.parse(c.encoding==='base64'?new TextDecoder().decode(Uint8Array.from(atob(c.text),x=>x.charCodeAt(0))):c.text);}catch{continue;}
    if(!response||typeof response!=='object'||Array.isArray(response))continue;
    const known=Object.keys(response).filter(k=>lists.has(k)||k==='year');
    if(!known.length)continue;
    for(const k of known)cleanList(response[k]);
    records.push({index,context,data:Object.fromEntries(known.map(k=>[k,response[k]]))});
  }
  if(!records.length)throw Error('В HAR нет успешных GET create/suggest с JSON-справочниками.');
  return records; // Raw HAR, headers and year dictionaries never enter persistent state.
}
function merge(nodes,values){
  for(const value of values){
    let found=nodes.find(n=>typed(n.value)===typed(value.value));
    if(!found)found=nodes.find(n=>n.value===null&&norm(n.name)===norm(value.name));
    if(found){if(norm(found.name)!==norm(value.name))throw Error('Разные названия одного кода справочника');Object.assign(found,value);}
    else nodes.push({...value,children:[],listComplete:false});
  }
}
function resolve(nodes,value){const matches=nodes.filter(n=>String(n.value)===String(value));if(matches.length>1)throw Error('Неоднозначный тип кода в URL');return matches[0];}
export function ingest(state,data,context){
  if(data.brand){
    const root=cleanList(data.brand);
    for(const n of root){const old=resolve(state.brands,n.value);if(old&&norm(old.name)===norm(n.name))old.value=n.value;}
    merge(state.brands,root);state.rootComplete=true;
  }
  let index=observationIndexes.get(state);
  if(!index){index=new Set(state.observations.map(o=>JSON.stringify(o)));observationIndexes.set(state,index);}
  const sanitizedContext=Object.fromEntries(Object.entries(context).filter(([k])=>params.includes(k)&&k!=='year'));
  let brand=resolve(state.brands,context.brand);
  if(!brand&&context.brand!==undefined){
    // An observed URL establishes the query code, not a guessed numeric type.
    const name=String(context.brand)==='254'?'Kia':null;
    if(!name)throw Error('Неизвестна подпись марки из URL; нужен исходный список марок.');
    brand={name,value:context.brand,children:[],listComplete:false};state.brands.push(brand);
  }
  for(const [name,raw]of Object.entries(data)){
    if(name==='year'||!lists.has(name))continue;
    const values=cleanList(raw);
    const observation={context:sanitizedContext,year_filtered:Object.hasOwn(context,'year'),field:name,options:values};
    const serialized=JSON.stringify(observation);
    if(!index.has(serialized)){state.observations.push(observation);index.add(serialized);}
    if(name==='model'){if(!brand)throw Error('Модели без марки');merge(brand.children,values);brand.listComplete=true;}
    else if(name==='generation'){
      const model=resolve(brand.children,context.model);if(!model)throw Error('Поколения без известной модели');merge(model.children,values);
    }else if(!treeFields.has(name)){state.flat[name]||=[];merge(state.flat[name],values);}
  }
}
export function importHar(records,state=newState()){
  // The brand reply must precede its generations even if a HAR was sorted differently.
  for(const r of [...records].sort((a,b)=>Object.keys(a.context).length-Object.keys(b.context).length)){
    if(r.geography){const g=parseGeography(r.geography);state.regions=g.regions;state.geographyComplete=true;state.popularCities=g.popular;}
    else ingest(state,r.data,r.context);
  }
  return state;
}
export function resumeSummary(s,{retryReview=false}={}){
  const completed=new Set(s.completedModels),review=new Set(s.issues.filter(i=>i.kind==='coverage'&&i.modelKey).map(i=>i.modelKey));
  let next=null,pending=0,deferred=0;
  for(const brand of s.brands){
    if(!brand.listComplete&&!next)next={brand:brand.name,model:null};
    for(const model of brand.children){
      const key=typed(brand.value)+'/'+typed(model.value);
      if(completed.has(key))continue;
      if(review.has(key)&&!retryReview){deferred++;continue;}
      pending++;next||={brand:brand.name,model:model.name};
    }
  }
  return {deferredModels:deferred,pendingKnownModels:pending,next};
}
export function stats(s){return {status:s.status,brands:s.brands.length,models:s.brands.reduce((n,b)=>n+b.children.length,0),generations:s.brands.reduce((n,b)=>n+b.children.reduce((m,x)=>m+x.children.length,0),0),completedModels:s.completedModels.length,requests:s.requests,brandRootLoaded:s.rootComplete,branchesNeedingReview:s.issues.filter(i=>i.kind==='coverage').length,current:s.current||null,...resumeSummary(s)};}
export async function crawl({state,request,save=async()=>{},progress=()=>{},stopped=()=>false,responseCache=new Map(),concurrency=1,retryReview=false}){
  if(!state.brands.length)throw Error('Сначала нужен HAR с маркой и моделями');
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>5)throw Error('Число параллельных ветвей должно быть от 1 до 5');
  const completed=new Set(state.completedModels),review=new Set(state.issues.filter(i=>i.kind==='coverage'&&i.modelKey).map(i=>i.modelKey));
  const skip=key=>completed.has(key)||(!retryReview&&review.has(key));
  state.status='running';
  state.collectionScope='catalog_only_preserve_flat';
  const log=(stage,brand=state.current?.brand||null,model=state.current?.model||null)=>{
    state.current={brand,model,stage};state.activity||=[];
    state.activity.push({at:new Date().toISOString(),...state.current});
    if(state.activity.length>100)state.activity.splice(0,state.activity.length-100);
    progress(stats(state));
  };
  log('Подготовка',null,null);
  let branchFailure=null;
  const cache=responseCache; // Full year context stays only in the caller's RAM across retries.
  const call=async(context)=>{
    if(stopped())throw Error('Остановлено пользователем');
    if(branchFailure)throw branchFailure;
    const url=buildUrl(context);if(cache.has(url))return cache.get(url);
    const result=await request(url);state.requests++;ingest(state,Object.fromEntries(Object.entries(result).filter(([name])=>['brand','model','generation','year'].includes(name))),context);await save(state,{force:false});cache.set(url,result);progress(stats(state));return result;
  };
  const required=(response,key)=>{if(!Object.hasOwn(response,key))throw new CoverageError('В ответе отсутствует '+key);return cleanList(response[key]);};
  try{
    for(const brand of state.brands){
      if(brand.listComplete&&brand.children.every(model=>skip(typed(brand.value)+'/'+typed(model.value))))continue;
      log('Марка',brand.name,null);
      if(brand.disabled)throw Error('Недоступная марка');
      const bc={brand:brand.value};if(!brand.listComplete)required(await call(bc),'model');
      for(const model of brand.children){
        const done=typed(brand.value)+'/'+typed(model.value);if(skip(done))continue;
        branchFailure=null;
        log('Начало модели',brand.name,model.name);await save(state);
        try {
        if(model.disabled)throw Error('Недоступная модель');
        const mc={...bc,model:model.value};const years=required(await call(mc),'year');
        if(!years.length)throw new CoverageError('Нет годов модели; полнота не подтверждена');
        branchFailure=null;
        let nextYear=0;
        const visitYear=async year=>{
          if(year.disabled)throw Error('Недоступный год; ветвь неполна');
          const yc={...mc,year:year.value};const generations=required(await call(yc),'generation');
          if(!generations.length)throw new CoverageError('Нет поколений; требуется проверить форму без поколения');
          // Generation options are ingested above. Do not select generations or
          // request technical dictionaries: existing flat arrays stay unchanged.

        };
        const worker=async()=>{
          while(!branchFailure&&nextYear<years.length){
            const year=years[nextYear++];
            try{await visitYear(year);}catch(e){branchFailure||=e;}
          }
        };
        await Promise.all(Array.from({length:Math.min(concurrency,years.length)},worker));
        if(branchFailure)throw branchFailure;
        state.issues=state.issues.filter(i=>i.modelKey!==done);
        model.listComplete=true;state.completedModels.push(done);completed.add(done);cache.clear();log('Модель завершена',brand.name,model.name);await save(state);progress(stats(state));
        } catch(e) {
          if(!(e instanceof CoverageError))throw e;
          branchFailure=null;
          state.issues=state.issues.filter(i=>i.modelKey!==done);
          state.issues.push({kind:'coverage',modelKey:done,brand:brand.name,model:model.name,message:e.message});
          log('Модель требует проверки',brand.name,model.name);
          cache.clear();await save(state);progress(stats(state));
        }
      }
    }
    // This source does not establish the complete brand/geography/flat-field roots.
    state.status=state.issues.some(i=>i.kind==='coverage')?'observed_scope_with_gaps':'observed_scope_complete';log('Обход завершён');await save(state);return state;
  }catch(e){state.status=stopped()?'paused':'blocked';state.issues.push({message:e.message,atRequest:state.requests});log(stopped()?'Остановлено':'Ошибка');try{await save(state);}catch(storageError){throw Error(e.message+' '+storageError.message);}throw e;}
}
export function resultFiles(state,ui){
  const {schema,binding}=seed(ui),fields=schema[0].options;
  const get=k=>fields.find(f=>f.id==='abw.'+k);
  function convert(nodes,level,old=[],parent=''){
    return nodes.map(n=>{
      const matches=old.filter(o=>norm(o.name)===norm(n.name));
      const c=choice(level,n.name,n.value,parent);if(matches.length===1)c.id=matches[0].id;
      const next={brand:'model',model:'generation'}[level];
      return {...c,level:'abw.'+level,options_complete:next?n.listComplete:true,
        childOptions:next?convert(n.children,next,matches[0]?.childOptions||[],c.id+'.'):[]};
    });
  }
  if(state.brands.length)get('brand').options=convert(state.brands,'brand',get('brand').options);
  get('brand').options_complete=state.rootComplete;
  for(const [key,values] of Object.entries(state.flat)){
    const f=get(key);if(!f)continue;
    for(const n of values){
      let c=f.options.find(o=>typed(o.value)===typed(n.value));
      if(!c)c=f.options.find(o=>o.value===null&&norm(o.name)===norm(n.name));
      if(c){c.value=n.value;c.name=n.name;}else f.options.push(choice(key,n.name,n.value));
    }
  }
  schema[0].description+=' Покрытие: '+state.status+'. Все списки могут дополняться.';
  get('modification').description='Сбор модификаций исключён заданием пользователя. Ранее собранные варианты сохраняются только как исторические данные.';
  get('modification').options_complete=false;
  attachGeography(state,schema,binding);
  validate({schema,binding});
  const report=['ABW / cars_used_sale / исследовательский контракт 2.2',JSON.stringify(stats(state),null,2),
    'Границы заданы пользователем в чате: аналогично AV.by, легковые с пробегом, этап A. parsing_input.txt не создавался.',
    'UI и сохранённый HAR прочитаны без запросов агента. Browser binding не исполнялся.',
    state.geographyComplete?'География собрана из полного grouped city ответа create/options: область → город. Области — группы без нативного ID; Популярные исключены как дубли.':'География пока не восстановлена; выдуманных родителей нет.',
    'Кузов, двигатель, привод и коробка сохранены из прежнего результата без новых запросов и изменений. Текущий обход собирает только марки, модели и поколения; полнота плоских списков отдельно не подтверждена.',
    'Поколения получаются после кода года. Годы/коды годов/диапазоны не сохраняются; повторное открытие требует повторного прохода незавершённой модели.',
    'Корневой список марок берётся только из записанного массива options.brand; его полнота относится к этому ответу. observed_scope_complete НЕ означает полный сбор всех полей площадки.',
    'После получения поколений переход к следующему году. Запросов выбора поколения, кузова и технических сочетаний нет. Готовые модели пропускаются; прежние coverage-проблемы повторяются только по отдельной опции.',
    'Нет подтверждённых CSS-селекторов, проверки записи/чтения полей и загрузки фото. Все binding — needs_review.',
    ...ui.notes,...state.issues.map(i=>i.message)].join('\n')+'\n';
  return {'cars_used_sale_abw.json':schema,'binding_cars_used_sale_abw.json':binding,'report_cars_used_sale_abw.txt':report,'evidence/abw-catalog-source.json':state};
}
