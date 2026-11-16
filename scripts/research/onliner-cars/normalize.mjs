import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {save,digest,checkList} from './collect.mjs';
import {validate} from './validate.mjs';

export const CATEGORY='cars_used_sale';
const out='data/parsing/cars_used_sale';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const id=s=>'onliner.'+s;
const field=(key,name,type,extra={})=>({id:id(key),name,description:'',type,options:[],required:null,...extra});
const choice=(key,value,name,extra={})=>({id:id(key+'.'+encodeURIComponent(String(value))),name,description:'',type:'choice',value,options:[],...extra});
const target=s=>({selectors:Array.isArray(s)?s:[s]});
const when=(key,operator,value)=>({option_id:id(key),operator,...(value===undefined?{}:{value})});
const camel=s=>s.replace(/_([a-z])/g,(_,c)=>c.toUpperCase());

export function tree(state){
  checkList(state.brands.map(b=>b.node),'brands');
  return state.brands.map(b=>choice('manufacturer',b.node.id,b.node.name,{level:id('manufacturer'),options_complete:b.complete,childOptions:b.models.map(m=>choice('model.'+b.node.id,m.node.id,m.node.name,{level:id('model'),options_complete:m.complete,childOptions:m.generations.map(g=>choice('generation.'+b.node.id+'.'+m.node.id,g.id,g.name,{level:id('generation'),options_complete:true,childOptions:[]}))}))}));
}

export function normalize(state,dict,geo,ui,labels,tests){
  const fields=[],bindings=[];
  function add(f,recipe,reason){
    fields.push(f);
    bindings.push(recipe?{option_id:f.id,status:'ready',overwrite:'if_empty',wait_for:['visible','enabled'],...recipe}:{option_id:f.id,status:'needs_review',reason:reason||'Не проверен полный цикл ввода и чтения значения.'});return f;
  }
  const input=(selector)=>({target:target(selector),action:'set_value',events:['input','change','blur'],verify:{kind:'value_equals'}});
  const checkbox=selector=>({target:target(selector),action:'set_checked',wait_for:['enabled'],verify:{kind:'checked_equals'}});
  const radios=name=>({target:target('.vehicle-form'),action:'choose',match:'value',suggestions:{selector:`input[name="${name}"]`},verify:{kind:'value_equals',target:target(`input[name="${name}"]:checked`)}});
  const enumeration=(key,name,values)=>field(key,name,'enum',{options_complete:true,options:values.map(v=>choice(key,v.id,v.name))});
  const inputs=step=>ui[step].groups.flatMap(g=>g.inputs.map(e=>({...e,group:g})));
  const find=(step,p)=>{const a=inputs(step).filter(p);if(a.length!==1)throw Error('Ambiguous UI field '+step+': '+a.length);return a[0];};
  const chips=(step,label)=>{const a=ui[step].groups.filter(g=>g.links.some(l=>l.label===label));if(a.length!==1)throw Error('Missing chip group '+label);return {target:target(a[0].selector),action:'choose',match:'text',suggestions:{selector:a[0].selector+' a',match:'exact_text'},verify:{kind:'selected_text_equals',target:target(a[0].selector+' a.button-style_active')}};};
  function dictField(key,name,dictionary,step,sample,extra={}){const f=enumeration(key,name,dict[dictionary]);Object.assign(f,extra);return add(f,chips(step,sample));}
  const brand=add(enumeration('manufacturer','Марка',[]),radios('manufacturer'));brand.options=tree(state);
  add(enumeration('model','Модель',[]),{...radios('model'),depends_on:[id('manufacturer')]});
  add(enumeration('generation','Поколение',[]),{...radios('generation'),depends_on:[id('model'),id('year')]});
  for(const [child,parent] of [['model','manufacturer'],['generation','model']])Object.assign(fields.find(f=>f.id===id(child)),{parent_option_id:id(parent),when:when(parent,'exists')});
  fields.find(f=>f.id===id('generation')).description='Полный список модели без ограничения по году. Сама форма Onliner фильтрует видимые поколения по введённому году: год заполнить раньше поколения; если нужный ID недоступен, не выбирать другое поколение. Обозначения FB/QB сохранены дословно.';
  const yearRoot='.vehicle-form__group:has(select.vehicle-form__button-select)';
  add(field('year','Год выпуска','integer',{required:true,description:'Одно независимое поле для всех моделей. Перечни годов и интервалы поколений не собираются. Значение выбирается по единственному точному совпадению среди кнопок и option текущего DOM; граница списка Старше не фиксируется. Год устанавливается до поколения, поскольку площадка меняет доступные поколения.'}),{
    target:target(yearRoot),action:'choose',match:'text',events:['input','change'],depends_on:[id('model')],
    suggestions:{selector:yearRoot+' a.vehicle-form__button_choose, '+yearRoot+' select.vehicle-form__button-select option',match:'exact_text',option_action:'select_option'},
    verify:{kind:'selected_text_equals',target:target(yearRoot+' a.button-style_active, '+yearRoot+' div.button-style_active > select.vehicle-form__button-select > option:checked')}
  });
  const mod=find('tech-petrol',e=>e.placeholder?.includes('GT, CL'));
  add(field('modification','Модификация','text',{required:false}),input(mod.selector));
  add(enumeration('bodyType','Тип кузова',dict.body_type),radios('bodyType'));
  dictField('engineType','Тип двигателя','engine_type','tech-petrol','Бензин');
  const capacity=find('tech-petrol',e=>e.type==='text'&&!e.placeholder);
  add(field('engineCapacity','Объем двигателя','number',{when:when('engineType','not_equals','electric'),description:'Литры; свободный ввод. Список engine_capacity из API не подменяет ввод формы.'}),input(capacity.selector));
  const power=find('tech-petrol',e=>e.type==='tel'&&e.selector.includes('width_full'));
  add(field('power','Мощность двигателя','number',{required:false}),input(power.selector));
  add(field('powerUnit','Единица мощности','enum',{required:false,options_complete:true,options:[choice('powerUnit','horse','л.с.'),choice('powerUnit','kw','кВт')],description:'Коды horse/kw подтверждены литералом tn в публичном клиенте.'}),chips('tech-petrol','л.с.'));
  const torque=find('tech-petrol',e=>e.type==='tel'&&!e.selector.includes('width_full'));
  add(field('torque','Крутящий момент','number',{required:false,description:'Н·м.'}),input(torque.selector));
  dictField('drivetrain','Привод','drivetrain','tech-petrol','Передний');
  dictField('transmission','Коробка передач','transmission','tech-petrol','Автоматическая');
  for(const e of inputs('tech-petrol').filter(e=>e.type==='checkbox')){
    const key=e.label.includes('Газ')?'gas':e.label.includes('Гибрид')?'hybrid':'manualControl';
    // Diesel has one item (hybrid), petrol has gas followed by hybrid.
    const selector=key==='hybrid'?e.selector.replace('li:nth-of-type(2)','li:last-of-type'):e.selector;
    add(field(key,e.label,'boolean',{required:false,...(key==='gas'?{when:when('engineType','equals','gasoline')}:key==='hybrid'?{when:when('engineType','not_equals','electric')}:{})}),checkbox(selector));
  }

  add(field('images','Фотографии для объявления','files',{required:null,file_role:'product_image',validation:{extensions:['jpg','jpeg','png'],mime_types:['image/jpeg','image/png'],max_items:50},description:'JPG/PNG, до 50 фото, до 20 MB на файл по UI. Проверены PNG+JPEG и повторное добавление PNG: 0 → 2 → 3 принятых фото, остаток 50 → 48 → 47. Превью — CSS background-image; три исходные secondary-карточки являются заглушками.'}),{
    target:target('input.drop-style__upload-link-real'),action:'upload_files',events:['change'],wait_for:['enabled'],timeout_ms:60000,
    verify:{kind:'files_accepted',target:target('div.drop-style__upload-list'),items_selector:'.drop-style__upload-item_primary',image_selector:'.drop-style__upload-image',image_source:'background_image',accepted_src_prefix:'https://content.onliner.by/automarket/',require_loaded:true,counter_target:target('.drop-style__title'),counter:{mode:'remaining',capacity:50,pattern:'^Осталось\\s+(\\d+)\\s+фото$',empty_pattern:'до\\s+50\\s+фотографий$'}}
  });
  add(enumeration('color','Цвет автомобиля',dict.color),radios('bodyType'));
  for(const group of ui.exterior.groups.slice(2)){
    const names=[...new Set(group.inputs.map(e=>e.name).filter(Boolean))];
    const anchor=`.vehicle-form__group:has(input[name="${names[0]}"])`;
    for(const name of names){
      const controls=group.inputs.filter(e=>e.name===name),key=camel(name);
      const multi=controls[0].type==='checkbox';
      const matches=(v,e)=>e.code!==undefined?String(v.id)===e.code:v.name.toLowerCase()===e.label.toLowerCase();
      if(!dict[name]||dict[name].length!==controls.length||controls.some(e=>dict[name].filter(v=>matches(v,e)).length!==1))throw Error('DOM/dictionary mismatch '+name);
      const f=enumeration(key,labels[key],dict[name]);f.type=multi?'multi_enum':'enum';f.required=false;
      // Preserve the displayed labels (capitalisation and punctuation).
      f.options.forEach(o=>o.name=controls.find(e=>matches({id:o.value,name:o.name},e)).label);
      const wrap=`.input-style__wrapper:has(input[name="${name}"])`,popup=wrap+' .dropdown-style',button=wrap+' > .input-style';
      const recipe={target:target(button),action:'choose',match:'text',suggestions:{selector:popup+' label:has(input)',match:'exact_text'},verify:{kind:'selected_text_equals',target:target(wrap+' .input-style__faux')}};
      if(multi)Object.assign(recipe,{selection_mode:'replace_set',suggestions:{...recipe.suggestions,checkbox_selector:'input[type="checkbox"]'},commit:{target:target(button)},verify:{kind:'selected_text_set_equals',target:target(popup),items_selector:'label:has(input:checked)',reopen:true}});
      add(f,recipe);
    }
    for(const e of group.inputs.filter(e=>e.type==='checkbox'&&!e.name)){
      const key=Object.keys(labels).find(k=>labels[k]===e.label);
      if(!key)throw Error('Unknown checkbox label '+e.label);
      const t=tests.results.find(t=>t.label===e.label);if(!t?.changed||!t.restored)throw Error('Checkbox test missing '+key);
      const selector=anchor+e.selector.slice(group.selector.length);
      add(field(key,e.label,'boolean',{required:false}),checkbox(selector));
    }
  }

  const stateField=enumeration('state','Состояние',dict.state.filter(v=>v.id!=='new'));stateField.required=true;stateField.description='Только с пробегом и аварийный. Новый исключён из категории.';add(stateField,chips('cost-used','С пробегом'));
  const vin=find('cost-used',e=>e.type==='text');add(field('vin','VIN-номер','text',{required:false,validation:{max_length:17}}),input(vin.selector));
  const odo=find('cost-used',e=>e.type==='tel'&&e.group.label==='Пробег');add(field('odometer','Пробег','integer',{required:true}),input(odo.selector));
  add(field('odometerUnit','Единица пробега','enum',{required:true,options_complete:true,options:[choice('odometerUnit','km','км'),choice('odometerUnit','miles','миль')],description:'Коды km/miles подтверждены литералом en в публичном клиенте.'}),chips('cost-used','км'));
  const desc=find('cost-used',e=>e.tag==='TEXTAREA');add(field('description','Комментарий','text',{required:false,validation:{max_length:10000}}),input(desc.selector));
  const price=find('cost-used',e=>e.type==='tel'&&e.group.label==='Цена');add(field('price','Цена','number',{required:true,description:'Сумма в интерфейсе, не пересчитанные транспортные единицы API.'}),input(price.selector));
  add(field('currency','Валюта','enum',{required:true,options_complete:true,options:['BYN','USD','EUR','RUB'].map(v=>choice('currency',v,v))}),chips('cost-used','BYN'));
  for(const e of inputs('cost-used').filter(e=>e.type==='checkbox')){
    const key={'На гарантии':'warranty','Не растаможен':'notCustomsCleared','Цена с НДС':'includeVat','Возможен обмен':'exchange'}[e.label];
    if(!key)throw Error('Unknown condition checkbox');add(field(key,e.label,'boolean',{required:false}),checkbox(e.selector));
  }
  const countries=enumeration('country','Страна',[geo.country.data]);countries.description='Граница географии этого исследования — Беларусь. Остальные 25 стран из UI сохранены в исходных dictionaries, их города не собирались.';
  countries.options[0].level=id('country');countries.options[0].options_complete=true;
  countries.options[0].childOptions=geo.regions.map(r=>choice('region',r.data.id,r.data.name,{level:id('region'),options_complete:true,childOptions:r.data.cities.map(c=>choice('city.'+r.data.id,c.id,c.name,{level:id('city'),options_complete:true,childOptions:[]}))}));
  function geoRecipe(name){const wrap=`.input-style__wrapper:has(input[name="${name}"])`;return {target:target(wrap+' > .input-style'),action:'choose',match:'value',suggestions:{selector:wrap+` input[name="${name}"]`},verify:{kind:'value_equals',target:target(wrap+' input:checked')}};}
  add(countries,geoRecipe('country'));
  for(const [key,name,parent] of [['region','Область','country'],['city','Город','region']])add(field(key,name,'enum',{required:true,options_complete:true,parent_option_id:id(parent),when:when(parent,'exists')}),{...geoRecipe(key),depends_on:[id(parent)]});
  add(enumeration('sellerType','Продавец',dict.seller_type.filter(v=>v.id==='individual')),chips('contacts','Частное лицо')).description='Проверена частная подача. Автохаус и Автодилер видны, но их договорные/платные ветви вне исследования.';
  for(const e of inputs('contacts').filter(e=>e.type==='checkbox')){
    const key=e.label==='Круглосуточно'?'callsAnytime':'onlyChat';add(field(key,e.label,'boolean',{required:false}),checkbox(e.selector));
  }
  find('contacts',e=>e.type==='tel');
  add(field('phone','Телефон','text',{required:null,validation:{max_length:55},description:'Основной номер объявления. Подготовленное значение — строка из цифр и + без разделителей: UI удаляет пробелы, скобки, дефисы и прочие символы. Не добавлять код страны автоматически. При onlyChat=true телефон остаётся доступным, но необязателен; required=null отражает условную обязательность. Площадка допускает до 5 строк, дополнительные номера сохраняются для ручного ввода и не заменяются этим binding. Ввод и readback проверены; серверная проверка допустимости номера при публикации не выполнялась.'}),{
    ...input('.vehicle-form__field > .vehicle-form__line_condensed-either:first-child input[type=tel].vehicle-form__input_width_xxssmm'),depends_on:[id('onlyChat')]
  });
  inputs('contacts').filter(e=>e.tag==='SELECT').forEach((e,i)=>add(field(i?'callTo':'callFrom',i?'Звонить до':'Звонить с','enum',{options_complete:true,options:e.options.map(v=>choice(i?'callTo':'callFrom',v.value,v.label)),when:{all:[when('onlyChat','equals',false),when('callsAnytime','equals',false)]}}),{target:target(e.selector),action:'select_option',events:['input','change'],verify:{kind:'value_equals'},depends_on:[id('onlyChat'),id('callsAnytime')]}));
  for(const key of ['engineCapacity','gas','hybrid'])bindings.find(b=>b.option_id===id(key)).depends_on=[id('engineType')];
  for(const key of ['odometer','odometerUnit','vin'])bindings.find(b=>b.option_id===id(key)).depends_on=[id('state')];
  fields.find(f=>f.id===id('odometer')).description='После переключения С пробегом → Аварийный → С пробегом площадка очистила пробег. Сначала состояние, затем пробег и контрольное чтение.';
  fields.find(f=>f.id===id('notCustomsCleared')).description='Положительный смысл UI: Не растаможен. В API customsClearance имеет обратный смысл; не переносить boolean в backend API без инверсии.';
  return {schema:[{id:CATEGORY,name:'Продажа легковых автомобилей с пробегом',description:'Onliner. Исследование частной подачи в Беларуси, контракт 2.2. Все поколения модели без годов. Не подключено к production.',categories:[],options:fields}],binding:{category_id:CATEGORY,platform:'onliner',fields:bindings}};
}

export function build(){
  const year=read(out+'/evidence/onliner-year-review.json');
  if(year.verified!==true||!year.restored||!year.results.every(r=>r.equals&&r.selectedCount===1)||!['recent-button','recent-repeat','older-select','older-repeat','older-boundary','recent-boundary','back-to-recent'].every(label=>year.results.some(r=>r.label===label)))throw Error('Missing mixed year-control review');
  const phone=read(out+'/evidence/onliner-phone-review.json');
  if(phone.verified!==true||!phone.secondaryPreserved||phone.limit.count!==5||!phone.limit.disabled||!phone.chatMode.primaryPreserved||phone.chatMode.disabled||phone.chatOff.optional||!phone.restored||!phone.results.every(r=>r.unique&&r.equals))throw Error('Missing interactive phone review');
  const photo=read(out+'/evidence/onliner-photo-review.json');
  if(photo.verified!==true||![0,2,3].every(n=>photo.snapshots.some(s=>s.expected===n&&s.count===n&&s.counterVerified&&s.images.every(i=>i.loaded))))throw Error('Missing interactive photo review');
  const state=read('work/onliner-cars-used/catalog.json');if(!state.complete)throw Error('Catalog incomplete; resume collection');
  const dict=read('work/onliner-cars-used/dictionaries.json');if(dict.sha256!==digest(JSON.stringify(dict.data)))throw Error('Dictionary hash mismatch');
  const geo=read('work/onliner-cars-used/geography.json');
  const ui=Object.fromEntries(['tech-petrol','tech-electric','tech-diesel','exterior','cost-used','contacts'].map(s=>[s,read(out+'/evidence/onliner-'+s+'.json')]));
  const result=normalize(state,dict.data,geo,ui,read(out+'/evidence/onliner-labels.json').labels,read(out+'/evidence/onliner-equipment-tests.json'));
  const stats=validate(result.schema,result.binding,state);
  save(out+'/'+CATEGORY+'_onliner.json',result.schema);save(out+'/binding_'+CATEGORY+'_onliner.json',result.binding);
  save(out+'/evidence/onliner-catalog-source.json',state);save(out+'/evidence/onliner-dictionaries.json',dict);save(out+'/evidence/onliner-geography.json',geo);
  save(out+'/evidence/onliner-catalog-audit.json',{...stats,at:new Date().toISOString(),catalog_sha256:digest(JSON.stringify(state)),schema_sha256:digest(JSON.stringify(result.schema)),binding_sha256:digest(JSON.stringify(result.binding)),year_filter:false,years_collected:false});return stats;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)console.log(JSON.stringify(build()));
