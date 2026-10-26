import snapshot from '../data/category-fields.json' with {type:'json'};
import {categoryMapping,type CategoryOverrides} from './taxonomy.ts';
import type {Listing} from './listing.ts';
import {fieldRules,sanitizeAttributes,attributeEntries,baseFieldKeys,type FieldCatalog,type AttributeValues} from './field-rules.ts';
export const fieldCatalog = snapshot as FieldCatalog & {source:string;checkedAt:string;coverage:Record<string,Record<string,string>>};
export function fieldVerification(taxonomyId:string,platform:string,overrides:CategoryOverrides={}) {
  const mapping=categoryMapping(taxonomyId,platform,overrides);
  if(!mapping)return {status:'not_mapped',source:''};
  const audit=(snapshot.audit as Record<string,unknown>)[platform] as {status:string;source:string;categoryIds?:string[];sampleCategoryIds?:string[]}|undefined;
  if(audit?.categoryIds?.includes(mapping.id))return {status:'form_inspected',source:audit.source};
  if(audit?.status==='blocked_vpn')return {status:'blocked_vpn',source:audit.source};
  if(platform==='kufar'&&fieldCatalog.kufar[mapping.id])return {status:audit?.sampleCategoryIds?.includes(taxonomyId)&&!overrides.kufar?'documentation_and_sample':'documentation',source:fieldCatalog.source};
  return {status:'form_not_verified',source:audit?.source||''};
}
export function categoryFields(listing:Listing,values:AttributeValues={},overrides:CategoryOverrides={}) {
  const mapping=categoryMapping(listing.taxonomyId,'kufar',overrides);
  return fieldRules(fieldCatalog,mapping,values,listing).filter(f=>!baseFieldKeys[f.key]&&!mapping?.attributes?.some(a=>a.key===f.key));
}
export function cleanAttributes(listing:Listing,values:unknown,overrides:CategoryOverrides={}) {
  return sanitizeAttributes(fieldCatalog,categoryMapping(listing.taxonomyId,'kufar',overrides),values,listing);
}
export function describeAttributes(listing:Listing,values:unknown,overrides:CategoryOverrides={}) {
  return attributeEntries(fieldCatalog,categoryMapping(listing.taxonomyId,'kufar',overrides),values,listing).filter(f=>f.description).map(f=>`${f.label}: ${f.text}`).join('\n');
}
export function descriptionWithAttributes(listing:Listing,values:unknown,overrides:CategoryOverrides={}) {
  const details=describeAttributes(listing,values,overrides);
  return details ? `${listing.description}\n\nХарактеристики:\n${details}` : listing.description;
}
