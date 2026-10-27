export type SellerTemplate={id:string;name:string;delivery:string;warranty:string;warehouse:string;platformText:Record<string,string>};
export const emptyTemplate:SellerTemplate={id:'',name:'',delivery:'',warranty:'',warehouse:'',platformText:{}};
export function templateText(t:SellerTemplate){return [t.delivery&&'Доставка: '+t.delivery,t.warranty&&'Гарантия: '+t.warranty,t.warehouse&&'Получение: '+t.warehouse].filter(Boolean).join('\n');}
export function cleanTemplates(value:unknown):SellerTemplate[]{
  const clean=(s:unknown,n=500)=>typeof s==='string'?s.trim().slice(0,n):'';
  return (Array.isArray(value)?value:[]).slice(0,30).map(t=>({id:clean(t.id,80),name:clean(t.name,80),delivery:clean(t.delivery),warranty:clean(t.warranty),warehouse:clean(t.warehouse),
    platformText:Object.fromEntries(['kufar','onliner','bamper','av','abw','flagma','drom'].map(id=>[id,clean(t.platformText?.[id],1000)]).filter(([,v])=>v))})).filter(t=>t.id&&t.name);
}
