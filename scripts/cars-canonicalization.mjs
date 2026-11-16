// Build-time equivalence rules only. Never fuzzy-match user input or native IDs.
export const normalize = s => s.normalize('NFKC').trim().toLowerCase().replaceAll('ё','е').replace(/\s*[·]\s*/g,' ').replace(/\s+/g,' ');

export function brandName(name) {
  const aliases={'lada (ваз)':'LADA','ваз':'LADA','im motors (zhiji)':'IM Motors','ciimo (dongfeng-honda)':'Ciimo','lingxi (dongfeng-honda)':'Lingxi'};
  return aliases[normalize(name)]||name;
}

export function isModelGeneration(name, modelNames) {
  // A model called I/X may still genuinely have generation I/X; do not filter ordinals.
  if(/^(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|XVII|XVIII|XIX|XX)$/i.test(name.trim()))return false;
  return modelNames.some(model=>normalize(model)===normalize(name));
}

export function modelName(brand, name) {
  let n=name.trim().replace(/\s+/g,' ');
  if(normalize(brand)==='bmw') n=n.replace(/^(\d)\s+(?:серии|серия|series)/i,'$1 серия').replace(/Grand Tourer/i,'Gran Tourer');
  if(normalize(brand)==='mercedes-benz') {
    n=n.replace(/[- ](?:класс|klasse|class)(?=\s|$)/ig,'');
    // These model families are conventionally displayed with «Класс»; AMG stays distinct.
    n=n.replace(/^(A|B|C|E|G|M|R|S|T|V|X)(?=\s|$)/,'$1-Класс');
  }
  const aliases={
    'suzuki':{'xl-7':'XL7'},
    'газ':{'12 (зим)':'12 Зим','13 "чайка"':'13 «чайка»','14 "чайка"':'14 «чайка»'},
    'заз':{'1102 таврия':'1102 «Таврия»','1105 дана':'1105 «Дана»'},
    'audi':{'q4 sportback e-tron':'Q4 e-tron Sportback'},
    'hyundai':{'s coupe':'Scoupe','s-coupe':'Scoupe'},
    'kia':{"cee'd":'Ceed',"cee'd gt":'Ceed GT'},
    'lamborghini':{'huracán':'Huracan'},
    'cadillac':{'brogham':'Brougham'},
    'dongfeng':{'eπ008':'EP008'},
    'kaiyi':{'x7 (kunlun)':'X7 Kunlun'},
    'mitsubishi':{'ek-space':'eK Space'},
    'rimac':{'concept_one':'Concept One'},
    'volkswagen':{'karmann ghia':'Karmann-Ghia'},
  };
  // Source labels explicitly name the same model plus its alternate factory name/code.
  const named={
    chery:{'Amulet (A15)':'Amulet','CrossEastar (B14)':'CrossEastar','CrossEastar B14':'CrossEastar','Fora (A21)':'Fora','IndiS (S18D)':'IndiS','Kimo (A1)':'Kimo','M11 (A3)':'M11','QQ6 (S21)':'QQ6','Tiggo (T11)':'Tiggo','Very (A13)':'Very','eQ5 (S61)':'eQ5'},
    geely:{'CK (Otaka)':'CK','FC (Vision)':'FC','LC (Panda)':'LC','LC (Panda) Cross':'LC Cross','Monjaro (KX11)':'Monjaro'},
    'great wall':{'Cowry (V80)':'Cowry','Voleex C10 (Phenom)':'Voleex C10'},
    haval:{'DaGou (Big Dog)':'DaGou'},hyundai:{'H-1(Starex)':'H-1'},
    jac:{'J2 (Yueyue)':'J2','J5 (Heyue)':'J5','J7 (Binyue)':'J7','S5 (Eagle)':'S5'},
    lifan:{'Breez (520)':'Breez','Cebrium (720)':'Cebrium','Celliya (530)':'Celliya','Murman (820)':'Murman'},
    mini:{'Cooper SE (Electric)':'Cooper SE'},ora:{'Good Cat (03)':'Good Cat','Good Cat (03) GT':'Good Cat GT'},
    proton:{'Wira (400 Series)':'Wira'},voyah:{'Passion (Chasing Light)':'Passion'},
  };
  const explicit=Object.entries(named[normalize(brand)]||{}).find(([from])=>normalize(from)===normalize(n));
  if(explicit)return explicit[1];
  return aliases[normalize(brand)]?.[normalize(n)]||n;
}

export function generationName(brand, model, name) {
  let n=name.trim().replace(/\s*[·]\s*/g,' ').replace(/\s+/g,' ')
    .replace(/\((рестайлинг(?:\s+\d+)?)\)/ig,'$1')
    .replace(/(\d+)[- ]?(?:й|ый)\s+рестайлинг/ig,'Рестайлинг $1')
    .replace(/рестайлинг\s*1\b/ig,'Рестайлинг')
    .replace(/^\(([IVX]+)\)(?=\s|$)/,'$1');
  const ordinals=['','I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX'];
  n=n.replace(/^(\d+)(?:-е)?\s+поколение(?=\s|$)/i,(all,num)=>ordinals[+num]||all)
    .replace(/Gran Turismo|\(GT\)/ig,'GT');
  // Reviewed Rio chassis aliases. Global-market variants and X/X-Line are separate.
  if(normalize(brand)==='kia') {
    const codes={rio:{DC:'I',JB:'II',QB:'III',FB:'IV'},ceed:{ED:'I',JD:'II',CD:'III'},sportage:{JA:'I',KM:'II',SL:'III',QL:'IV',NQ5:'V'}}[normalize(model)]||{};
    n=n.replace(/^\(([A-Z0-9]+)\)/,(all,code)=>codes[code]||all);
  }
  return n;
}

// Parse explicit code tokens; family notation is resolved later, inside the same model/state.
function codes(text) {
  let t=text.replace(/^\((.*)\)$/,'$1').replace(/([A-Za-z])\s+(\d)/g,'$1$2').toUpperCase();
  // These catalogue labels enumerate endpoints, not every number between them.
  // F74-78, F74–F78 and F74, 78 all name F74/F78; never invent F75/F76/F77.
  t=t.replace(/\b([A-Z]+\d+)\s*[-–—]\s*([A-Z]*\d+)\b/g,'$1/$2');
  const parts=t.split(/\s*[,/]\s*/);
  const prefix=parts[0]?.match(/^([A-Z]+)\d/);if(prefix)for(let i=1;i<parts.length;i++)if(/^\d{1,3}$/.test(parts[i]))parts[i]=prefix[1]+parts[i];
  if(!parts.length||parts.some(p=>!(/^(?:[A-Z]{1,4}\d+[A-Z]?|\d{1,3}[A-Z]{1,3}|[A-Z]{2,4}|\d{1,3})$/).test(p)))return null;
  return [...new Set(parts)].sort().join('/');
}
function signature(name) {
  const rest=name.match(/\s+Рестайлинг(?:\s+(\d+))?$/i);
  const state=rest?(rest[1]||'1'):'0';
  let base=(rest?name.slice(0,rest.index):name).trim();
  const qualifier=base.match(/\s+\(?(Gran Coup[eé]|Grand Coupe|Gran Turismo|GT|Coupe|Coupé|Cabriolet|Sedan|Touring|Hatchback)\)?$/i);if(qualifier)base=base.slice(0,qualifier.index);
  const body=qualifier?normalize(qualifier[1]).replace('grand coupe','gran coupe').replaceAll('é','e').replace('gran turismo','gt'):'';
  const roman=base.match(/^([IVX]+)(?:\s+(.+))?$/);
  if(roman)return {roman:roman[1],codes:roman[2]?codes(roman[2]):null,pure:!roman[2],state,body};
  return {codes:codes(base),state,body};
}

export function generationDisplay(rows, fallback) {
  const signatures=rows.map(r=>signature(r.name));
  const ordinals=new Set(signatures.map(s=>s.roman).filter(Boolean));
  const codeSets=new Set(signatures.map(s=>s.codes).filter(Boolean));
  const bodies=[...new Set(signatures.map(s=>s.body).filter(Boolean))];
  const bodySuffix=bodies.length===1?' '+({'gran coupe':'Gran Coupe',gt:'GT',coupe:'Coupe',cabriolet:'Cabriolet',sedan:'Sedan',touring:'Touring',hatchback:'Hatchback'}[bodies[0]]||bodies[0]):'';
  if(!ordinals.size&&signatures.every(s=>s.codes)){
    const codeList=[...new Set(signatures.flatMap(s=>s.codes.split('/')))].sort();
    const phase=signatures[0].state;
    return codeList.join(' / ')+bodySuffix+(phase==='0'?'':' Рестайлинг'+(phase==='1'?'':' '+phase));
  }
  if(ordinals.size===1&&codeSets.size===1&&signatures.every(s=>s.codes||s.pure)){
    const phase=signatures[0].state;
    return [...ordinals][0]+' ('+[...codeSets][0].split('/').join(' / ')+')'+bodySuffix+(phase==='0'?'':' Рестайлинг'+(phase==='1'?'':' '+phase));
  }
  if(ordinals.size===1&&codeSets.size>1){
    const [phase,qualifier]=signatures[0].state.split('/');
    return [...ordinals][0]+(qualifier?' '+qualifier:'')+(phase==='0'?'':' Рестайлинг'+(phase==='1'?'':' '+phase));
  }
  return fallback;
}

/** Group siblings, keeping restyling, market, body qualifiers and conflicting codes distinct. */
export function groupChoices(field, brand, model, rows) {
  for(const row of rows) {
    row.name=field==='brand'?brandName(row.name):field==='model'?modelName(brand,row.name):field==='generation'?generationName(brand,model,row.name):row.name;
  }
  const groups=new Map();
  for(const row of rows){
    // Whitespace is spelling; hyphens are meaningful (Saab 93 != 9-3).
    let key=normalize(row.name);
    if(field==='model')key=key.replace(/\s+/g,'');
    if(field==='generation')key=key.replace(/^\(([^()]+)\)(?=\s+рестайлинг|$)/,'$1').replace(/\s*([,/])\s*/g,'$1');
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
  }
  if(field!=='generation')return [...groups.values()];
  const entries=[...groups.values()], parent=entries.map((_,i)=>i);
  const root=i=>parent[i]===i?i:parent[i]=root(parent[i]);
  const unite=(a,b)=>{
    const ra=root(a),rb=root(b);if(ra===rb)return;
    const left=entries.flatMap((g,i)=>root(i)===ra?g:[]),right=entries.flatMap((g,i)=>root(i)===rb?g:[]);
    // Prefer a match inside one model, as requested, but contradictory ordinal numbers
    // still identify different generations (a chassis code may survive a generation change).
    const ordinals=new Set([...left,...right].map(x=>signature(x.name).roman).filter(Boolean));
    if(ordinals.size>1)return;
    const bodies=new Set([...left,...right].map(x=>signature(x.name).body).filter(Boolean));
    if(bodies.size>1)return;
    parent[rb]=ra;
  };
  const byCode=new Map(),byRoman=new Map();
  entries.forEach((g,i)=>{
    const s=signature(g[0].name);
    if(s.codes)for(const code of s.codes.split('/')){const k=s.state+'/'+code;if(!byCode.has(k))byCode.set(k,[]);byCode.get(k).push(i);}
    if(s.roman&&(s.codes||s.pure)){const k=s.state+'/'+s.roman;if(!byRoman.has(k))byRoman.set(k,[]);byRoman.get(k).push({i,...s});}
  });
  for(const items of byCode.values()){
    items.slice(1).forEach(i=>unite(items[0],i));
  }
  // Factory family notation: G2x covers G20/G21 within this model and restyling only.
  for(const [key,items]of byCode)if(/[A-Z]+\d+X$/.test(key)){
    const prefix=key.slice(0,-1);for(const [other,candidates]of byCode)if(other.length===key.length&&other.startsWith(prefix)&&/\d$/.test(other))for(const i of candidates)unite(items[0],i);
  }
  for(const items of byRoman.values()){
    // Same ordinal/restyling: sites may enumerate a whole generation or individual body codes.
    items.slice(1).forEach(s=>unite(items[0].i,s.i));
  }
  // When the entire model has only one numbered generation, a single remaining
  // chassis family in the same restyling state is its accepted equivalent.
  const allOrdinals=new Set(entries.flatMap(g=>g.map(r=>signature(r.name).roman)).filter(Boolean));
  if(allOrdinals.size===1){
    const byState=new Map();entries.forEach((g,i)=>{const sig=signature(g[0].name);if(!sig.codes&&!sig.pure)return;if(!byState.has(sig.state))byState.set(sig.state,new Set());byState.get(sig.state).add(root(i));});
    for(const roots of byState.values())if(roots.size===2){
      const [a,b]=[...roots],left=entries.flatMap((g,i)=>root(i)===a?g:[]).map(r=>signature(r.name)),right=entries.flatMap((g,i)=>root(i)===b?g:[]).map(r=>signature(r.name));
      if(left.every(s=>s.pure)&&right.every(s=>s.codes)||right.every(s=>s.pure)&&left.every(s=>s.codes))unite(a,b);
    }
  }
  const result=new Map();entries.forEach((g,i)=>{const key=root(i);if(!result.has(key))result.set(key,[]);result.get(key).push(...g);});
  return [...result.values()];
}
