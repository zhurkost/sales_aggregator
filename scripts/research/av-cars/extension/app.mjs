import {API,parseHar,importRecords,newState,crawl,resultFiles,stats} from './core.mjs';
import {readCheckpoint} from './checkpoint.mjs';
const $=id=>document.getElementById(id);
const speedKey='avResearchDelayMs';
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
let headers=null,running=false,stop=false,controller=null,state=newState();
const [schema,binding]=await Promise.all(['seed-schema.json','seed-binding.json'].map(n=>fetch(chrome.runtime.getURL(n)).then(r=>r.json())));
const saved=await chrome.storage.local.get('avResearch');
if(saved.avResearch?.version===1&&saved.avResearch.platform==='av')state=saved.avResearch;
let sessionStarted=0,sessionRequests=0,lastLog=null;
const draw=message=>{
  $('status').textContent=message+'\n\n'+JSON.stringify({...stats(state),...(running?{requestsPerSecond:Math.round((state.requests-sessionRequests)/Math.max(1,(Date.now()-sessionStarted)/1000)*100)/100}:{})},null,2);
  $('export').disabled=!Object.keys(state.fields).length;
  $('activity').textContent=(state.activity||[]).slice(-30).map(e=>`${e.at} · ${e.brand||'—'} / ${e.model||'—'} · ${e.stage}`).join('\n')||'Журнал пока пуст.';
  const entry=state.activity?.at(-1);if(entry&&entry!==lastLog){console.info('[AV]',entry.at,entry.brand,entry.model,entry.stage);lastLog=entry;}
};
draw('Готов. Сетевых запросов к av.by ещё не было.');
const save=async value=>chrome.storage.local.set({avResearch:value});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let lastRequest=0;
async function request(method,body){
  if(!running||stop)throw Error('Остановлено пользователем');
  if(!['GET','POST'].includes(method))throw Error('Метод запрещён');
  await pause(Math.max(0,requestDelayMs-(Date.now()-lastRequest)));
  if(stop)throw Error('Остановлено пользователем');
  controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),45000);
  lastRequest=Date.now();
  try {
    const response=await fetch(method==='GET'?API:API+'/update',{method,headers:{...headers,'Content-Type':'application/json','Accept':'application/json'},body:method==='POST'?JSON.stringify(body):undefined,credentials:'omit',redirect:'error',signal:controller.signal});
    if(!response.ok)throw Error('HTTP '+response.status+'. Автоматических повторов нет; сохрани результат и сообщи код.');
    if(!response.headers.get('content-type')?.includes('json'))throw Error('Вместо JSON получена страница/проверка доступа.');
    return await response.json();
  } catch(e) {
    if(e.name==='AbortError')throw Error(stop?'Остановлено пользователем':'Истёк таймаут запроса. Можно продолжить позже.');
    if(e instanceof TypeError)throw Error('Сетевая ошибка / доступ запрещён. Запрос не повторялся.');
    throw e;
  } finally {clearTimeout(timeout);controller=null;}
}
$('har').addEventListener('change',async()=>{
  if(running)return;
  await navigator.locks.request('av-catalog-crawler',{ifAvailable:true},async lock=>{
  if(!lock){draw('Сбор AV уже работает в другой вкладке.');return;}
  try {
    const latest=(await chrome.storage.local.get('avResearch')).avResearch;if(latest)state=latest;
    const file=$('har').files[0];if(!file)return;
    const parsed=parseHar(JSON.parse(await file.text()));headers=parsed.headers;
    if(!headers['x-api-key'])throw Error('В HAR нет x-api-key исходных запросов. Не отправляй ключ в чат; нужен локальный HAR рабочего браузера.');
    if(!state.brands.length)state=importRecords(parsed.records);
    await save(state);$('source').textContent='HAR прочитан локально. Ключ остаётся только в памяти этой вкладки.';$('start').disabled=false;
    draw('Можно начать полный обход или продолжить контрольную точку.');
  }catch(e){headers=null;$('start').disabled=true;draw(e.message);}
  });
});
$('checkpoint').addEventListener('change',async()=>{
  if(running)return;
  await navigator.locks.request('av-catalog-crawler',{ifAvailable:true},async lock=>{
    if(!lock){draw('Сначала останови сбор AV в другой вкладке.');return;}
    try{
      const file=$('checkpoint').files[0];if(!file)return;
      const restored=readCheckpoint(JSON.parse((await file.text()).replace(/^\uFEFF/,'')),'av');
      const latest=(await chrome.storage.local.get('avResearch')).avResearch;
      if((latest?.requests||0)>restored.requests)throw Error('В хранилище более новый прогресс. Старый файл не загружен.');
      await save(restored);state=restored;draw('Прогресс восстановлен. Выбери HAR для ключа доступа, затем продолжи.');
    }catch(e){draw(e.message);}
  });
});
$('start').addEventListener('click',async()=>{
  if(running||!headers)return;
  await navigator.locks.request('av-catalog-crawler',{ifAvailable:true},async lock=>{
  if(!lock){draw('Сбор AV уже работает в другой вкладке.');return;}
  const latest=(await chrome.storage.local.get('avResearch')).avResearch;if(latest)state=latest;
  sessionStarted=Date.now();sessionRequests=state.requests;
  running=true;stop=false;$('start').disabled=true;$('har').disabled=true;$('checkpoint').disabled=true;$('stop').disabled=false;
  try {await crawl({state,request,save,progress:s=>draw('Сбор выполняется.'+(s.lastCompleted?' Завершено: '+s.lastCompleted:'')),stopped:()=>stop});draw('Сбор завершён без модификаций. Скачай результат.');}
  catch(e){draw(e.message);}
  finally {running=false;$('start').disabled=false;$('har').disabled=false;$('checkpoint').disabled=false;$('stop').disabled=true;}
  });
});
$('stop').addEventListener('click',()=>{stop=true;controller?.abort();$('stop').disabled=true;draw('Останавливаю и сохраняю состояние…');});
$('export').addEventListener('click',async()=>{
  if(!running){const latest=(await chrome.storage.local.get('avResearch')).avResearch;if(latest)state=latest;}
  const files=resultFiles(state,schema,binding);
  const blob=new Blob([JSON.stringify({format:'av-research-bundle-1',files},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='av-research-result.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
});
