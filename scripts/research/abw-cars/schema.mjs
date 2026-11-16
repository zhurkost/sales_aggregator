// Research contract only; no runtime integration or network calls.
export const fieldDefinitions = [
  ['brand','Марка','enum'],['model','Модель','enum'],['year','Год выпуска','integer'],
  ['generation','Поколение','enum'],['body','Кузов','enum'],['engine','Двигатель','enum'],
  ['gear','Привод','enum'],['transmission','Коробка передач','enum'],['modification','Модификация','enum'],
  ['mileage','Пробег, км','integer'],['color','Цвет кузова','enum'],['condition','Состояние','enum'],
  ['availability','Наличие','enum'],['photo','Фото','files'],['video','Ссылка на видео','text'],
  ['description','Описание','text'],['vin','VIN','text'],['price','Цена','number'],
  ['currency','Валюта','enum'],['seller_name','Имя','text'],['email','E-mail','text'],['phone','Номер телефона','text'],['city','Город','enum']
];
export const treeNext={brand:'model',model:'generation',region:'city'};
export const treeFields=new Set(['brand','model','generation','region','city']);
export const typed=v=>typeof v+':'+JSON.stringify(v);
const norm=s=>s.trim().toLowerCase().replaceAll('ё','е');
export function choice(field,name,value=null,parent='') {
  return {id:`abw.${field}.${parent}${encodeURIComponent(value===null?'label:'+norm(name):typed(value))}`,name,
    description:'Наблюдаемый вариант ABW; доступность зависит от контекста формы. Неизвестный код остаётся null.',
    type:'choice',value,options:[]};
}
export function seed(ui) {
  const options=fieldDefinitions.map(([key,name,type])=>({id:'abw.'+key,name,type,options:[],required:null,
    description:'Поле наблюдалось в форме ABW. Полнота, условия и browser binding требуют проверки.',
    ...(['enum','multi_enum'].includes(type)?{options_complete:false}:{})}));
  const field=k=>options.find(f=>f.id==='abw.'+k);
  for(const [key,labels] of Object.entries(ui.flat_labels))field(key).options=labels.map(n=>choice(key,n));
  field('model').parent_option_id='abw.brand';field('generation').parent_option_id='abw.model';
  const kia=choice('brand','Kia',null);Object.assign(kia,{level:'abw.brand',options_complete:false,childOptions:[]});
  const rio=choice('model','Rio',null,kia.id+'.');Object.assign(rio,{level:'abw.model',options_complete:false,childOptions:[]});
  kia.childOptions.push(rio);field('brand').options.push(kia);
  field('year').description='Год выпуска. ABW использует внутренний код года; числовой год не равен API id. Годы/коды/диапазоны только в памяти обхода, не в итоговых справочниках.';
  field('photo').file_role='product_image';field('photo').description='Рекомендация: не более 5 фото одновременно; до 15 мб на фото. Общий лимит, точное число байтов, MIME и проверка принятия неизвестны.';
  field('phone').description='В наблюдённом состоянии поле заблокировано. Есть добавление номера; доступность, подтверждение и множественность требуют проверки.';
  field('price').description='Сайт сообщает публикацию цены в BYN по курсу НБРБ. Валюта ввода и её переключатель пока не исследованы; конверсию не выполнять.';
  field('city').description='Город виден. Регион и структура выбора пока не подтверждены; до их получения город не включён в придуманную ветвь.';
  const binding={category_id:'cars_used_sale',platform:'abw',fields:options.map(f=>({option_id:f.id,status:'needs_review',reason:'Поле прочитано из UI; DOM-селектор, установка и чтение результата ещё не проверены.',...(f.parent_option_id?{depends_on:[f.parent_option_id]}:{})}))};
  return {schema:[{id:'cars_used_sale',name:'Продажа легковых автомобилей с пробегом',description:'ABW, исследовательская основа 2.2, неполный сбор. Не подключено к production.',categories:[],options}],binding};
}
export function validate({schema,binding}) {
  if(schema.length!==1||schema[0].id!=='cars_used_sale'||binding.platform!=='abw')throw Error('Category/platform mismatch');
  const fields=schema[0].options,ids=new Set(),fieldIds=new Set(fields.map(f=>f.id));
  function visit(o,level){
    if(ids.has(o.id)||!o.id.startsWith('abw.')||!Array.isArray(o.options))throw Error('Invalid or duplicate option');ids.add(o.id);
    if(o.type==='choice'&&(!Object.hasOwn(o,'value')||o.options.length))throw Error('Invalid choice');
    if(o.childOptions){
      if(o.level!==level||o.type!=='choice'||!treeFields.has(level?.slice(4)))throw Error('Invalid tree level');
      if(typeof o.options_complete!=='boolean')throw Error('Missing completeness');
      const next=treeNext[level.slice(4)];if(!next&&o.childOptions.length)throw Error('Unexpected children');
      o.childOptions.forEach(c=>visit(c,'abw.'+next));
    }
    o.options.forEach(c=>visit(c,o.id));
  }
  for(const f of fields){
    visit(f);
    if(['enum','multi_enum'].includes(f.type)&&typeof f.options_complete!=='boolean')throw Error('Missing completeness');
    if(f.parent_option_id&&(!fieldIds.has(f.parent_option_id)||f.options.length))throw Error('Invalid parent');
    if(f.id==='abw.year'&&(f.options.length||f.validation))throw Error('Persisted year dictionary');
  }
  if(binding.fields.length!==fields.length||new Set(binding.fields.map(f=>f.option_id)).size!==fields.length)throw Error('Binding coverage');
  for(const b of binding.fields)if(!fieldIds.has(b.option_id)||b.status!=='needs_review'||!b.reason)throw Error('Unverified binding');
  return {fields:fields.length,choices:ids.size-fields.length};
}
