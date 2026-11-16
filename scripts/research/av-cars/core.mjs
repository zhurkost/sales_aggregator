// Shared offline parser and full crawler. No network calls occur at module load.
export const API = 'https://web-api.av.by/offer-types/cars/offer-form';
const trees = new Set(['brand','model','generation','place_region','place_city']);
const contextKeys = new Set(['condition_promotion','brand','model','year','generation','body_type','transmission_type','engine_type','drive_type','place_region','price_currency','exchange_options']);
const allowedFields = new Set(['salon_offer','condition_promotion',...trees,'year','body_type','number_of_seats','transmission_type','engine_type','engine_capacity','engine_endurance','drive_type','modification','vin','condition','mileage_compound_on_submission_form','mileage','mileage_unit','color','interior_material','interior_color','options','registration_country','registration_status','description','price_compound_on_submission_form','price_amount','price_currency','exchange_options','exchange_comment','photo','photo360','video_url','name','phones','phone_country','phone_number','number_masking']);
const omitted = new Set(['salon_offer','mileage_compound_on_submission_form','price_compound_on_submission_form','phones']);
const key = value => typeof value + ':' + JSON.stringify(value);
const same = (a,b) => key(a) === key(b);
const clone = value => structuredClone(value);
const variantIndexes = new WeakMap();
export function flatten(value) {
  if (!value || typeof value !== 'object') return [];
  if (value.name && value.fallbackType) return [value,...flatten(value.nested)];
  return Object.values(value).flatMap(flatten);
}
export function native(option) {
  for (const k of ['intValue','stringValue','boolValue']) if (Object.hasOwn(option,k)) return option[k];
  return null; // Never assume that a schema object's id is its selectable value.
}
export function cleanProperty(p) {
  const out = {};
  for (const k of ['id','name','label','fallbackType','valueFormat','required','visible','disabled','hasRelations','widget']) if (['string','number','boolean'].includes(typeof p[k])) out[k] = p[k];
  out.constraints = p.name === 'year' ? [] : (p.constraints || []).map(c => Object.fromEntries(['type','min','max'].filter(k => Object.hasOwn(c,k)).map(k => [k,c[k]])));
  out.options = p.name === 'year' ? [] : (p.options || []).map(o => ({id:o.id,name:o.label ?? o.name ?? '',value:native(o),disabled:o.disabled === true}));
  return out; // No selected values, personal data, images, year ranges or auth headers.
}
function publicContext(context) { return Object.fromEntries(Object.entries(context).filter(([k,v])=>contextKeys.has(k)&&k!=='year'&&['string','number','boolean'].includes(typeof v))); }
export function newState() {
  return {version:1,category_id:'cars_used_sale',platform:'av',status:'partial',fields:{},brands:[],regions:[],variants:[],completedModels:[],completedRegions:[],completedControls:[],issues:[],requests:0};
}
export function ingest(state, properties, context = {}) {
  let index=variantIndexes.get(state);
  if(!index){index=new Set(state.variants.map(v=>JSON.stringify(v)));variantIndexes.set(state,index);}
  for (const p of flatten(properties)) {
    if (!allowedFields.has(p.name)) continue;
    const clean = cleanProperty(p);
    if(p.name==='modification')clean.options=[]; // Keep field metadata, not modification catalogues.
    const previous = state.fields[p.name];
    if (!previous) state.fields[p.name] = clone(clean);
    else {
      if (previous.required !== clean.required) previous.required = null;
      for (const o of clean.options) {
        if (!previous.options.some(x=>same(x.value,o.value)&&x.name===o.name)) previous.options.push(o);
      }
    }
    if (p.name !== 'year') {
      const variant = {context:publicContext(context),year_filtered:Object.hasOwn(context,'year'),property:clean};
      const serialized=JSON.stringify(variant);
      if (!index.has(serialized)) {state.variants.push(variant);index.add(serialized);}
    }
  }
}
function optionNode(o) { return {name:o.label ?? o.name,value:native(o),source_id:o.id,disabled:o.disabled===true,children:[],list_complete:false,complete:false}; }
function mergeNodes(nodes, options) {
  for (const o of options || []) {
    const n=optionNode(o);
    if (n.value === null) throw Error('Нет нативного кода: '+n.name);
    const existing=nodes.find(x=>same(x.value,n.value));
    if(existing) { if(existing.name!==n.name) throw Error('Разные подписи для одного кода: '+n.value); }
    else nodes.push(n);
  }
}
function findProperty(properties,name) { return flatten(properties).find(p=>p.name===name); }
function requireList(properties,name) {
  const p=findProperty(properties,name);
  if (!p || !Array.isArray(p.options)) throw Error('В ответе отсутствует список '+name+'; ветвь не отмечена полной.');
  return p;
}
export function requestBody(context, changed) {
  if(!['condition_promotion','brand','model','year','place_region','price_currency','exchange_options'].includes(changed)||!Object.hasOwn(context,changed)) throw Error('Недопустимое изменение справочника');
  const values={condition_promotion:2,mileage_unit:1,price_currency:2,exchange_options:1,...context};
  return {properties:Object.entries(values).filter(([k])=>contextKeys.has(k)||k==='mileage_unit').map(([name,value])=>({name,value,...(name===changed?{modified:true,previousValue:null}:{})}))};
}
export function parseHar(har) {
  const records=[]; let headers={};
  for(const [index,e]of (har.log?.entries||[]).entries()) {
    if (![API,API+'/update'].includes(e.request?.url) || e.response?.status!==200) continue;
    const text=e.response.content?.text;
    if (!text) continue;
    const decoded=e.response.content.encoding==='base64'
      ? new TextDecoder().decode(Uint8Array.from(atob(text),c=>c.charCodeAt(0))) : text;
    let response,request;
    try {response=JSON.parse(decoded);request=JSON.parse(e.request.postData?.text||'null');} catch {continue;}
    const properties=response.formSteps?flatten(response.formSteps):flatten(response.properties);
    if(!properties.length)continue;
    const context=Object.fromEntries((request?.properties||[]).filter(p=>contextKeys.has(p.name)&&['string','number','boolean'].includes(typeof p.value)).map(p=>[p.name,p.value]));
    const modified=request?.properties?.filter(p=>p.modified).map(p=>p.name)||[];
    records.push({index,initial:e.request.url===API,properties,context,modified});
    for(const h of e.request.headers||[]) if(['x-api-key','x-device-type','x-user-group'].includes(h.name.toLowerCase())) headers[h.name.toLowerCase()]=h.value;
  }
  if(!records.some(r=>r.initial))throw Error('В HAR нет успешного ответа начальной offer-form.');
  return {records,headers}; // Headers stay in memory only, never in state/export.
}
export function importRecords(records, state = newState()) {
  for(const r of records) {
    ingest(state,r.properties,r.context);
    if(r.initial) {
      mergeNodes(state.brands,requireList(r.properties,'brand').options);
      mergeNodes(state.regions,requireList(r.properties,'place_region').options);
    }
    const b=state.brands.find(b=>same(b.value,r.context.brand));
    const models=findProperty(r.properties,'model');
    if(b&&models) {mergeNodes(b.children,models.options);b.list_complete=true;}
    const m=b?.children.find(m=>same(m.value,r.context.model));
    const generations=findProperty(r.properties,'generation');
    if(m&&generations) mergeNodes(m.children,generations.options);
    const region=state.regions.find(g=>same(g.value,r.context.place_region));
    const cities=findProperty(r.properties,'place_city');
    if(region&&cities){mergeNodes(region.children,cities.options);region.list_complete=true;}
  }
  return state;
}
export function stats(state) {
  return {fields:Object.keys(state.fields).filter(k=>!omitted.has(k)).length,brands:state.brands.length,models:state.brands.reduce((s,b)=>s+b.children.length,0),generations:state.brands.reduce((s,b)=>s+b.children.reduce((n,m)=>n+m.children.length,0),0),regions:state.regions.length,cities:state.regions.reduce((s,r)=>s+r.children.length,0),completedModels:state.completedModels.length,phase:state.phase||null,requests:state.requests,status:state.status,current:state.current||null};
}
export async function crawl({state=newState(),request,save=async()=>{},progress=()=>{},stopped=()=>false}) {
  state.collectionScope='without_modifications';state.phase='catalog';
  state.status='running';
  const log=(stage,brand=state.current?.brand||null,model=state.current?.model||null)=>{
    state.current={brand,model,stage};state.activity||=[];
    state.activity.push({at:new Date().toISOString(),...state.current});
    if(state.activity.length>100)state.activity.splice(0,state.activity.length-100);
    progress(stats(state));
  };
  log('Подготовка',null,null);
  const check=()=>{if(stopped())throw Error('Остановлено пользователем. Незавершённая модель будет пройдена заново.');};
  const call=async(method,body)=>{check();const r=await request(method,body);state.requests++;progress(stats(state));return r;};
  const update=async(context,changed)=>{
    const response=await call('POST',requestBody(context,changed));
    if(!Array.isArray(response.properties))throw Error('update не вернул properties[]');
    ingest(state,response.properties,context);return response.properties;
  };
  // Flat technical dictionaries arrive in the root form. Only years need
  // iteration to union generations; modifications are explicitly out of scope.
  const modelKey=(b,m)=>key(b.value)+'/'+key(m.value);
  const collectGenerations=async(brand,model)=>{
    const context={condition_promotion:2,brand:brand.value,model:model.value};
    const modelProperties=await update(context,'model');
    const years=requireList(modelProperties,'year').options.filter(o=>!o.disabled).map(native);
    if(!years.length||years.some(y=>!Number.isInteger(y)))throw Error('Нет корректного списка годов модели '+model.name);
    for(const year of years){
      const properties=await update({...context,year},'year');
      const generations=requireList(properties,'generation').options;
      mergeNodes(model.children,generations);
    }
  };
  try {
    const initial=await call('GET');
    const initialProperties=flatten(initial.formSteps);
    if(!initialProperties.length)throw Error('Нет formSteps в начальной схеме');
    importRecords([{initial:true,properties:initialProperties,context:{},modified:[]}],state);
    await update({condition_promotion:2},'condition_promotion');
    // Complete independent relation-driven dictionaries before the long car pass.
    for(const name of ['price_currency','exchange_options']) {
      for(const o of requireList(initialProperties,name).options.filter(o=>!o.disabled)) {
        const value=native(o),done=name+':'+key(value);
        if(state.completedControls.includes(done))continue;
        await update({condition_promotion:2,[name]:value},name);
        state.completedControls.push(done);await save(state);
      }
    }
    for(const region of state.regions) {
      if(state.completedRegions.includes(key(region.value)))continue;
      if(region.disabled)throw Error('Недоступная область; полнота не доказана: '+region.name);
      const p=await update({condition_promotion:2,place_region:region.value},'place_region');
      mergeNodes(region.children,requireList(p,'place_city').options);
      region.list_complete=true;region.complete=true;
      state.completedRegions.push(key(region.value));await save(state);
    }
    for(const brand of state.brands) {
      check();if(brand.complete)continue;
      log('Марка',brand.name,null);
      if(brand.disabled)throw Error('Недоступная марка; полнота не доказана: '+brand.name);
      const brandContext={condition_promotion:2,brand:brand.value};
      if(!brand.list_complete){
        const brandProperties=await update(brandContext,'brand');
        mergeNodes(brand.children,requireList(brandProperties,'model').options);brand.list_complete=true;
      }
      for(const model of brand.children) {
        check();const done=modelKey(brand,model);
        if(state.completedModels.includes(done))continue;
        log('Начало модели',brand.name,model.name);await save(state);
        if(model.disabled)throw Error('Недоступная модель; полнота не доказана: '+model.name);
        await collectGenerations(brand,model);
        model.list_complete=true;model.complete=true;state.completedModels.push(done);
        log('Модель завершена',brand.name,model.name);await save(state);
      }
      brand.complete=true;await save(state);
    }
    state.phase='done';state.status='complete';log('Сбор завершён');await save(state);return state;
  } catch(error) {
    state.status=stopped()?'paused':'blocked';
    log(stopped()?'Остановлено':'Ошибка');
    // Error strings are generated locally; network bodies/credentials are never appended.
    state.issues.push({message:String(error.message).slice(0,400),atRequest:state.requests});
    await save(state);throw error;
  }
}

export function resultFiles(state, seedSchema, seedBinding) {
  const schema=clone(seedSchema),binding=clone(seedBinding),fields=schema[0].options;
  const f=name=>fields.find(f=>f.id==='av.'+name);
  const normalizeName=s=>s.trim().toLowerCase().replaceAll('ё','е');
  const corrections={'автоматический дальний свет':'автоматический дальный свет','бесключевой доступ':'беcключевой доступ'};
  const oldName=s=>corrections[normalizeName(s)]||normalizeName(s);
  const makeChoice=(field,o,old=[],parent='')=>{
    const matches=old.filter(c=>oldName(c.name)===normalizeName(o.name));
    const previous=matches.length===1?matches[0]:undefined;
    return {id:previous?.id||`av.${field}.${parent}${encodeURIComponent(key(o.value))}`,name:o.name,description:'Нативный вариант из ответа av.by; условия отдельных состояний сохранены в evidence. Недоступность в одном состоянии не означает отсутствие в справочнике.',type:'choice',value:o.value,options:[]};
  };
  const buildTree=(nodes,levels,old=[],parent='')=>nodes.map(n=>{
    const c=makeChoice(levels[0],n,old,parent);
    const previous=old.find(o=>o.id===c.id);
    const children=levels.length===1?[]:buildTree(n.children,levels.slice(1),previous?.childOptions||[],parent+encodeURIComponent(key(n.value))+'.');
    if(levels.length>1&&!n.list_complete)for(const oldChild of previous?.childOptions||[])if(!children.some(c=>c.id===oldChild.id))children.push(clone(oldChild));
    return {...c,level:'av.'+levels[0],options_complete:levels.length===1||n.list_complete,childOptions:children};
  });
  for(const field of fields) {
    const name=field.id.slice(3),p=state.fields[name];if(!p)continue;
    field.description='Схема и наблюдаемые варианты из ответов av.by. Полнота зависимых ветвей: '+state.status+'. Изменяющиеся обязательность, видимость и disabled сохранены в evidence; они не являются безусловными правилами.';
    field.required=null;
    if(!trees.has(name)&&['enum','multi_enum'].includes(field.type)) {
      const values=p.options.filter(o=>name!=='condition_promotion'||o.value===2);
      field.options=values.map(o=>makeChoice(name,o,field.options));field.options_complete=state.status==='complete';
    }
    for(const c of p.constraints||[]) {
      const mappings={int_min:['min','min'],int_max:['max','max'],str_len_min:['min_length','min'],str_len_max:['max_length','max'],array_len_max:['max_items','max']};
      const m=mappings[c.type];if(m&&name!=='year'&&Number.isFinite(c[m[1]])){field.validation||={};field.validation[m[0]]=c[m[1]];}
    }
  }
  f('brand').options=buildTree(state.brands,['brand','model','generation'],f('brand').options);f('brand').options_complete=state.brands.length>0;
  f('place_region').options=buildTree(state.regions,['place_region','place_city'],f('place_region').options);f('place_region').options_complete=state.regions.length>0;
  for(const name of ['model','generation','place_city']){f(name).options=[];f(name).options_complete=state.status==='complete';}
  f('year').options=[];delete f('year').validation;
  f('modification').options_complete=false;
  f('modification').description='Сбор модификаций исключён заданием пользователя. Ранее собранные варианты сохраняются только как исторические данные.';
  // A network catalogue cannot certify browser write/read/upload recipes.
  for(const b of binding.fields)if(b.status!=='unsupported')b.reason='Справочник обогащён ответами av.by; действие в браузере и чтение установленного значения ещё не проверены.';
  schema[0].description='AV.by, cars_used_sale, контракт 2.2. Каталог: '+state.status+'. Binding не проверен исполнением. Годы используются только в памяти сборщика, в файлах их списков/диапазонов нет.';
  const report=['AV.BY — CARS_USED_SALE',JSON.stringify(stats(state),null,2),'Только childOptions марка → модель → поколение и область → город. Остальные варианты плоские.',
    'Кузова, коробки, двигатели и приводы читаются из начального ответа. Перебора технических сочетаний нет.',
    'Модификации исключены заданием пользователя. Их новые варианты не собираются; старые варианты из checkpoint не удаляются. complete относится к текущему объёму без модификаций.',
    'Условия/disabled/required отдельных состояний находятся в evidence. Контекст года удалён, наличие фильтра обозначено year_filtered.',
    'Нативные коды типизированы. Схема API не доказывает работу browser binding. Ни один binding не повышен до ready.',
    'Проверяются все доступные годы каждой модели для объединения поколений. Годы только в памяти; незавершённая модель после остановки повторяется.',
    ...state.issues.map(i=>i.message)].join('\n')+'\n';
  return {'cars_used_sale_av.json':schema,'binding_cars_used_sale_av.json':binding,'report_cars_used_sale_av.txt':report,'evidence/av-catalog-source.json':state};
}
