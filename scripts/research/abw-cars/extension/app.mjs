import {createCheckpointWriter} from './checkpoint-writer.mjs';
import {API,readHar,importHar,newState,crawl,resultFiles,stats} from './core.mjs';
import {readCheckpoint} from './checkpoint.mjs';
const $=id=>document.getElementById(id);
const speedKey='abwResearchDelayMs';
const speedSaved=(await chrome.storage.local.get(speedKey))[speedKey];
let requestDelayMs=Number.isInteger(speedSaved)&&speedSaved>=0&&speedSaved<=60000?speedSaved:20;
$('delay').value=String(requestDelayMs);
$('delay').addEventListener('change',async()=>{
  const raw=$('delay').value.trim(),value=Number(raw);
  if(!raw||!Number.isInteger(value)||value<0||value>60000){
    $('delay').value=String(requestDelayMs);$('speed-status').textContent='Введите целое число от 0 до 60000 мс.';return;
  }
  requestDelayMs=value;
  try{await chrome.storage.local.set({[speedKey]:value});$('speed-status').textContent='Интервал сохранён: '+value+' мс. Применяется со следующего запроса.';}
  catch{ $('speed-status').textContent='Интервал применён, но не сохранён. Проверьте хранилище расширения.'; }
});
const ui=await fetch(chrome.runtime.getURL('ui.json')).then(r=>r.json());
const storageKey='abwResearchV1';
const saved=(await chrome.storage.local.get(storageKey))[storageKey];
let state=saved?.platform==='abw'&&saved.version===1?saved:newState();
let running=false,stop=false,lastRequest=0;
const controllers=new Set();let startQueue=Promise.resolve();
const workersKey='abwResearchConcurrency';
const savedWorkers=(await chrome.storage.local.get(workersKey))[workersKey];
let concurrency=Number.isInteger(savedWorkers)&&savedWorkers>=1&&savedWorkers<=5?savedWorkers:3;
$('workers').value=String(concurrency);
$('workers').addEventListener('change',async()=>{
  const value=Number($('workers').value);
  if(!Number.isInteger(value)||value<1||value>5){$('workers').value=String(concurrency);return;}
  concurrency=value;
  try{await chrome.storage.local.set({[workersKey]:value});$('speed-status').textContent='Число параллельных ветвей сохранено: '+value+'. Применяется при следующем запуске.';}
  catch{$('speed-status').textContent='Число ветвей применено, но настройка не сохранилась.';}
});
// This cache includes temporary years and must never enter storage/export.
const responseCache=new Map();
const checkpoint=createCheckpointWriter(async s=>{
  try{await chrome.storage.local.set({[storageKey]:s});}
  catch{throw Error('Не удалось сохранить прогресс. Данные остаются в этой вкладке: скачайте результат перед её закрытием.');}
});
const save=(s,options)=>checkpoint.save(s,options);
let sessionStarted=0,sessionRequests=0,lastLog=null;
const draw=message=>{
  $('status').textContent=message+'\n\n'+JSON.stringify({...stats(state),...(running?{requestsPerSecond:Math.round((state.requests-sessionRequests)/Math.max(1,(Date.now()-sessionStarted)/1000)*100)/100}:{})},null,2);$('start').disabled=running||!state.brands.length;
  $('activity').textContent=(state.activity||[]).slice(-30).map(e=>`${e.at} · ${e.brand||'—'} / ${e.model||'—'} · ${e.stage}`).join('\n')||'Журнал пока пуст.';
  const entry=state.activity?.at(-1);if(entry&&entry!==lastLog){console.info('[ABW]',entry.at,entry.brand,entry.model,entry.stage);lastLog=entry;}
};
draw('Готов. В статусе next указана следующая ветвь обычного продолжения. Запросы к ABW не отправлялись.');
async function request(raw){
  const url=new URL(raw);
  if(!running||stop||url.origin+url.pathname!==API||url.username||url.password||!url.searchParams.has('brand')||[...url.searchParams.keys()].some(key=>!['brand','model','year'].includes(key)))throw Error('Запрос запрещён');
  const turn=startQueue.then(async()=>{
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,requestDelayMs-(Date.now()-lastRequest))));
    if(stop)throw Error('Остановлено пользователем');
    lastRequest=Date.now();
  });
  startQueue=turn.catch(()=>{});await turn;
  if(stop)throw Error('Остановлено пользователем');
  const controller=new AbortController();controllers.add(controller);const timer=setTimeout(()=>controller.abort(),45000);
  try{
    const response=await fetch(url.href,{method:'GET',headers:{Accept:'application/json'},credentials:'omit',redirect:'error',signal:controller.signal});
    if(!response.ok)throw Error('HTTP '+response.status+'. Сохраните результат; автоматических повторов нет.');
    if(!response.headers.get('content-type')?.includes('json'))throw Error('Сервер не вернул JSON; обход остановлен.');
    try{return await response.json();}catch{throw Error('Ответ не является корректным JSON.');}
  }catch(e){
    if(e.name==='AbortError')throw Error(stop?'Остановлено пользователем':'Таймаут ответа ABW');
    if(e instanceof TypeError)throw Error('Сетевая ошибка или отказ доступа ABW.');
    throw e;
  }finally{clearTimeout(timer);controllers.delete(controller);}
}
async function restoreBundle(bundle){
  const restored=readCheckpoint(bundle,'abw');
  const latest=(await chrome.storage.local.get(storageKey))[storageKey];
  const base=checkpoint.dirty?state:(latest||state);
  if((base.requests||0)>restored.requests)throw Error('В хранилище более новый прогресс. Старый файл не загружен.');
  const restoredDone=new Set(restored.completedModels);
  if(base.completedModels.some(key=>!restoredDone.has(key)))throw Error('Файл потеряет часть уже завершённых моделей. Текущий прогресс сохранён; выберите более полный результат.');
  await save(restored);state=restored;responseCache.clear();
  $('source').textContent='Контрольная точка восстановлена: '+state.completedModels.length+' готовых моделей, '+state.requests+' запросов. HAR повторно не нужен.';
  draw('Прогресс восстановлен. Обычный обход пропускает готовые и ранее отмеченные проблемные модели. Следующая ветвь указана в next.');
}
$('har').addEventListener('change',async()=>{
  if(running)return;
  await navigator.locks.request('abw-catalog-crawler',{ifAvailable:true},async lock=>{
  if(!lock){draw('Нельзя менять исходные данные, пока сбор ABW идёт в другой вкладке.');return;}
  try{
    const file=$('har').files[0];if(!file)return;
    const latest=(await chrome.storage.local.get(storageKey))[storageKey];if(latest&&!checkpoint.dirty){if(latest.requests!==state.requests)responseCache.clear();state=latest;}
    const document=JSON.parse((await file.text()).replace(/^\uFEFF/,''));
    if(document.format){await restoreBundle(document);return;}
    const records=readHar(document);
    state=importHar(records,structuredClone(state));responseCache.clear();await save(state);
    $('source').textContent='HAR прочитан локально. Заголовки, фотографии, контакты и годы не сохраняются.';
    draw('HAR дополняет справочники, но сам не содержит прогресса обхода. Для переноса прогресса выберите abw-research-result.json. Текущие завершённые модели сохранены.');
  }catch(e){draw(e.message);}
  });
});
$('start').addEventListener('click',async()=>{
  if(running)return;
  await navigator.locks.request('abw-catalog-crawler',{ifAvailable:true},async lock=>{
    if(!lock){draw('Сбор ABW уже запущен в другой вкладке этого расширения.');return;}
    // Reload inside the lock so a second tab cannot overwrite newer checkpoints.
    const latest=(await chrome.storage.local.get(storageKey))[storageKey];if(latest&&!checkpoint.dirty){if(latest.requests!==state.requests)responseCache.clear();state=latest;}
    sessionStarted=Date.now();sessionRequests=state.requests;
    running=true;stop=false;$('start').disabled=true;$('har').disabled=true;$('checkpoint').disabled=true;$('retry-review').disabled=true;$('stop').disabled=false;
    try{await crawl({state,request,save,responseCache,concurrency,retryReview:$('retry-review').checked===true,stopped:()=>stop,progress:()=>draw('Обход выполняется.')});draw('Обход известных марок завершён. Полнота всей площадки пока не подтверждена.');}
    catch(e){draw(e.message);}
    finally{running=false;$('har').disabled=false;$('checkpoint').disabled=false;$('retry-review').disabled=false;$('stop').disabled=true;$('start').disabled=!state.brands.length;}
  });
});
$('checkpoint').addEventListener('change',async()=>{
  if(running)return;
  await navigator.locks.request('abw-catalog-crawler',{ifAvailable:true},async lock=>{
    if(!lock){draw('Сначала останови сбор ABW в другой вкладке.');return;}
    try{
      const file=$('checkpoint').files[0];if(!file)return;
      await restoreBundle(JSON.parse((await file.text()).replace(/^\uFEFF/,'')));
    }catch(e){draw(e.message);}
  });
});
$('stop').addEventListener('click',()=>{stop=true;for(const controller of controllers)controller.abort();$('stop').disabled=true;});
$('export').addEventListener('click',async()=>{
  if(!running&&!checkpoint.dirty){const latest=(await chrome.storage.local.get(storageKey))[storageKey];if(latest&&!checkpoint.dirty){if(latest.requests!==state.requests)responseCache.clear();state=latest;}}
  const bundle={format:'abw-research-bundle-1',files:resultFiles(structuredClone(state),ui)};
  const url=URL.createObjectURL(new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='abw-research-result.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
});
