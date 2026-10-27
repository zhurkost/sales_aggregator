export type ProductGroup = 'cars' | 'parts' | 'general';
export type Listing = {
  category: ProductGroup;
  taxonomyId: string;
  title: string; description: string; brand: string; model: string; year: string;
  mileage: string; engine: string; fuel: string; transmission: string; body: string;
  drive: string; color: string; price: string; currency: string; city: string; phone: string; vin: string;
  partName: string; partNumber: string; manufacturer: string; condition: string; compatibility: string;
  fitYears: string; position: string; quantity: string; priceUnit: string; availability: string;
};
export const emptyListing: Listing = { category:'cars',taxonomyId:'',title:'',description:'',brand:'',model:'',year:'',mileage:'',engine:'',fuel:'',transmission:'',body:'',drive:'',color:'',price:'',currency:'',city:'',phone:'',vin:'',partName:'',partNumber:'',manufacturer:'',condition:'',compatibility:'',fitYears:'',position:'',quantity:'',priceUnit:'',availability:'' };
export const sample = 'Продам Volkswagen Passat B8, 2018 год. 2.0 дизель, автомат, передний привод, универсал, серый. Пробег 164 000 км. Минск. Цена 18 900 USD. Один владелец, сервисная история, два комплекта шин. Есть царапина на заднем бампере. Торг у автомобиля.';
export const partsSample = 'Продам левую переднюю фару для Volkswagen Passat B8. Автомобиль-донор 2018 года. Артикул 3G1941035D. Б/у, есть царапина на стекле, одно крепление восстановлено. Совместимость: Volkswagen Passat B8, 2015–2019; сверяйте номер и крепления. Цена 450 BYN за штуку. В наличии 1 шт. Минск.';
export const fields: {key:keyof Listing;label:string;placeholder?:string;options?:string[]}[] = [
  {key:'brand',label:'Марка',placeholder:'Volkswagen'}, {key:'model',label:'Модель',placeholder:'Passat B8'},
  {key:'year',label:'Год',placeholder:'2018'}, {key:'mileage',label:'Пробег, км',placeholder:'164000'},
  {key:'engine',label:'Объём, л',placeholder:'2.0'}, {key:'fuel',label:'Двигатель',options:['Бензин','Дизель','Электро','Гибрид','Газ']},
  {key:'transmission',label:'Коробка',options:['Автомат','Механика','Робот','Вариатор']},
  {key:'body',label:'Кузов',options:['Седан','Универсал','Хэтчбек','Внедорожник','Кроссовер','Купе','Кабриолет','Минивэн','Лифтбек','Пикап']},
  {key:'drive',label:'Привод',options:['Передний','Задний','Полный']}, {key:'color',label:'Цвет',placeholder:'Серый'},
  {key:'price',label:'Цена',placeholder:'18900'}, {key:'currency',label:'Валюта',options:['USD','BYN','EUR']},
  {key:'city',label:'Город',placeholder:'Минск'}, {key:'phone',label:'Телефон',placeholder:'+375 …'}, {key:'vin',label:'VIN · необязательно',placeholder:'17 символов'},
];
export const partFields: typeof fields = [
  {key:'partName',label:'Название детали',placeholder:'Фара передняя левая'},
  {key:'partNumber',label:'Артикул / OEM · если известен',placeholder:'3G1941035D'},
  {key:'manufacturer',label:'Производитель детали',placeholder:'Укажите, если известен'},
  {key:'condition',label:'Состояние',options:['Новая','Б/у','На восстановление']},
  {key:'brand',label:'Марка автомобиля',placeholder:'Volkswagen'},
  {key:'model',label:'Модель автомобиля',placeholder:'Passat B8'},
  {key:'year',label:'Год автомобиля-донора · если известен',placeholder:'2018'},
  {key:'fitYears',label:'Совместимые годы · со слов продавца',placeholder:'2015–2019'},
  {key:'compatibility',label:'Совместимость · только проверенные данные',placeholder:'Модель, поколение, модификация'},
  {key:'position',label:'Расположение детали',placeholder:'Передняя левая'},
  {key:'quantity',label:'Количество · если известно',placeholder:'1'},
  {key:'availability',label:'Наличие',options:['В наличии','Под заказ','Нет в наличии']},
  {key:'price',label:'Цена',placeholder:'450'},
  {key:'currency',label:'Валюта',options:['BYN','USD','EUR']},
  {key:'priceUnit',label:'Цена указана',options:['За штуку','За комплект','За пару']},
  {key:'city',label:'Город',placeholder:'Минск'},
  {key:'phone',label:'Телефон',placeholder:'+375 …'},
];
export const generalFields:typeof fields=[{key:'condition',label:'Состояние',options:['Новая','Б/у','На восстановление']},...fields.filter(f=>['price','currency','city','phone'].includes(f.key)),{key:'quantity',label:'Количество'},{key:'availability',label:'Наличие',options:['В наличии','Под заказ','Нет в наличии']},{key:'manufacturer',label:'Производитель'},{key:'model',label:'Модель'}];
export function sanitizeListing(input: unknown, category?:ProductGroup): Listing {
  const obj = input && typeof input === 'object' ? input as Record<string,unknown> : {};
  const result = {...emptyListing};
  for (const key of Object.keys(result) as (keyof Listing)[]) {
    if(key === 'category') continue;
    const v = obj[key];
    result[key] = (typeof v === 'string' || typeof v === 'number') ? String(v).trim().slice(0,key === 'description' ? 8000 : key === 'compatibility' ? 500 : key === 'title' ? 120 : 100) : '';
  }
  result.category = category || (obj.category === 'parts' ? 'parts' : obj.category==='general'?'general':'cars');
  for(const key of ['year','price','mileage'] as const) result[key] = result[key].replace(/[\s\u00a0]/g,'');
  result.engine = result.engine.replace(',','.');
  result.currency = ['USD','BYN','EUR'].includes(result.currency.toUpperCase()) ? result.currency.toUpperCase() : '';
  if(result.category==='parts') {
    result.condition=['Новая','Б/у','На восстановление'].includes(result.condition)?result.condition:'';
    result.priceUnit=['За штуку','За комплект','За пару'].includes(result.priceUnit)?result.priceUnit:'';
    result.availability=['В наличии','Под заказ','Нет в наличии'].includes(result.availability)?result.availability:'';
    for(const key of ['mileage','engine','fuel','transmission','body','drive','vin'] as const) result[key]='';
  }
  return result;
}
export function parseLocally(text:string, category:ProductGroup='cars'):Listing {
  if(category==='parts') return parsePartsLocally(text);
  if(category==='general'){const d=parseLocally(text,'cars');return sanitizeListing({...emptyListing,description:text.trim(),title:text.split(/[.!\n]/)[0].slice(0,100),price:d.price,currency:d.currency,city:d.city,phone:d.phone},'general');}
  const d = {...emptyListing, description:text.trim()};
  const brands = ['Volkswagen','Mercedes-Benz','BMW','Audi','Toyota','Renault','Peugeot','Citroen','Skoda','Škoda','Volvo','Kia','Hyundai','Geely','Chery','Belgee','Nissan','Ford','Opel','Mazda','Honda','Chevrolet','Lexus','Tesla','Porsche'];
  for(const brand of brands){
    const found = new RegExp(`\\b${brand}\\s+([^,;.\\n]+)`,'i').exec(text);
    if(found){d.brand = brand; d.model=found[1].replace(/\b(?:19|20)\d{2}\b[\s\S]*$/,'').trim().slice(0,60);break;}
  }
  d.year=text.match(/\b(?:19|20)\d{2}\b/)?.[0] || '';
  const mileage = text.match(/(?:пробег\s*[:—-]?\s*)?(\d[\d\s]*[.,]?\d*)\s*(тыс(?:яч)?\.?\s*)?(?:км|километр)/i);
  if(mileage) d.mileage=String(Number(mileage[1].replace(/\s/g,'').replace(',','.'))*(mileage[2]?1000:1));
  const money=text.match(/(\d[\d\s]*(?:[.,]\d+)?)\s*(USD|BYN|EUR|\$|€|бел(?:орусских)?\.?\s*руб|доллар)/i);
  if(money){d.price=money[1].replace(/\s/g,'').replace(',','.'); d.currency=/USD|\$|доллар/i.test(money[2])?'USD':/EUR|€/i.test(money[2])?'EUR':'BYN';}
  d.engine=text.match(/\b([0-6][.,]\d)\s*(?:л(?:итра)?\b|дизель|бензин|TDI|TSI)/i)?.[1].replace(',','.') || '';
  const maps:Partial<Record<keyof Listing,[RegExp,string][]>>={
    fuel:[[/дизель|tdi/i,'Дизель'],[/бензин|tsi/i,'Бензин'],[/электро/i,'Электро'],[/гибрид/i,'Гибрид']],
    transmission:[[/автомат|акпп/i,'Автомат'],[/механик|мкпп/i,'Механика'],[/робот|dsg/i,'Робот'],[/вариатор|cvt/i,'Вариатор']],
    body:[[/универсал/i,'Универсал'],[/седан/i,'Седан'],[/хэтчбек/i,'Хэтчбек'],[/кроссовер/i,'Кроссовер'],[/внедорожник/i,'Внедорожник']],
    drive:[[/передний\s+привод/i,'Передний'],[/задний\s+привод/i,'Задний'],[/полный\s+привод|4x4/i,'Полный']],
    color:[[/сер[ыа]й/i,'Серый'],[/ч[её]рный/i,'Чёрный'],[/белый/i,'Белый'],[/синий/i,'Синий'],[/красный/i,'Красный']],
    city:[[/Минск/i,'Минск'],[/Брест/i,'Брест'],[/Гродно/i,'Гродно'],[/Гомель/i,'Гомель'],[/Витебск/i,'Витебск'],[/Могил[её]в/i,'Могилёв']],
  };
  for(const [key,items] of Object.entries(maps)) for(const [re,value] of items!) if(re.test(text)){d[key as Exclude<keyof Listing,'category'>]=value;break;}
  d.phone=text.match(/\+375[\s()\d-]{9,18}/)?.[0].trim() || '';
  d.vin=text.match(/\bVIN\s*[:—-]?\s*([A-HJ-NPR-Z0-9]{17})\b/i)?.[1].toUpperCase() || '';
  d.title=[d.brand,d.model,d.year].filter(Boolean).join(' ');
  return sanitizeListing(d);
}
export function validateListing(d:Listing):string[]{
  const missing:string[]=[];
  const required: (keyof Listing)[]=d.category==='general'?['title','price','currency','city','phone']:d.category==='parts'?['partName','condition','price','currency','priceUnit','city','phone']:['brand','model','year','price','currency','city','phone'];
  const definitions=d.category==='parts'?partFields:fields;
  for(const key of required) if(!d[key]) missing.push(definitions.find(f=>f.key===key)?.label||'Заголовок');
  if(d.year && (!/^\d{4}$/.test(d.year) || +d.year<1900 || +d.year>new Date().getFullYear()+1)) missing.push('Корректный год выпуска');
  if(d.price && (!/^\d+(\.\d{1,2})?$/.test(d.price) || +d.price<=0)) missing.push('Цена больше нуля');
  if(d.mileage && (!/^\d+$/.test(d.mileage) || +d.mileage>9999999)) missing.push('Корректный пробег');
  if(d.phone && !/^\+375\d{9}$/.test(d.phone.replace(/[\s()-]/g,''))) missing.push('Телефон в формате +375XXXXXXXXX');
  if(d.vin && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(d.vin)) missing.push('VIN из 17 символов без I, O, Q');
  if(d.engine && (!/^\d(?:\.\d{1,2})?$/.test(d.engine) || +d.engine>9.9 || +d.engine<=0)) missing.push('Корректный объём двигателя');
  if(d.category==='parts'){
    if(d.quantity && (!/^\d+$/.test(d.quantity)||+d.quantity<0||+d.quantity>1000000))missing.push('Количество — целое число от 0');
    if(d.condition&&!['Новая','Б/у','На восстановление'].includes(d.condition))missing.push('Состояние детали');
    if(d.priceUnit&&!['За штуку','За комплект','За пару'].includes(d.priceUnit))missing.push('Цена за штуку, комплект или пару');
  }
  if(!d.description.trim()) missing.push('Описание');
  return missing;
}
export function listingText(d:Listing){
  if(d.category==='general')return [d.title,`${d.price} ${d.currency}`,d.condition,d.description,d.city,d.phone].filter(Boolean).join('\n\n');
  if(d.category==='parts')return [listingTitle(d),`${d.price} ${d.currency}${d.priceUnit?' · '+d.priceUnit.toLowerCase():''}`.trim(),
    d.partNumber&&`Артикул / OEM: ${d.partNumber}`, d.manufacturer&&`Производитель: ${d.manufacturer}`,
    d.condition&&`Состояние: ${d.condition}`, [d.brand,d.model,d.year].filter(Boolean).length&&`Автомобиль: ${[d.brand,d.model,d.year].filter(Boolean).join(' ')}`,
    d.compatibility&&`Совместимость (со слов продавца): ${d.compatibility}`,d.fitYears&&`Годы применимости: ${d.fitYears}`,
    d.position&&`Расположение: ${d.position}`, d.quantity&&`Количество: ${d.quantity}`,d.availability,
    d.description,d.city,d.phone].filter(Boolean).join('\n\n');
  return [d.title || [d.brand,d.model,d.year].filter(Boolean).join(' '),`${d.price} ${d.currency}`.trim(),[d.year && `${d.year} г.`,d.mileage && `${Number(d.mileage).toLocaleString('ru-RU')} км`,d.engine && `${d.engine} л`,d.fuel,d.transmission,d.body,d.drive].filter(Boolean).join(' · '),d.description,d.city,d.phone,d.vin && `VIN: ${d.vin}`].filter(Boolean).join('\n\n');
}
export function listingTitle(d:Listing){return d.title||(d.category==='parts'?[d.partName,d.brand,d.model,d.partNumber]:[d.brand,d.model,d.year]).filter(Boolean).join(' ');}
export function requiredFields(category:ProductGroup):(keyof Listing)[]{return category==='general'?['title','price','currency','city','phone','description']:category==='parts'?['partName','condition','price','currency','priceUnit','city','phone','description']:['brand','model','year','price','currency','city','phone','description'];}
export function parsePartsLocally(text:string):Listing {
  const base=parseLocally(text);
  const d={...emptyListing,category:'parts' as const,description:text.trim(),price:base.price,currency:base.currency,city:base.city,phone:base.phone};
  d.partNumber=(text.match(/(?:артикул|OEM|оригинальный номер|номер детали)\s*[:№-]?\s*([A-Za-zА-Яа-я0-9][A-Za-zА-Яа-я0-9._/-]{2,99})/iu)?.[1]||'').replace(/[.,;:]+$/u,'');
  d.partName=text.match(/(?:продам|продаю|деталь\s*:|запчасть\s*:)\s+([^.!;\n]+?)(?=\s+(?:для|на)\s+[A-ZА-Я]|[.!;\n]|$)/iu)?.[1]?.trim()||'';
  const vehicle=text.match(/(?:для|совместимость\s*:|автомобиль\s*:|снята с)\s+([A-Z][\w-]+)\s+([^,.\n;]+)/iu);
  if(vehicle){d.brand=vehicle[1];d.model=vehicle[2].trim();}
  d.year=text.match(/(?:донор[а]?|год донора)\s*[:—-]?\s*((?:19|20)\d{2})/iu)?.[1]||'';
  d.compatibility=text.match(/совместимость\s*:\s*([^.;\n]+)/iu)?.[1]?.trim()||'';
  d.fitYears=text.match(/((?:19|20)\d{2}\s*[–—-]\s*(?:19|20)\d{2})/u)?.[1]||'';
  d.manufacturer=text.match(/производитель\s*:\s*([^,.;\n]+)/iu)?.[1]?.trim()||'';
  const positive=text.replace(/(?:не|нет)\s+(?:нов(?:ая|ый|ое|ые)|б\s*\/\s*у|в наличии|на восстановление|под заказ)/giu,'');
  d.condition=/на восстановление|под восстановление/iu.test(positive)?'На восстановление':/б\s*\/\s*у|бывш\S*\s+в употреблении/iu.test(positive)?'Б/у':/(?:^|[\s,;])нов(?:ая|ый|ое|ые)(?=[\s,.!;]|$)/iu.test(positive)?'Новая':'';
  d.priceUnit=/за\s+комплект/iu.test(text)?'За комплект':/за\s+пару/iu.test(text)?'За пару':/за\s+штуку|за\s+шт\b/iu.test(text)?'За штуку':'';
  d.quantity=text.match(/(?:количество\s*:?|в наличии)\s*(\d+)\s*(?:шт\.?|штук)/iu)?.[1]||'';
  d.availability=/под заказ/iu.test(positive)?'Под заказ':/в наличии/iu.test(positive)?'В наличии':'';
  d.position=text.match(/(?:расположение|сторона)\s*:\s*([^,.;\n]+)/iu)?.[1]?.trim()||'';
  d.title=[d.partName,d.brand,d.model,d.partNumber].filter(Boolean).join(' ');
  return sanitizeListing(d,'parts');
}
