import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {digest, save, validateNodes} from './collect.mjs';
import {validate} from './validate.mjs';
import {auditCatalog} from './audit.mjs';

export const CATEGORY = 'cars_used_sale';
const id = name => 'kufar.' + name;
const condition = (name, operator, value) => ({option_id:id(name),operator,...(value===undefined?{}:{value})});
const option = (name,label,type,extra={}) => ({id:id(name),name:label,description:'',type,options:[],...extra});
const choice = (field,value,label,extra={}) => ({id:id(field+'.'+encodeURIComponent(value)),name:label,description:'',type:'choice',options:[],value,...extra});

export function catalogTree(state) {
  validateNodes(state.brands.map(b=>b.node),'category_2010','mark');
  return state.brands.map(b=>{
    validateNodes(b.models.map(m=>m.node),b.node.value,'model');
    return choice('catalog',b.node.value,b.node.labels.ru,{level:id('cars_brand_v2'),options_complete:b.complete,
      childOptions:b.models.map(m=>{
        validateNodes(m.generations,m.node.value,'generation');
        return choice('catalog',m.node.value,m.node.labels.ru,{level:id('cars_model_v2'),options_complete:m.complete,
          childOptions:m.generations.map(g=>choice('catalog',g.value,g.labels.ru,{level:id('cars_gen_v2'),options_complete:true,childOptions:[]}))});
      })});
  });
}

// All refs below were observed in category 2010 insertion metadata. Do not infer
// fields from the search filters, or include unrelated bootstrap categories.
const BASE_REFS = [1512,2782,7294,7296,7303,1573,10105,1575,1576,1577,9108,1579,9472,1580,1582,1574,10330,10335,10340,10337,12,10,158,145,25,43,4,144,15,155,1523,1568,1774,1511,1776,1775,1438,10838,148];
const CONTACT_REFS = [2116,1515,1514,9298];
const DROPDOWNS = new Set(['cars_brand_v2','cars_model_v2','cars_gen_v2','cars_type','cars_seats','cars_capacity','regdate','cars_color','cars_interior_color','cars_interior_material','region','area','currency']);
const CHIPS = new Set(['cars_engine','cars_drive','cars_gearbox','cars_autogearbox','condition']);
const INPUTS = new Set(['subject','body','price','mileage','cars_battery_capacity']);
const wrapper = name => `[data-name="${name}"]`;
const target = selector => ({selectors:[selector]});

export function normalize(metadata,state,ui) {
  if(metadata.sha256!==digest(JSON.stringify(metadata.data)))throw Error('Metadata checksum mismatch');
  const p=metadata.data.ad_metadata.parameters;
  const fields=BASE_REFS.map(ref=>{
    const f=p.refs[ref];if(!f)throw Error('Missing metadata ref '+ref);
    const type=f.name==='images'?'files':f.type==='bool'?'boolean':f.values?.length?(f.multi?'multi_enum':'enum'):f.external_values_url?'enum':f.type==='int'?(f.actions?.some(a=>a.name==='v_float')?'number':'integer'):'text';
    const x=option(f.name,f.labels.name.ru,type,{required:f.required});
    if(type==='enum'||type==='multi_enum'){
      x.options=(f.values||[]).filter(v=>f.name!=='condition'||v.value==='1').map(v=>choice(f.name,v.value,f.name==='currency'&&v.value==='BYR'?'руб.':v.labels.ru));
      x.options_complete=!f.external_values_url;
    }
    if(type==='boolean')x.description='Нативные коды: "1" — да, "0" — нет. В DOM проверять input.checked; aria-checked использует "1"/"0".';
    return x;
  });
  const byName=Object.fromEntries(fields.map(f=>[f.id.slice(6),f]));
  const when=(name,parent,op,value)=>{byName[name].when=condition(parent,op,value);};
  const depends={cars_model_v2:['cars_brand_v2'],cars_gen_v2:['cars_model_v2'],cars_autogearbox:['cars_gearbox'],cars_battery_capacity:['cars_engine'],cars_capacity:['cars_engine'],repair_needed:['condition'],area:['region'],price:['price_mode'],currency:['price_mode']};
  for(const [child,parent] of [['cars_model_v2','cars_brand_v2'],['cars_gen_v2','cars_model_v2']]){
    byName[child].parent_option_id=id(parent);when(child,parent,'exists');
  }
  when('cars_autogearbox','cars_gearbox','equals','1');
  when('cars_battery_capacity','cars_engine','equals','5');
  when('repair_needed','condition','equals','1');
  byName.cars_brand_v2.options=catalogTree(state);
  byName.cars_brand_v2.options_complete=!!state.brandsObservedAt;
  byName.cars_model_v2.options_complete=state.brands.every(b=>b.complete);
  byName.cars_gen_v2.options_complete=state.complete;
  byName.condition.description='Область задания: только автомобили с пробегом. Новый (код "2") наблюдался, но исключён из этой категории.';
  byName.cars_capacity.description='Объём в литрах. required=true относится к неэлектрическому двигателю; при cars_engine="5" площадка заменяет ref 1579 на необязательный ref 7490. Условная обязательность пока не выражается контрактом 2.2: перед runtime-интеграцией требуется поддержка этой особенности. Исходные варианты сохранены в evidence.';
  byName.cars_capacity.required=null;
  byName.cars_capacity.description+=' required=null: единое безусловное значение указать нельзя.';
  byName.images.file_role='product_image';
  byName.images.validation={extensions:['jpg','jpeg','png'],mime_types:['image/jpeg','image/png'],max_items:30};
  byName.images.description='Авторизованная форма: максимум 30 фото, JPEG/JPG/PNG до 10 МБ на файл; точное число байт неизвестно. Проверены PNG и JPEG, HTTP 200 загрузчика, счётчик и загруженные серверные thumbnails. После первого файла input меняется на imageLoaderDropzoneSmall. До входа загрузка закрыта.';
  byName.subject.name='Название объявления';byName.subject.validation={max_length:50};
  byName.body.validation={max_length:4000};byName.vehicle_vin.name='VIN-номер';byName.vehicle_vin.validation={max_length:17};
  byName.mileage.validation={min:0};byName.cars_battery_capacity.validation={min:0};
  // The price input is a decimal amount, despite the transport metadata's int.
  byName.price.type='number';byName.price.validation={min:0,max:99000000,multiple_of:0.01};
  byName.price.description='Сумма в интерфейсе, не транспортные денежные единицы API. Преобразование в API на этапе A не предполагается.';
  byName.currency.description='UI: руб. / $ / €. Нативные коды: BYR / USD / EUR. Метаданные называют BYR «р.», но в форме отображается «руб.»; код не переименован в BYN.';
  const priceMode=option('price_mode','Способ указания цены','enum',{required:true,options_complete:true,options:[choice('price_mode','common','Цена'),choice('price_mode','contact','Договорная цена')],description:'Коды — наблюдённые id DOM radio, не заявленные значения API.'});
  fields.splice(fields.indexOf(byName.price),0,priceMode);
  when('price','price_mode','equals','common');when('currency','price_mode','equals','common');

  // The two requested hierarchies are make -> model -> generation and region -> area.
  for(const r of byName.region.options){
    const rule=p.rules.find(x=>Object.keys(x.rule).length===1&&x.rule.region===r.value);
    if(!rule)throw Error('Missing area rule '+r.value);
    const f=p.refs[rule.refs[0]];
    r.level=id('region');r.options_complete=true;
    r.childOptions=f.values.map(v=>choice('area',v.value,v.labels.ru,{level:id('area'),childOptions:[],options_complete:true}));
  }
  fields.push(option('area','Город / Район','enum',{required:true,options_complete:true,parent_option_id:id('region'),when:condition('region','exists')}));
  for(const ref of CONTACT_REFS){
    const f=p.refs[ref];fields.push(option(f.name,f.labels.name.ru,f.values?.length?'enum':'text',{required:f.required,...(f.values?.length?{options:f.values.map(v=>choice(f.name,v.value,v.labels.ru)),options_complete:true}:{}),description:'Поле присутствует в метаданных формы; видимость и обязательность после входа не проверены.'}));
  }
  for(const name of ['name','phone']){
    const f=fields.find(f=>f.id===id(name));
    f.description='Авторизованная форма 2026-11-12: disabled, значение берётся из профиля. Автозаполнение и изменение профиля не выполняются; required=true — обязательность контакта площадки, не требование повторного ввода.';
  }
  fields.find(f=>f.id===id('email')).description='Есть в метаданных, но отсутствует в видимой авторизованной форме 2026-11-12. Не требовать отдельного ввода и не искать поле в настройках аккаунта. required=true сохранён из метаданных, не подтверждён как требование UI.';
  fields.find(f=>f.id===id('phone_hidden')).description='Radio «Звонки и сообщения» / «Только сообщения», нативные input.value 0/1 подтверждены DOM и переключением. Повторная установка идемпотентна.';
  byName.possible_exchange.description='Checkbox «Возможен обмен», коды metadata 1/0. Действие по видимому role=checkbox, readback через native input.checked. Не использовать aria-checked: выключенный вариант может иметь пустую строку. Не считать немедленное состояние после click окончательным.';
  byName.auction.description='Чипы «Без торга» / «Торг уместен», коды metadata 1/2. Проверены оба значения и повтор; readback только выбранного _filled-green чипа.';
  const uiNames=new Set(ui.fields.map(f=>f.name));
  const bindings=fields.map(f=>{
    const name=f.id.slice(6);let b={option_id:f.id,status:'needs_review',reason:'Не проверено заполнение этого поля в авторизованной форме.'};
    if(depends[name])b.depends_on=depends[name].map(id);
    const ready=(data)=>{b={option_id:f.id,status:'ready',overwrite:'if_empty',wait_for:['visible','enabled'],...data,...(b.depends_on?{depends_on:b.depends_on}:{})};};
    if((uiNames.has(name)||name==='cars_battery_capacity')&&INPUTS.has(name))ready({target:target(`${name==='body'?'textarea':'input'}[name="${name}"]`),action:'set_value',events:['input','change','blur'],verify:{kind:'value_equals'}});
    else if((uiNames.has(name)||name==='currency')&&DROPDOWNS.has(name))ready({target:target(`${wrapper(name==='currency'?'price':name)} [data-testid="base-dropdown-ui"]`),action:'choose',match:'text',suggestions:{selector:'[data-testid="popup-body"] [class*="_item_with-check"]',match:'exact_text'},verify:{kind:'selected_text_equals'}});
    else if(uiNames.has(name)&&CHIPS.has(name)){
      // Label-to-code is explicit in schema; selected state was observed in DOM.
      ready({target:target(wrapper(name)),action:'choose',match:'text',suggestions:{selector:wrapper(name)+' [role="button"]',match:'exact_text'},verify:{kind:'selected_text_equals',target:target(wrapper(name)+' [role="button"][class*="_filled-green"]')}});
    }
    else if(uiNames.has(name)&&f.type==='boolean'){
      ready({target:target(wrapper(name)+' input[type="checkbox"]'),action:'set_checked',wait_for:['enabled'],verify:{kind:'checked_equals'}});
    }
    if(f.type==='multi_enum'){
      ready({target:target(wrapper(name)+' [data-testid="base-dropdown-ui"]'),action:'choose',match:'text',selection_mode:'replace_set',
        suggestions:{selector:'[data-testid="popup-body"] label',match:'exact_text',checkbox_selector:'input[type="checkbox"]'},
        commit:{target:target('[data-testid="popup-body"] button[class*="--green-accent"]')},
        verify:{kind:'selected_text_set_equals',target:target('[data-testid="popup-body"]'),items_selector:'label:has(input[type="checkbox"]:checked)',reopen:true},timeout_ms:10000});
    }
    if(name==='vehicle_vin')ready({target:target('input[name="vehicle_vin"]'),action:'set_value',events:['input','change','blur'],verify:{kind:'value_equals'}});
    if(name==='images')ready({target:{selectors:['#imageLoaderDropzone','#imageLoaderDropzoneSmall']},action:'upload_files',wait_for:['enabled'],events:['change'],timeout_ms:60000,
      verify:{kind:'files_accepted',target:target('[class*="_wrapper_photo"]'),items_selector:'[aria-roledescription="sortable"]',image_selector:'img',accepted_src_prefix:'https://rms.kufar.by/v1/list_thumbs_2x/adim1/',require_loaded:true,counter_target:target('[data-name="images"] [class*="_counter"]')}});
    if(['name','phone'].includes(name))b={option_id:f.id,status:'unsupported',reason:'В проверенной авторизованной форме поле disabled и берётся из профиля. Не заполнять и не менять настройки аккаунта. Другие состояния аккаунта не исследованы.'};
    if(name==='email')b={option_id:f.id,status:'unsupported',reason:'Поле есть в метаданных, но не представлено в проверенной авторизованной форме. Не синтезировать input и не переходить в настройки аккаунта.'};
    if(name==='phone_hidden')ready({target:target(wrapper(name)),action:'choose',match:'text',suggestions:{selector:wrapper(name)+' [role="radio"]',match:'exact_text'},verify:{kind:'selected_text_equals',target:target(wrapper(name)+' label:has(input:checked)')}});
    if(name==='possible_exchange')ready({target:target(wrapper(name)+' [role="checkbox"]'),action:'set_checked',verify:{kind:'checked_equals',target:target(wrapper(name)+' input[type="checkbox"]')},timeout_ms:10000});
    if(name==='auction')ready({target:target(wrapper(name)),action:'choose',match:'text',suggestions:{selector:wrapper(name)+' [role="button"]',match:'exact_text'},verify:{kind:'selected_text_equals',target:target(wrapper(name)+' [role="button"][class*="_filled-green"]')}});
    if(name==='price_mode')ready({target:target(wrapper('price')+' [role="radiogroup"]'),action:'choose',match:'text',suggestions:{selector:wrapper('price')+' [role="radio"]',match:'exact_text'},verify:{kind:'selected_text_equals',target:target(wrapper('price')+' [role="radio"][aria-checked="true"]')}});
    return b;
  });
  const usedRefs=new Set([...BASE_REFS,...CONTACT_REFS,7490,...p.rules.filter(r=>r.rule.region).flatMap(r=>r.refs)].map(String));
  const evidence={format_version:'2.2',category_id:CATEGORY,platform:'kufar',metadata_source:{url:metadata.url,observed_at:metadata.observedAt,sha256:metadata.sha256},scope:{category:'2010',company_ad:'0',condition:'1',sample:['Kia','Rio','IV Рестайлинг'],year_filter:false},refs:Object.fromEntries([...usedRefs].map(k=>[k,p.refs[k]])),rules:p.rules.filter(r=>r.refs.some(k=>usedRefs.has(String(k)))),excluded_metadata_candidates:['cars_engine_power','vin_report','content_video','cars_availability','cars_delivery_country','leasing_pro','confiscated'],notes:['Excluded candidates were not observed in the reviewed private forms; partner/account branches need separate research. Authenticated accessibility review is recorded in kufar-authenticated-review.json.','Transport validator names are evidence, not guessed validation parameters.','UI binding ready is a verified declarative recipe, not proof that the production extension implements schema 2.2.']};
  return {schema:[{id:CATEGORY,name:'Продажа легковых автомобилей с пробегом',description:'Kufar, частная подача. Исследование 2.2; не подключено к runtime. Каталог без фильтра по году.',categories:[],options:fields}],binding:{category_id:CATEGORY,platform:'kufar',fields:bindings},evidence};
}

export function build({directory='work/kufar-cars-used',output='data/parsing/cars_used_sale',allowPartial=false}={}){
  const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
  const state=read(path.join(directory,'catalog.json'));
  if(!state.complete&&!allowPartial)throw Error('Catalog incomplete; resume collector, or explicitly use --allow-partial for an interim snapshot');
  const result=normalize(read(path.join(directory,'metadata.json')),state,read(path.join(output,'evidence/kufar-ui-sample.json')));
  validate(result.schema,result.binding,{requireComplete:!allowPartial});
  const audit=auditCatalog(state,result.schema);
  save(path.join(output,`${CATEGORY}_kufar.json`),result.schema);
  save(path.join(output,`binding_${CATEGORY}_kufar.json`),result.binding);
  save(path.join(output,'evidence/kufar-insertion-metadata.json'),result.evidence);
  // Preserve the observed catalog, including year annotations, independently
  // of the mapping-ready tree. This is public taxonomy, not ads or user data.
  save(path.join(output,'evidence/kufar-catalog-source.json'),state);
  save(path.join(output,'evidence/kufar-catalog-audit.json'),audit);
  const stats={complete:state.complete,brands:state.brands.length,models:state.brands.reduce((s,b)=>s+b.models.length,0),models_with_generations_collected:state.brands.reduce((s,b)=>s+b.models.filter(m=>m.complete).length,0),generations:state.brands.reduce((s,b)=>s+b.models.reduce((n,m)=>n+m.generations.length,0),0),fields:result.schema[0].options.length,ready:result.binding.fields.filter(f=>f.status==='ready').length,needs_review:result.binding.fields.filter(f=>f.status==='needs_review').length,unsupported:result.binding.fields.filter(f=>f.status==='unsupported').length};
  save(path.join(output,'evidence/kufar-crawl-summary.json'),{...stats,startedAt:state.startedAt,updatedAt:state.updatedAt,failures:state.failures,runHistory:state.runHistory||[],sha256:{schema:digest(JSON.stringify(result.schema)),binding:digest(JSON.stringify(result.binding)),catalog:digest(JSON.stringify(state))}});
  return stats;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)console.log(JSON.stringify(build({allowPartial:process.argv.includes('--allow-partial')})));
