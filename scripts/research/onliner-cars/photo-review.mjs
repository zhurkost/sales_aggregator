// Research verifier only; deliberately not imported by the production extension.
// The caller reads the live DOM and waits for each server image to load.
export function verifyPhotos(state,expectedCount){
  const fail=reason=>({accepted:false,reason});
  if(!Number.isInteger(expectedCount)||expectedCount<0||expectedCount>50)return fail('Invalid expected collection size');
  if(state.containerCount!==1||state.counterCount!==1)return fail('Ambiguous/missing container or counter');
  if(!Array.isArray(state.cards)||state.cards.length!==expectedCount)return fail('Accepted card count differs');
  const text=String(state.counterText??'').replace(/\s+/g,' ').trim();
  const remaining=/^Осталось (\d+) фото$/i.exec(text);
  if(remaining){if(Number(remaining[1])!==50-expectedCount)return fail('Remaining capacity differs');}
  else if(expectedCount!==0||!/до 50 фотографий$/i.test(text))return fail('Unrecognised counter');
  for(const card of state.cards){
    if(card.imageCount!==1)return fail('Ambiguous/missing preview');
    // A single quoted CSS URL; none, gradients and multiple backgrounds fail.
    const m=/^url\((?:"([^"\r\n]*)"|'([^'\r\n]*)')\)$/.exec(card.backgroundImage??'');
    if(!m)return fail('Not a single CSS image URL');
    let u;try{u=new URL(m[1]??m[2]);}catch{return fail('Malformed image URL');}
    if(u.origin!=='https://content.onliner.by'||!u.pathname.startsWith('/automarket/')||u.username||u.password)return fail('Not an accepted server image');
    if(card.complete!==true||!(card.naturalWidth>0)||!(card.naturalHeight>0))return fail('Server image not loaded');
  }
  return {accepted:true,count:expectedCount};
}
