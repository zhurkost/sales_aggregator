import type {ImportTable} from './bulk.ts';
// DTDs/entities are rejected before the browser parses XML.
export function readYml(text:string):ImportTable {
  if(text.length>5*1024*1024 || /<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('XML с DTD или сущностями не поддерживается.');
  const doc=new DOMParser().parseFromString(text,'application/xml');
  if(doc.querySelector('parsererror') || doc.documentElement.localName!=='yml_catalog')throw new Error('Нужен корректный YML-каталог товаров.');
  const offers=Array.from(doc.querySelectorAll('shop > offers > offer'));
  if(!offers.length || offers.length>500)throw new Error('В YML должно быть от 1 до 500 товаров. Разделите большой каталог.');
  const rows=offers.map(offer=>{
    const value=(name:string)=>Array.from(offer.children).find(n=>n.localName===name)?.textContent?.trim()||'';
    const params=Array.from(offer.children).filter(n=>n.localName==='param').map(n=>`${n.getAttribute('name')||'Характеристика'}: ${n.textContent||''}`).join('\n');
    return {externalId:offer.getAttribute('id')||'',title:value('name')||[value('typePrefix'),value('vendor'),value('model')].filter(Boolean).join(' '),
      description:[value('description').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' '),params].filter(Boolean).join('\n'),
      price:value('price').replace(',','.'),currency:value('currencyId'),manufacturer:value('vendor'),model:value('model'),partNumber:value('vendorCode'),
      quantity:value('count'),availability:offer.getAttribute('available')==='false'?'Нет в наличии':'',
      photoUrls:Array.from(offer.children).filter(n=>n.localName==='picture').map(n=>n.textContent?.trim()).filter(Boolean).slice(0,12).join('|')};
  });
  return {headers:Object.keys(rows[0]),rows};
}
export type ImportPreset={id:string;name:string;columns:Record<string,string>;categoryId:string;url:string};
