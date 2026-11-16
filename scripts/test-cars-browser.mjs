import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {cp,mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {auditCabinet} from './test-cabinet-audit.mjs';
import {verifyCarAiChain} from './test-car-ai-chain-browser.mjs';
const root=path.resolve(import.meta.dirname,'..'),origin='http://localhost:5173';
const output=path.join(root,'work/cars-browser-tests');await mkdir(output,{recursive:true});const scratch=await mkdtemp(path.join(output,'run-'));
const socket=createServer().listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
const runtime=spawnSync('java',['-XshowSettings:properties','-version'],{encoding:'utf8',windowsHide:true}),javaHome=runtime.stderr.match(/java\.home\s*=\s*([^\r\n]+)/)[1].trim();
const api=spawn(path.join(javaHome,'bin',process.platform==='win32'?'java.exe':'java'),['-jar',path.join(root,'backend/target/autopost-api.jar')],{cwd:root,windowsHide:true,env:{...process.env,PORT:String(port),DATA_DIR:scratch,PUBLIC_ORIGIN:origin,CATEGORY_REFERENCE_DIR:path.join(root,'data/rental'),AI_API_KEY:'',DADATA_API_KEY:'',VPS_PROXY_SECRET:''},stdio:['ignore','pipe','pipe']});
let log='',browser,closing=false;api.stdout.on('data',b=>log+=b);api.stderr.on('data',b=>log+=b);
async function until(check,message,ms=30000){const end=Date.now()+ms;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,150));}throw Error(message);}
const results=[],blockedExternal=[];
try{
 await until(()=>fetch(`http://127.0.0.1:${port}/healthz`).then(r=>r.ok).catch(()=>false),'Backend startup');
 // Chrome can start an extension-created navigation before Playwright attaches its routes.
 // Test-only copy holds those tabs at about:blank; navigate after interception is attached.
 const extension=path.join(scratch,'extension');await cp(path.join(root,'extension'),extension,{recursive:true});
 const background=path.join(extension,'rental-background.js');await writeFile(background,(await readFile(background,'utf8')).replaceAll('url: j.recipe.startUrl','url: "about:blank"'));
 browser=await chromium.launchPersistentContext(path.join(scratch,'chrome'),{channel:'chromium',headless:true,viewport:{width:1400,height:1000},args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
 await browser.route('**/*',route=>{blockedExternal.push(route.request().url());return route.abort('blockedbyclient');});
 await browser.route(origin+'/**',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname.startsWith('/api/'))return route.fulfill({response:await browser.request.fetch(`http://127.0.0.1:${port}`+u.pathname+u.search,{method:route.request().method(),headers:route.request().headers(),data:route.request().postDataBuffer()??undefined})});
  const file=path.resolve(root,'dist-angular/browser','.'+(u.pathname==='/'?'/index.html':u.pathname));assert(file.startsWith(path.join(root,'dist-angular/browser')+path.sep));
  return route.fulfill({body:await readFile(file),contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'application/octet-stream'});
 });
 // These are deterministic local fixtures. No marketplace HTTP request or publication is made.
 const fixture=`<!doctype html><html><body><div class="vehicle-form"><label><input type="radio" name="manufacturer" value="32">Kia</label><label><input type="radio" name="manufacturer" value="8">BMW</label><div id="models"></div></div><button id="submit">Опубликовать</button><script>window.submissions=0;document.querySelector('#submit').onclick=()=>window.submissions++;document.querySelector('input[value="32"]').onchange=()=>document.querySelector('#models').innerHTML='<label><input type="radio" name="model" value="884">Rio</label>';</script></body></html>`;
 for(const host of ['https://ab.onliner.by','https://www.kufar.by','https://av.by','https://abw.by'])await browser.route(host+'/**',route=>route.fulfill({body:fixture,contentType:'text/html'}));
 const page=await browser.newPage();page.on('pageerror',e=>console.log('PAGE ERROR',e.message));page.on('response',async r=>{if(r.status()>=400&&r.url().startsWith(origin+'/api/')){const body=await r.text().catch(()=>'<response closed>');if(!closing)console.log(r.status(),r.url(),body);}});await page.goto(origin);
 await page.getByLabel('Логин',{exact:true}).fill('cars-browser-qa');await page.getByLabel('Пароль',{exact:true}).fill('Disposable-test-825');await page.getByLabel('Имя профиля',{exact:true}).fill('Авто тест');await page.getByRole('button',{name:'Создать и войти'}).click();
 await page.getByRole('button',{name:'Автомобили',exact:true}).click();await page.getByRole('heading',{name:'Продажа легкового автомобиля'}).waitFor();assert(await page.getByRole('tab',{name:'Легковые'}).isVisible());
 await page.waitForTimeout(1500);await writeFile(path.join(output,'editor-diagnostic.txt'),await page.locator('body').innerText());
 await until(()=>page.getByLabel('Марка',{exact:true}).isEnabled(),'Editor ready');
 const select=async(label,name)=>{await page.getByRole('combobox',{name:label,exact:true}).fill(name);await page.getByRole('listbox',{name:label,exact:true}).getByRole('option',{name,exact:true}).click();};
 await page.getByRole('combobox',{name:'Марка',exact:true}).click();await until(()=>page.getByRole('listbox',{name:'Марка',exact:true}).getByRole('option').count().then(n=>n===201),'Initial choices');
 await page.getByRole('listbox',{name:'Марка',exact:true}).evaluate(e=>{e.scrollTop=e.scrollHeight;});await until(()=>page.getByRole('listbox',{name:'Марка',exact:true}).getByRole('option').count().then(n=>n>201),'Scroll pagination');
 await select('Марка','Kia');await select('Модель','Rio');await select('Поколение','IV Рестайлинг');
 await select('Марка','BMW');assert.equal(await page.getByRole('combobox',{name:'Модель',exact:true}).inputValue(),'');assert(await page.getByRole('combobox',{name:'Поколение',exact:true}).isDisabled());
 await select('Модель','2 серия');await page.getByRole('combobox',{name:'Поколение',exact:true}).click();
 const generationList=page.getByRole('listbox',{name:'Поколение',exact:true});await generationList.getByRole('option',{name:'F74 / F78 Gran Coupe',exact:true}).waitFor();
 const labels=await generationList.getByRole('option').allTextContents();assert(labels.includes('F44 Gran Coupe'));assert(!labels.includes('F44'));assert(!labels.includes('(F44) Gran Coupe'));assert(!labels.includes('F74-78'));await page.getByLabel('Цена',{exact:true}).click();
 await select('Марка','Audi');await select('Модель','A2');await select('Поколение','I (8Z)');results.push('BMW bracket/dash aliases have one choice; Audi A2 exposes a real generation instead of its model name');
 await select('Марка','Kia');await page.getByRole('combobox',{name:'Модель',exact:true}).fill('Rio');await page.getByRole('option',{name:'Rio',exact:true}).waitFor();
 await page.getByRole('combobox',{name:'Модель',exact:true}).press('ArrowDown');await page.getByRole('combobox',{name:'Модель',exact:true}).press('ArrowDown');await page.getByRole('combobox',{name:'Модель',exact:true}).press('Enter');assert.equal(await page.getByRole('combobox',{name:'Модель',exact:true}).inputValue(),'Rio');
 await page.getByRole('combobox',{name:'Марка',exact:true}).fill('no-such-car-qa');await page.getByText('Ничего не найдено',{exact:true}).waitFor();await page.getByLabel('Цена',{exact:true}).click();assert.equal(await page.getByRole('combobox',{name:'Марка',exact:true}).inputValue(),'Kia');
 assert.equal(await page.getByRole('combobox',{name:'Модель',exact:true}).inputValue(),'Rio');results.push('Single searchable field, scroll pagination, keyboard selection, parent reset and cancelled search');
 await select('Год выпуска','2020');await page.getByLabel('Цена',{exact:true}).fill('24500');await select('Валюта','BYN');
 const capacity=page.getByLabel('Объём двигателя, л',{exact:true});await capacity.fill('1.5');await capacity.press('ArrowUp');assert.equal(await capacity.inputValue(),'1.6');await capacity.press('ArrowDown');assert.equal(await capacity.inputValue(),'1.5');
 await select('Цвет кузова','Серебристый');await select('Количество мест','5');await select('Материал салона','Натуральная кожа');results.push('Engine capacity changes by 0.1; normalized flat choices are selectable');
 await page.getByLabel('Пробег, км',{exact:true}).fill('65000');await page.getByLabel('Описание',{exact:true}).fill('Тест автомобиля Kia Rio. Не публиковать.');
 await page.getByRole('button',{name:'Проверить карточку',exact:true}).click();await page.getByRole('heading',{name:'Проверка переноса'}).waitFor();results.push('Real UI, authenticated API, canonical brand/model and native mappings');
 await page.getByRole('button',{name:'Недвижимость',exact:true}).click();await page.getByRole('tab',{name:'Аренда квартир',exact:true}).waitFor({state:'visible'});await page.getByRole('button',{name:'Автомобили',exact:true}).click();assert.equal(await page.getByLabel('Цена',{exact:true}).inputValue(),'24500');results.push('Section switch preserves in-memory car card and existing real-estate tabs');
 await page.screenshot({path:path.join(output,'cars-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert(await page.getByRole('button',{name:'Опубликовать',exact:true}).isVisible());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,'cars-mobile.png'),fullPage:true});await page.setViewportSize({width:1400,height:1000});
 const chooserReady=page.waitForEvent('filechooser');await page.getByRole('button',{name:'＋ Фото',exact:true}).click();const chooser=await chooserReady;assert(chooser.isMultiple());await chooser.setFiles([]);results.push('Real-estate style photo button opens multi-file chooser');
 // Only the external AI answers are fixtures; the editor, upload conversion and options API are real.
 let photoCalls=0,textCalls=0;
 const carData=JSON.parse(await readFile(path.join(root,'data/automotive/cars_used_sale/runtime.json'),'utf8'));
 const transmissions=Object.values(carData.nodes).filter(n=>n.field==='car.transmission').slice(0,2);
 const recognized='Продаётся Kia Rio в кузове седан, белого цвета. Коробка передач по фото не определяется.';
 const candidates={'car.transmission':transmissions.map(n=>n.id)},candidateEvidence={'car.transmission':'По фото возможны несколько коробок.'};
 await page.route(origin+'/api/workspace/categories/cars_used_sale/recognize-photos',async route=>{
  photoCalls++;const body=route.request().postDataJSON();assert.equal(body.images.length,6);assert(body.images.every(p=>p.startsWith('data:image/jpeg;base64,')));
  await route.fulfill({json:{text:recognized,candidates,candidateEvidence,warnings:[],collage:{photoCount:6,bytes:12000,width:1536,height:1024}}});
 });
 await page.route(origin+'/api/workspace/categories/cars_used_sale/analyze',async route=>{
  textCalls++;const body=route.request().postDataJSON();assert.equal(body.description,'Мой автомобиль, цена 24500 BYN.');assert.equal(body.recognizedText,recognized);assert(!body.images);
  await route.fulfill({json:{values:{'car.price':999,'car.mileage':1},evidence:{'car.price':'test','car.mileage':'test'},candidates,candidateEvidence,warnings:[]}});
 });
 assert.equal(await page.getByRole('button',{name:'Распознать с ИИ',exact:true}).count(),0);
 const picture=await page.screenshot();await page.locator('app-car-editor input[type=file]').setInputFiles(Array.from({length:7},(_,i)=>({name:'fixture-'+i+'.png',mimeType:'image/png',buffer:picture})));
 await until(()=>page.locator('app-car-editor .photos img').count().then(n=>n===7),'Seven photos optimized');
 await page.getByLabel('Расскажите об автомобиле',{exact:true}).fill('Мой автомобиль, цена 24500 BYN.');
 await page.getByRole('button',{name:'Распознать с ИИ',exact:true}).click();
 await until(async()=>textCalls===1&&await page.getByRole('button',{name:'Заполнить с ИИ',exact:true}).isEnabled(),'Photo automatically filled fields');
 await until(()=>page.getByLabel('Распознано ИИ',{exact:true}).inputValue().then(v=>v===recognized),'Photo recognition text');
 await page.getByRole('combobox',{name:'Коробка передач',exact:true}).click();
 await until(()=>page.getByRole('listbox',{name:'Коробка передач',exact:true}).getByRole('option').count().then(n=>n===3),'Two candidates plus empty choice');
 await page.getByLabel('Распознано ИИ',{exact:true}).click();
 assert.equal(textCalls,1);
 await page.getByRole('button',{name:'Все варианты',exact:true}).waitFor();
 assert.equal(await page.getByLabel('Цена',{exact:true}).inputValue(),'24500');assert.equal(await page.getByLabel('Пробег, км',{exact:true}).inputValue(),'65000');
 assert.equal(await page.getByRole('combobox',{name:'Коробка передач',exact:true}).inputValue(),'');
 await page.screenshot({path:path.join(output,'cars-photo-recognition.png'),fullPage:true});
 await page.getByRole('button',{name:'Все варианты',exact:true}).click();await page.getByRole('combobox',{name:'Коробка передач',exact:true}).click();
 await until(()=>page.getByRole('listbox',{name:'Коробка передач',exact:true}).getByRole('option').count().then(n=>n>3),'All transmissions restored');
 await page.getByLabel('Распознано ИИ',{exact:true}).click();assert.equal(photoCalls,1);assert.equal(textCalls,1);
 results.push('Seven photos → first six sent once; separate editable AI text; automatic combined text call; candidate filtering, reset and manual value preservation');
 if(process.argv.includes('--audit'))results.push(...await auditCabinet({page,browser,origin,until,output,picture}));
 const aiCaseFile=process.argv.find(a=>a.startsWith('--ai-chain='))?.slice('--ai-chain='.length);
 if(aiCaseFile)results.push(...await verifyCarAiChain({page,origin,until,output,runtime:carData,caseFile:aiCaseFile,photoDirectory:process.argv.find(a=>a.startsWith('--photo-directory='))?.slice('--photo-directory='.length)}));
 if(!process.argv.includes('--editor-only')){
 for(const name of ['Kufar','AV.by','ABW'])await page.getByLabel(name,{exact:true}).uncheck();
 const previousPages=new Set(browser.pages());await page.getByRole('button',{name:'Опубликовать',exact:true}).click();
 await until(()=>Promise.resolve(browser.pages().some(p=>!previousPages.has(p))),'Extension opened Onliner');const site=browser.pages().find(p=>!previousPages.has(p));await site.goto('https://ab.onliner.by/create');await site.bringToFront();
 await until(()=>site.locator('input[name=manufacturer]:checked').count().then(n=>n===1),'Brand transferred');await until(()=>site.locator('input[name=model]:checked').count().then(n=>n===1),'Model transferred');assert.equal(await site.locator('input[name=model]:checked').inputValue(),'884');assert.equal(await site.evaluate(()=>window.submissions),0);results.push('Real extension fills native 32→884 in isolated fixture; no submit');
 await site.reload();await site.waitForTimeout(1200);assert.equal(await site.locator('input[name=manufacturer]:checked').count(),0);results.push('Browser reload does not refill');
 }
 await page.bringToFront();await page.reload();await page.getByRole('heading',{name:'Продажа легкового автомобиля'}).waitFor();assert.equal(await page.getByLabel('Цена',{exact:true}).inputValue(),'');await until(()=>page.getByRole('combobox',{name:'Марка',exact:true}).isEnabled(),'Reloaded editor ready');results.push('Reload restores Cars section, not stale card values');
 await writeFile(path.join(output,'result.json'),JSON.stringify({passed:results,liveMarketplaces:false,blockedExternal},null,2));console.log(JSON.stringify(results,null,2));
}catch(e){if(browser){for(const p of browser.pages().filter(p=>p.url().startsWith(origin))){await writeFile(path.join(output,'app-failure.html'),await p.content());await p.screenshot({path:path.join(output,'app-failure.png')});console.log('Combobox diagnostic',await p.getByRole('combobox').allTextContents(),'options',await p.getByRole('option').count(),'listboxes',await p.getByRole('listbox').count());}const worker=browser.serviceWorkers()[0];if(worker)await writeFile(path.join(output,'extension-diagnostic.json'),JSON.stringify(await worker.evaluate(()=>chrome.storage.session.get(null)),null,2));for(const p of browser.pages().filter(p=>p.url().startsWith('https://ab.onliner.by/'))){await writeFile(path.join(output,'onliner-fixture.html'),await p.content());await p.screenshot({path:path.join(output,'onliner-fixture.png')});}}throw e;
}finally{closing=true;await writeFile(path.join(scratch,'server.log'),log);await browser?.unrouteAll({behavior:'ignoreErrors'});await browser?.close();api.kill();}
