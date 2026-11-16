// Research-only model of the observed mixed control; no stored year dictionary.
export function planYear(value,candidates){
  if(!Number.isInteger(value))throw Error('Expected integer field value');
  const wanted=String(value);
  const matches=candidates.filter(c=>c.text.trim()===wanted);
  if(matches.length!==1)throw Error('Missing or ambiguous year');
  const c=matches[0];
  if(c.disabled||c.ownerDisabled)throw Error('Disabled year control');
  if(c.tag==='A')return {action:'click',expected:wanted};
  if(c.tag==='OPTION'&&c.value===wanted)return {action:'select_option',value:c.value,events:['input','change'],expected:wanted};
  throw Error('Unsupported candidate or mismatched native value');
}
export function verifyYear(value,selected){
  return selected.length===1&&selected[0].trim()===String(value);
}
