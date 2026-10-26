// Shared by the app, server and generated extension script. No network or DOM access.
export type FieldRule = {key:string;label:string;required:boolean;options:string[][];depends?:{key:string;values:string[]|null}[];anchor:string;platform?:string;formName?:string;description?:boolean};
export type FieldCatalog = {kufar:Record<string,FieldRule[]>;extra?:Record<string,FieldRule[]>};
export type FieldMapping = {id:string;attributes?:{key:string;value:string;label:string}[]};
export type AttributeValues = Record<string,string>;
const systemFields = new Set(['coordinates','other_parameters','re_object_checked','responsible_account_id']);
export const baseFieldKeys:Record<string,string> = {condition:'condition',cars_brand_v2:'brand',cars_model_v2:'model',regdate:'year',mileage:'mileage',cars_capacity:'engine',cars_engine:'fuel',cars_gearbox:'transmission',cars_type:'body',cars_drive:'drive',cars_color:'color',vehicle_vin:'vin',spares_parts_number:'partNumber'};
const norm=(value:string)=>value.toLowerCase().replace(/ё/g,'е').replace(/[\s.,/()-]+/g,'').replace(/^нов(?:ая|ый|ое)$/,'новое');
export function fieldRules(catalog:FieldCatalog,mapping:FieldMapping|undefined,attributes:AttributeValues,listing:Record<string,string> = {}) {
  const rules = [...(mapping ? catalog.kufar[mapping.id] || [] : []),...(catalog.extra?.[listing.taxonomyId]||[])];
  const values:AttributeValues = {...attributes};
  for(const rule of rules){const source=listing[baseFieldKeys[rule.key]];if(source){const option=rule.options.find(([,label])=>norm(label)===norm(source));if(option||!rule.options.length)values[rule.key]=option?.[0]||source;}}
  for(const fixed of mapping?.attributes||[])values[fixed.key]=fixed.value;
  const selected:FieldRule[]=[];
  for(const rule of rules){
    if(systemFields.has(rule.key))continue;
    if(rule.depends?.some(dep=>dep.values?!dep.values.includes(values[dep.key]):!values[dep.key]))continue;
    // A key can have different labels and options for different parent choices.
    if(!selected.some(f=>f.key===rule.key))selected.push(rule);
  }
  return selected;
}
export function sanitizeAttributes(catalog:FieldCatalog,mapping:FieldMapping|undefined,input:unknown,listing:Record<string,string> = {}):AttributeValues {
  const raw=input && typeof input==='object'&&!Array.isArray(input)?input as Record<string,unknown>:{};
  const values:AttributeValues={};
  const allowed = new Set([...(mapping ? catalog.kufar[mapping.id] || [] : []),...(catalog.extra?.[listing.taxonomyId]||[])].map(f=>f.key));
  for(const [key,value] of Object.entries(raw).slice(0,80))if(allowed.has(key)&&!systemFields.has(key)&&!baseFieldKeys[key]&&typeof value==='string'&&value.length<=300&&!/[\u0000-\u001f]/.test(value))values[key]=value.trim();
  // Iterate to drop child values whose parent has changed or been cleared.
  for(let pass=0;pass<8;pass++){
    const applicable=fieldRules(catalog,mapping,values,listing);
    let changed=false;
    for(const key of Object.keys(values)){
      const rule=applicable.find(f=>f.key===key);
      if(!values[key]||!rule||mapping?.attributes?.some(a=>a.key===key)||(rule.options.length&&!rule.options.some(([code])=>code===values[key]))){delete values[key];changed=true;}
    }
    if(!changed)break;
  }
  return values;
}
export function attributeEntries(catalog:FieldCatalog,mapping:FieldMapping|undefined,input:unknown,listing:Record<string,string> = {}) {
  const values=sanitizeAttributes(catalog,mapping,input,listing);
  return fieldRules(catalog,mapping,values,listing).filter(field=>values[field.key]).map(field=>({key:field.key,label:field.label,value:values[field.key],text:field.options.find(([code])=>code===values[field.key])?.[1]||values[field.key],platform:field.platform||'kufar',formName:field.formName,description:field.description!==false}));
}
