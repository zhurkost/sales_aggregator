// Import only our versioned research checkpoint, not a raw HAR or form payload.
export function readCheckpoint(bundle,platform){
  if(!['av','abw'].includes(platform)||bundle?.format!==platform+'-research-bundle-1')throw Error('Это результат другого сборщика или неподдерживаемый формат.');
  const state=bundle.files?.[`evidence/${platform}-catalog-source.json`];
  if(state?.version!==1||state.platform!==platform||state.category_id!=='cars_used_sale')throw Error('Неподходящая контрольная точка.');
  for(const k of ['brands','regions','completedModels','issues'])if(!Array.isArray(state[k]))throw Error('Повреждена контрольная точка: '+k);
  if(!Number.isSafeInteger(state.requests)||state.requests<0||state.completedModels.some(v=>typeof v!=='string'))throw Error('Повреждены счётчики прогресса.');
  function nodes(list,regionRoot=false){for(const n of list){if(!n||typeof n.name!=='string'||(!['string','number'].includes(typeof n.value)&&!(regionRoot&&platform==='abw'&&n.value===null&&n.groupOnly===true))||!Array.isArray(n.children))throw Error('Повреждено дерево справочника.');nodes(n.children);}}
  nodes(state.brands);nodes(state.regions,true);
  const validCurrent=o=>o&&typeof o.stage==='string'&&[o.brand,o.model].every(v=>v===null||typeof v==='string');
  if(state.current&&!validCurrent(state.current))throw Error('Повреждена текущая позиция журнала.');
  if(state.activity&&(!Array.isArray(state.activity)||state.activity.length>100||state.activity.some(e=>!validCurrent(e)||typeof e.at!=='string')))throw Error('Повреждён журнал.');
  if(platform==='av'){
    if(!state.fields||typeof state.fields!=='object'||Array.isArray(state.fields)||!Array.isArray(state.variants)||!Array.isArray(state.completedRegions)||!Array.isArray(state.completedControls))throw Error('Повреждён checkpoint AV.');
    if(state.fields.year?.options?.length||state.fields.year?.constraints?.length)throw Error('Checkpoint содержит сохраняемые годы.');
    if(state.catalogCompletedModels&&(!Array.isArray(state.catalogCompletedModels)||state.catalogCompletedModels.some(v=>typeof v!=='string')))throw Error('Повреждён прогресс дерева.');
  }else if(!state.flat||typeof state.flat!=='object'||Array.isArray(state.flat)||!Array.isArray(state.observations))throw Error('Повреждён checkpoint ABW.');
  for(const o of state.variants||state.observations||[])if(o.context&&Object.hasOwn(o.context,'year'))throw Error('Checkpoint содержит сохраняемые годы.');
  return structuredClone(state);
}
