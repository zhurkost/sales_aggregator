import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

// Own application only. The caller blocks external traffic before creating this page.
export async function auditCabinet({page,browser,origin,until,output,picture}){
 const passed=[],failures=[];
 const check=async(name,action)=>{try{await action();passed.push(name);}catch(e){failures.push({name,error:e.message});}};
 const car=page.locator('app-car-editor'),source=car.getByLabel('Расскажите об автомобиле',{exact:true}),recognized=car.getByLabel('Распознано ИИ',{exact:true});
 const photoUrl=origin+'/api/workspace/categories/cars_used_sale/recognize-photos',textUrl=origin+'/api/workspace/categories/cars_used_sale/analyze';
 await page.unroute(photoUrl);await page.unroute(textUrl);
 const beforeText=await recognized.inputValue(),beforePrice=await car.getByLabel('Цена',{exact:true}).inputValue();
 await check('AI errors preserve photo text, photos, price and allow retry',async()=>{
  await page.route(photoUrl,r=>r.fulfill({status:502,json:{error:'Тест: сервис ИИ временно недоступен'}}));
  await car.getByRole('button',{name:'Распознать с ИИ',exact:true}).click();
  await car.getByRole('alert').waitFor();await until(()=>car.getByRole('button',{name:'Распознать с ИИ',exact:true}).isEnabled(),'Retry enabled');
  assert.equal(await recognized.inputValue(),beforeText);assert.equal(await car.locator('.photos img').count(),7);assert.equal(await car.getByLabel('Цена',{exact:true}).inputValue(),beforePrice);
  await page.unroute(photoUrl);
 });
 await check('Two rapid clicks cause one request; controls stay locked until completion',async()=>{
  let release,started=0;const gate=new Promise(r=>release=r);
  await page.route(photoUrl,async r=>{started++;await gate;await r.fulfill({json:{text:'Продаётся белый седан. Коробка передач по фото не определяется.',candidates:{},candidateEvidence:{},warnings:[],collage:{photoCount:6,bytes:1000,width:1536,height:1024}}});});
  const button=car.getByRole('button',{name:'Распознать с ИИ',exact:true});await button.click();await until(()=>Promise.resolve(started===1),'First AI request');
  assert(await button.isDisabled());assert(await car.getByRole('button',{name:'Заполнить с ИИ',exact:true}).isDisabled());assert(await recognized.isDisabled());assert(await source.isDisabled());assert(await car.getByRole('button',{name:'Удалить фото'}).first().isDisabled());
  await button.evaluate(el=>el.click());assert.equal(started,1);release();await until(()=>button.isEnabled(),'Recognition completed');await page.unroute(photoUrl);
  assert.equal(await car.getByRole('alert').count(),0);
 });
 await check('Removing a photo preserves manually edited recognition text',async()=>{
  await recognized.fill('Продаётся BMW 7 серии. Текст исправлен вручную.');await car.getByRole('button',{name:'Удалить фото'}).last().click();
  assert.equal(await car.locator('.photos img').count(),6);assert.equal(await recognized.inputValue(),'Продаётся BMW 7 серии. Текст исправлен вручную.');
 });
 await check('Photo count limit rejects extra photos without dropping the six existing ones',async()=>{
  await car.locator('input[type=file]').setInputFiles(Array.from({length:7},(_,i)=>({name:'overflow-'+i+'.png',mimeType:'image/png',buffer:picture})));
  await car.getByRole('alert').waitFor();assert.equal(await car.locator('.photos img').count(),6);assert((await car.getByRole('alert').innerText()).includes('12'));
 });
 await check('A failed options request can recover without leaving a stale error',async()=>{
  const url=origin+'/api/workspace/categories/cars_used_sale/options**';
  let fail=true;await page.route(url,route=>new URL(route.request().url()).searchParams.get('field')==='car.engine'&&fail?route.fulfill({status:503,json:{error:'Тест: список временно недоступен'}}):route.fallback());
  const combo=car.getByRole('combobox',{name:'Тип двигателя',exact:true});await combo.fill('бензин');
  await until(()=>car.getByRole('alert').allTextContents().then(s=>s.some(t=>t.includes('список временно'))),'Options error');
  fail=false;await combo.fill('дизель');await car.getByRole('listbox',{name:'Тип двигателя',exact:true}).getByRole('option',{name:'Дизель',exact:true}).waitFor();
  assert(!(await car.getByRole('alert').allTextContents()).some(t=>t.includes('список временно')),'Recovered list still displays the failure');
  await page.unroute(url);await source.click();
 });
 // Unroute even when a recovery assertion fails.
 await page.unroute(origin+'/api/workspace/categories/cars_used_sale/options**');await source.click();
 await check('Blank sources disable text analysis; photo-only text enables it',async()=>{
  await source.fill('  ');await recognized.fill('  ');assert(await car.getByRole('button',{name:'Заполнить с ИИ',exact:true}).isDisabled());
  await recognized.fill('Продаётся белый седан.');assert(await car.getByRole('button',{name:'Заполнить с ИИ',exact:true}).isEnabled());
 });
 await check('Failed text analysis retains both texts and all manually filled fields',async()=>{
  await source.fill('BMW 7 серии, данные для теста.');const original=await recognized.inputValue();
  await page.route(textUrl,r=>r.fulfill({status:502,json:{error:'Тест: анализ временно недоступен'}}));
  await car.getByRole('button',{name:'Заполнить с ИИ',exact:true}).click();await until(()=>car.getByRole('alert').allTextContents().then(s=>s.some(t=>t.includes('анализ временно'))),'Analysis failure');
  assert.equal(await source.inputValue(),'BMW 7 серии, данные для теста.');assert.equal(await recognized.inputValue(),original);assert.equal(await car.getByLabel('Цена',{exact:true}).inputValue(),beforePrice);
  await page.unroute(textUrl);
 });
 await check('No selected marketplaces disables both preparation and publishing',async()=>{
  for(const name of ['Kufar','Onliner','AV.by','ABW'])await car.getByRole('checkbox',{name,exact:true}).uncheck();
  assert(await car.getByRole('button',{name:'Проверить карточку',exact:true}).isDisabled());assert(await car.getByRole('button',{name:'Опубликовать',exact:true}).isDisabled());
  for(const name of ['Kufar','Onliner','AV.by','ABW'])await car.getByRole('checkbox',{name,exact:true}).check();
 });
 await check('Server rejects empty recognition input and unknown choices without external services',async()=>{
  const results=await page.evaluate(async()=>{
   const base='/api/workspace/categories/cars_used_sale/';const cases=[['recognize-photos',{images:[]}],['analyze',{description:'',recognizedText:''}],['prepare',{values:{'car.brand':'no-such-id'},platforms:['kufar'],extras:{}}]];
   const results=[];for(const [url,body] of cases){const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});results.push({url,status:r.status,body:await r.json()});}return results;
  });
  assert(results.every(r=>r.status===400),JSON.stringify(results));assert(results.every(r=>r.body.error));
 });
 await check('All four property tabs retain separate descriptions and support backend validation',async()=>{
  await page.getByRole('button',{name:'Недвижимость',exact:true}).click();
  const labels=['Аренда квартир','Продажа квартир','Аренда домов','Продажа домов'];
  for(const label of labels){
   await page.getByRole('tab',{name:label,exact:true}).click();const panel=page.getByRole('tabpanel',{name:label,exact:true});
   await panel.locator('textarea.source-description').fill('Тест '+label+': светлый объект, описание для проверки кабинета.');
   await panel.getByRole('button',{name:'Проверить карточку',exact:true}).click();await panel.getByRole('heading',{name:'Проверка карточки',exact:true}).waitFor();
  }
  for(const label of labels){await page.getByRole('tab',{name:label,exact:true}).click();assert((await page.getByRole('tabpanel',{name:label,exact:true}).locator('textarea.source-description').inputValue()).includes(label));}
  await page.getByRole('tab',{name:'Продажа домов',exact:true}).press('Home');assert.equal(await page.getByRole('tab',{name:'Аренда квартир',exact:true}).getAttribute('aria-selected'),'true');
  await page.getByRole('button',{name:'Автомобили',exact:true}).click();assert.equal(await car.getByLabel('Цена',{exact:true}).inputValue(),beforePrice);assert.equal(await car.locator('.photos img').count(),6);
 });
 await check('Narrow viewport keeps recognition controls and fields within the screen',async()=>{
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert(await car.getByRole('button',{name:'Распознать с ИИ',exact:true}).isVisible());
  await page.screenshot({path:path.join(output,'audit-mobile.png'),fullPage:true});await page.setViewportSize({width:1400,height:1000});
 });
 assert(browser.pages().every(p=>p.url()==='about:blank'||p.url().startsWith(origin)),'A marketplace page was opened');
 await writeFile(path.join(output,'audit.json'),JSON.stringify({passed,failures,marketplacePagesOpened:0},null,2));
 if(failures.length)throw Error('Cabinet audit failures: '+JSON.stringify(failures));
 return passed;
}
