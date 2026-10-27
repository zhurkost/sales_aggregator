import {sanitizeListing} from './listing.ts';
import {categoryById,categoryMapping,sanitizeCategoryOverrides,taxonomy} from './taxonomy.ts';
import {fieldCatalog,cleanAttributes} from './attributes.ts';
import {attributeEntries} from './field-rules.ts';
import {getPlatforms} from './platforms.ts';

// Data only: no JavaScript, selectors, arbitrary navigation or executable rules.
export function extensionRecipe(input: {listing?:unknown;categoryOverrides?:unknown;attributes?:unknown;platforms?:{id:string}[]}) {
  const listing = sanitizeListing(input.listing);
  const category = categoryById(listing.taxonomyId || (listing.category === 'cars' ? 'auto.cars' : listing.category === 'parts' ? 'auto.parts' : ''));
  if (!category) throw new Error('Подтвердите категорию товара.');
  listing.taxonomyId = category.id; listing.category = category.group;
  const overrides = sanitizeCategoryOverrides(input.categoryOverrides);
  if (input.categoryOverrides && JSON.stringify(Object.entries(overrides).sort()) !== JSON.stringify(Object.entries(input.categoryOverrides).sort()))
    throw new Error('Категория площадки отсутствует в справочнике. Выберите её снова.');
  const platforms = getPlatforms(listing.category,category.id).filter(p=>!input.platforms || input.platforms.some(item=>item.id===p.id));
  const mappings = Object.fromEntries(platforms.flatMap(p=>{
    const value = categoryMapping(category.id,p.canonicalId,overrides);
    return value ? [[p.canonicalId,{id:value.id,path:value.path,attributes:value.attributes||[]}]] : [];
  }));
  const values = cleanAttributes(listing,input.attributes,overrides);
  const entries = attributeEntries(fieldCatalog,categoryMapping(category.id,'kufar',overrides),values,listing)
    .filter(entry=>platforms.some(p=>p.canonicalId===entry.platform));
  return {protocol:1,version:`${taxonomy.version}/${fieldCatalog.checkedAt}`,taxonomyId:category.id,category:category.group,mappings,values,entries};
}
