import {generationName,normalize} from './cars-canonicalization.mjs';

// Containment, not equivalence: never use these rules to merge IDs or add AI aliases.
function description(brand,model,name){
 // Keep native chassis codes: a reviewed alias such as Kia (FB) -> IV does not
 // make FB a generic target for every regional version of generation IV.
 let value=generationName('',model,name);
 // JavaScript word boundaries are ASCII; use an explicit Cyrillic boundary instead.
 const rest=value.match(/(?:^|\s|\()Рестайлинг(?:\s+(\d+))?(?=\s|\)|$)/iu);
 const state=rest?.[1]|| (rest?'1':'0');
 if(rest)value=value.replace(rest[0],' ');
 const qualifiers=[];
 value=value.replace(/\(?\b(Global market|Long|Gran Coupe|Gran Coupé|Grand Coupe|Gran Turismo|GT|Coupe|Coupé|Cabriolet|Sedan|Touring|Hatchback|Europe|USA|China|Japan)\b\)?/gi,(_,q)=>{qualifiers.push(normalize(q).replace('grand coupe','gran coupe').replace('gran turismo','gt').replace('coupé','coupe'));return ' ';});
 value=value.replace(/[()]/g,' ').trim().replace(/\s+/g,' ');
 const ordinal=value.match(/^([IVX]+)(?=\s|$)/)?.[1]||null;
 if(ordinal)value=value.slice(ordinal.length).trim();
 value=value.toUpperCase().replace(/^TYP\s+/,'').replace(/\s*[-–—,/]\s*/g,'/');
 // Visually identical Cyrillic characters occur in factory codes, never transliterate words.
 value=value.replace(/[АВЕКМНОРСТХУ]/g,c=>({'А':'A','В':'B','Е':'E','К':'K','М':'M','Н':'H','О':'O','Р':'P','С':'C','Т':'T','Х':'X','У':'Y'}[c]));
 const parts=value?value.split('/').map(s=>s.trim().replace(/\s+/g,'')):[];
 const prefix=parts[0]?.match(/^([A-Z]+)\d/)?.[1];
 if(prefix)for(let i=1;i<parts.length;i++)if(/^\d+$/.test(parts[i]))parts[i]=prefix+parts[i];
 // Unknown text is not discarded: it could name a genuinely different variant.
 if(parts.some(p=>!(/^(?:(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]+|[A-Z]{2,4}|\d{2,4})$/).test(p)))return null;
 if(!ordinal&&!parts.length)return null;
 return {ordinal,codes:[...new Set(parts)],state,qualifiers:[...new Set(qualifiers)]};
}

/** Same explicit identity after formatting normalization; parent model is checked by caller. */
export function equivalentGenerationReason(brand,model,specific,native){
 const from=description(brand,model,specific),to=description(brand,model,native);
 if(!from||!to||from.state!==to.state||from.ordinal&&to.ordinal&&from.ordinal!==to.ordinal)return null;
 if(from.qualifiers.length!==to.qualifiers.length||from.qualifiers.some(q=>!to.qualifiers.includes(q)))return null;
 if(from.codes.length&&to.codes.length&&from.codes.length===to.codes.length&&from.codes.every(c=>to.codes.includes(c)))return 'same_explicit_chassis_codes';
 if(!from.codes.length&&!to.codes.length&&from.ordinal&&from.ordinal===to.ordinal)return 'same_explicit_ordinal';
 return null;
}

export function conflictingGenerationOrdinals(brand,model,specific,native){
 const from=description(brand,model,specific),to=description(brand,model,native);
 return !!(from?.ordinal&&to?.ordinal&&from.ordinal!==to.ordinal);
}

/** Native target must contain the specific generation, without inventing a body/market/phase. */
export function broaderGenerationReason(brand,model,specific,native){
 const from=description(brand,model,specific),to=description(brand,model,native);
 if(!from||!to||from.state!==to.state)return null;
 if(to.qualifiers.some(q=>!from.qualifiers.includes(q)))return null;
 if(from.ordinal&&to.ordinal&&from.ordinal!==to.ordinal)return null;
 let identity=false;
 if(to.codes.length){
  const contains=c=>to.codes.includes(c)||normalize(brand)==='bmw'&&to.codes.some(t=>/^[A-Z]\d?X{1,2}$/.test(t)&&new RegExp('^'+t.replaceAll('X','[0-9]')+'$').test(c));
  if(!from.codes.length||!from.codes.every(contains))return null;
  identity=true;
 }else if(to.ordinal&&from.ordinal===to.ordinal)identity=true;
 if(!identity)return null;
 const broader=from.qualifiers.length>to.qualifiers.length || to.codes.length>from.codes.length || from.codes.length>0&&!to.codes.length || from.codes.some(c=>!to.codes.includes(c))&&to.codes.length>0;
 return broader?'specific_generation_to_broader_native':null;
}
