export type Listing = {
  title: string; description: string; brand: string; model: string; year: string;
  mileage: string; engine: string; fuel: string; transmission: string; body: string;
  drive: string; color: string; price: string; currency: string; city: string; phone: string; vin: string;
};
export const emptyListing: Listing = { title:'',description:'',brand:'',model:'',year:'',mileage:'',engine:'',fuel:'',transmission:'',body:'',drive:'',color:'',price:'',currency:'',city:'',phone:'',vin:'' };
export const sample = 'Продам Volkswagen Passat B8, 2018 год. 2.0 дизель, автомат, передний привод, универсал, серый. Пробег 164 000 км. Минск. Цена 18 900 USD. Один владелец, сервисная история, два комплекта шин. Есть царапина на заднем бампере. Торг у автомобиля.';
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
export function sanitizeListing(input: unknown): Listing {
  const obj = input && typeof input === 'object' ? input as Record<string,unknown> : {};
  const result = {...emptyListing};
  for (const key of Object.keys(result) as (keyof Listing)[]) {
    const v = obj[key];
    result[key] = (typeof v === 'string' || typeof v === 'number') ? String(v).trim().slice(0,key === 'description' ? 8000 : key === 'title' ? 120 : 100) : '';
  }
  for(const key of ['year','price','mileage'] as const) result[key] = result[key].replace(/[\s\u00a0]/g,'');
  result.engine = result.engine.replace(',','.');
  result.currency = ['USD','BYN','EUR'].includes(result.currency.toUpperCase()) ? result.currency.toUpperCase() : '';
  return result;
}
export function parseLocally(text:string):Listing {
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
  for(const [key,items] of Object.entries(maps)) for(const [re,value] of items!) if(re.test(text)){d[key as keyof Listing]=value;break;}
  d.phone=text.match(/\+375[\s()\d-]{9,18}/)?.[0].trim() || '';
  d.vin=text.match(/\bVIN\s*[:—-]?\s*([A-HJ-NPR-Z0-9]{17})\b/i)?.[1].toUpperCase() || '';
  d.title=[d.brand,d.model,d.year].filter(Boolean).join(' ');
  return sanitizeListing(d);
}
export function validateListing(d:Listing):string[]{
  const missing:string[]=[];
  for(const key of ['brand','model','year','price','currency','city','phone'] as const) if(!d[key]) missing.push(fields.find(f=>f.key===key)!.label);
  if(d.year && (!/^\d{4}$/.test(d.year) || +d.year<1900 || +d.year>new Date().getFullYear()+1)) missing.push('Корректный год выпуска');
  if(d.price && (!/^\d+(\.\d{1,2})?$/.test(d.price) || +d.price<=0)) missing.push('Цена больше нуля');
  if(d.mileage && (!/^\d+$/.test(d.mileage) || +d.mileage>9999999)) missing.push('Корректный пробег');
  if(d.phone && !/^\+375\d{9}$/.test(d.phone.replace(/[\s()-]/g,''))) missing.push('Телефон в формате +375XXXXXXXXX');
  if(d.vin && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(d.vin)) missing.push('VIN из 17 символов без I, O, Q');
  if(d.engine && (!/^\d(?:\.\d{1,2})?$/.test(d.engine) || +d.engine>9.9 || +d.engine<=0)) missing.push('Корректный объём двигателя');
  if(!d.description.trim()) missing.push('Описание');
  return missing;
}
export function listingText(d:Listing){
  return [d.title || [d.brand,d.model,d.year].filter(Boolean).join(' '),`${d.price} ${d.currency}`.trim(),[d.year && `${d.year} г.`,d.mileage && `${Number(d.mileage).toLocaleString('ru-RU')} км`,d.engine && `${d.engine} л`,d.fuel,d.transmission,d.body,d.drive].filter(Boolean).join(' · '),d.description,d.city,d.phone,d.vin && `VIN: ${d.vin}`].filter(Boolean).join('\n\n');
}
