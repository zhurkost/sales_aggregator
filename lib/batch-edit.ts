import type {Listing} from './listing.ts';
export type BatchEdit={city:string;phone:string;availability:string;priceMode:'keep'|'percent'|'fixed';priceValue:string};
export const emptyBatchEdit:BatchEdit={city:'',phone:'',availability:'',priceMode:'keep',priceValue:''};
export function editListing(listing:Listing,edit:BatchEdit):Listing {
  if(!['keep','percent','fixed'].includes(edit.priceMode))throw new Error('Неизвестное изменение цены.');
  const next={...listing};
  if(edit.city)next.city=edit.city.trim().slice(0,100);
  if(edit.phone){if(!/^\+375\d{9}$/.test(edit.phone.replace(/[\s()-]/g,'')))throw new Error('Телефон в формате +375XXXXXXXXX.');next.phone=edit.phone.trim();}
  if(edit.availability){if(!['В наличии','Под заказ'].includes(edit.availability))throw new Error('Неизвестное наличие.');next.availability=edit.availability;}
  if(edit.priceMode!=='keep') {
    if(!/^-?\d+(?:[.,]\d{1,2})?$/.test(edit.priceValue))throw new Error('Укажите число для изменения цены.');
    const value=Number(edit.priceValue.replace(',','.'));
    if(edit.priceMode==='percent' && (!listing.price || !Number.isFinite(+listing.price)))throw new Error('У карточки отсутствует исходная цена.');
    const price=edit.priceMode==='fixed'?value:Number(listing.price)*(1+value/100);
    const cents=Math.round((price+Number.EPSILON)*100);
    if(cents<=0||cents>1e12)throw new Error('Результирующая цена должна быть больше нуля и не более 10 млрд.');
    next.price=(cents/100).toFixed(2).replace(/\.00$/,'');
  }
  return next;
}
