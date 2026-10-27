import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import ts from 'typescript';
import {Window} from 'happy-dom';
import React,{act} from 'react';

// Render our own components in a synthetic DOM, without a browser or remote pages.
test('cards remain visible with cosmetic ad blocking and can be reopened, edited, archived and restored',async()=>{
 const window=new Window({url:'http://127.0.0.1:5173'});
 // EasyList's generic .ad-item rule hid the previous cabinet markup, including all controls.
 // Source: https://github.com/easylist/easylist/blob/master/easylist/easylist_general_hide.txt
 const blocker=window.document.createElement('style');blocker.textContent='.ad-item { display: none !important; }';window.document.head.append(blocker);
 const optimizedFiles=[];
 window.HTMLCanvasElement.prototype.getContext=()=>({drawImage(){}});
 window.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2Q==';
 const previous=new Map();
 for(const [key,value] of Object.entries({window,document:window.document,location:window.location,HTMLElement:window.HTMLElement,createImageBitmap:async(file)=>{optimizedFiles.push(file);return {width:200,height:100,close(){}};},IS_REACT_ACT_ENVIRONMENT:true})){
   previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 }
 const realFetch=globalThis.fetch;const stored=new Map();const requests=[];const notices=[];const messages=[];
 let contactSettings={phone:'+375291112233',city:'Брест'};
 globalThis.fetch=async(path,options={})=>{
   const body=options.body?JSON.parse(options.body):undefined;requests.push({path,body});
   if(path==='/api/ai-settings')return Response.json({serverConfigured:true});
   if(path==='/api/workspace/settings'){if(body)contactSettings={...contactSettings,...body};return Response.json({settings:contactSettings});}
   if(path==='/api/workspace/ads'){
     if(body){const ad={...body,revision:(stored.get(body.id)?.revision||0)+1,updatedAt:new Date().toISOString()};stored.set(ad.id,ad);return Response.json({ad});}
     return Response.json({ads:[...stored.values()].map(({photos,text,...r})=>({...r,photoCount:photos.length}))});
   }
   if(path.startsWith('/api/workspace/ads/')){
     const ad=stored.get(path.split('/').at(-1));return Response.json(ad?{ad}:{error:'Not found'},{status:ad?200:404});
   }
   if(path==='/api/analyze')return Response.json(body.task==='identify'?{identity:{status:'identified',name:'RX 570',query:'RX 570',terms:['RX 570'],kind:'product',condition:'Б/у'}}:body.task==='classify'?{candidates:[{id:'auto.parts.optics',confidence:.9,reason:'Фара — автомобильная оптика'}]}:{listing:{category:'parts',title:'Фара Passat',partName:'Фара',partNumber:'3G1941035D',description:'Есть царапина',currency:'BYN',price:'450',condition:'Б/у',priceUnit:'За штуку'}});
   throw new Error('Unexpected API '+path);
 };
 window.postMessage=message=>{messages.push(message);queueMicrotask(()=>window.dispatchEvent(new window.MessageEvent('message',{source:window,origin:window.location.origin,data:{source:'autopost-extension',type:'RESPONSE',requestId:message.requestId,payload:message.type==='PING'?{version:'0.6.0'}:message.type==='OPEN_JOB'&&message.payload.recordId==='existing-3'?{resumeToken:'test-ticket'}:message.type==='RESTORE_JOB'?{jobs:[{platformId:'onliner-parts',status:'opening',message:'Восстановлено'}]}:message.type==='PRICE_SEARCH'?{checkedAt:new Date().toISOString(),results:[{id:'kufar',name:'Kufar',url:'https://www.kufar.by/l',status:'ok',total:42,scanned:30,matched:12,groups:[{currency:'BYN',count:12,min:100,max:250,median:180}]}]}:{batches:[]}}})));};
 mkdirSync(new URL('../work/',import.meta.url),{recursive:true});
 const compile=name=>ts.transpileModule(readFileSync(new URL('../components/'+name+'.tsx',import.meta.url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/(from\s+["']\.\.\/lib\/[^"']+)(["'])/g,'$1.ts$2').replace(/(from\s+["']\.\/(?:price-comparison|category-attributes))(["'])/g,'$1.generated.mjs$2');
 for(const name of ['price-comparison','category-attributes'])writeFileSync(new URL('../work/'+name+'.generated.mjs',import.meta.url),compile(name));
 const code=compile('workspace-ui');
 const generated=new URL('../work/ui-test.generated.mjs',import.meta.url);writeFileSync(generated,code);
 const {Workspace}=await import(generated.href);const {createRoot}=await import('react-dom/client');
 const root=createRoot(window.document.body);
 const visible=(element)=>{
   for(let node=element;node;node=node.parentElement){const style=window.getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden')return false;}
   return element.isConnected;
 };
 const entries=()=>[...window.document.querySelectorAll('main article')];
 const click=async(label,scope=window.document)=>{const button=[...scope.querySelectorAll('button')].find(b=>b.textContent.trim()===label);assert.ok(button,'Button: '+label);assert.equal(button.disabled,false);assert.ok(visible(button),'Button must be visible: '+label);await act(async()=>{button.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));await new Promise(r=>setTimeout(r,15));});};
 const render=()=>root.render(React.createElement(Workspace,{profile:{id:'ui-profile',name:'Тест',login:'test'},onLogout(){},notify:s=>notices.push(s)}));
 try{
   await act(async()=>render());
   await click('Пример запчасти');await click('Определить категорию');
   assert.equal(stored.size,0,'classification alone does not prepare a listing');
   assert.match(window.document.body.textContent,/Фара — автомобильная оптика/);
   const routing=window.document.querySelector('[aria-label="Категории площадок"]');assert.ok(routing);assert.match(routing.textContent,/Куфар/);assert.match(routing.textContent,/Onlíner/);
   const correction=routing.querySelector('[aria-label="Категория Onlíner"]');
   await act(async()=>{correction.value='20';correction.dispatchEvent(new window.Event('change',{bubbles:true}));});
   await click('Подтвердить и продолжить');
   assert.equal([...stored.values()][0].categoryOverrides.onliner,'20');
   assert.equal([...stored.values()][0].categoryConfirmed,true);assert.equal([...stored.values()][0].listing.taxonomyId,'auto.parts.optics');
   assert.ok(requests.filter(r=>r.path==='/api/analyze').every(r=>!('photos'in r.body)));
   const original=[...stored.values()][0];
   assert.equal(original.listing.phone,'+375291112233','Profile phone fills absent AI result');
   assert.equal(original.listing.city,'Минск','Explicit seller city wins over profile default');
   for(let i=2;i<=4;i++)stored.set('existing-'+i,{...structuredClone(original),id:'existing-'+i,listing:{...original.listing,title:'Сохранённая фара '+i}});
   stored.get('existing-2').batchId='cabinet-batch-two';
   stored.get('existing-2').jobs=[{platformId:'kufar-parts',status:'manual_required',message:'Нужен шаг'},{platformId:'onliner-parts',status:'link_recorded',url:'https://baraholka.onliner.by/viewtopic.php?t=12345',message:'Ссылка сохранена'}];
   stored.get('existing-3').batchId='cabinet-batch-three';stored.get('existing-3').jobs=[{platformId:'onliner-parts',status:'manual_required',message:'Нужен шаг'}];
   stored.get('existing-4').jobs=[{platformId:'kufar-parts',status:'inactive',url:'https://www.kufar.by/item/987654',message:'Неактивно по отметке пользователя'}];
   await click('Мои объявления');assert.equal(entries().length,4);assert.ok(entries().every(visible),'All four saved cards must be visible');
   const secondRow=()=>entries().find(e=>e.textContent.includes('Сохранённая фара 2'));
   const beforeOpen=requests.length;
   await click(secondRow().querySelector('button.listing-channel-link').textContent.trim(),secondRow());
   assert.deepEqual(messages.find(m=>m.type==='OPEN_JOB').payload,{profileId:'ui-profile',batchId:'cabinet-batch-two',recordId:'existing-2',platformId:'kufar-parts'});
   assert.equal(entries().length,4,'Opening a marketplace keeps the cabinet visible');
   assert.equal(requests.slice(beforeOpen).some(r=>r.path==='/api/workspace/ads/existing-2'),false,'Live job opens without loading the card');
   const thirdRow=entries().find(e=>e.textContent.includes('Сохранённая фара 3'));
   await click(thirdRow.querySelector('button.listing-channel-link').textContent.trim(),thirdRow);
   const restored=messages.find(m=>m.type==='RESTORE_JOB');assert.equal(restored.payload.item.recordId,'existing-3');assert.deepEqual(restored.payload.item.platforms,[{id:'onliner-parts'}]);assert.equal(entries().length,4);
   await click('Обновить статусы',secondRow());
   assert.equal(messages.find(m=>m.type==='CHECK_STATUS').payload.items.length,1,'Only saved links are checked');
   assert.equal(messages.find(m=>m.type==='CHECK_STATUS').payload.items[0].recordId,'existing-2');
   await click('Обновить статусы всех активных');assert.equal(messages.filter(m=>m.type==='CHECK_STATUS').length,2);
   assert.equal(messages.filter(m=>m.type==='CHECK_STATUS').at(-1).payload.items.length,1,'Global check excludes locally inactive jobs');
   await click('Обновить статусы',entries().find(e=>e.textContent.includes('Сохранённая фара 4')));
   assert.equal(messages.filter(m=>m.type==='CHECK_STATUS').at(-1).payload.items[0].recordId,'existing-4','An individual inactive listing can still be checked');
   await act(async()=>{window.dispatchEvent(new window.MessageEvent('message',{source:window,origin:window.location.origin,data:{source:'autopost-extension',type:'REMOTE_STATUS',payload:{profileId:'ui-profile',recordId:'existing-2',platformId:'onliner-parts',url:stored.get('existing-2').jobs[1].url,receiptId:'receipt-test',remoteStatus:{state:'moderation',checkedAt:new Date().toISOString(),message:'Объявление на модерации'}}}}));await new Promise(resolve=>setTimeout(resolve,15));});
   assert.match(secondRow().textContent,/На модерации/);assert.equal(stored.get('existing-2').jobs[1].remoteStatus.state,'moderation');assert.ok(messages.some(m=>m.type==='ACK_RECEIPT'&&m.payload.receiptId==='receipt-test'));
   await act(async()=>{window.dispatchEvent(new window.MessageEvent('message',{source:window,origin:window.location.origin,data:{source:'autopost-extension',type:'PROGRESS',payload:{profileId:'ui-profile',recordId:'existing-2',batchId:'cabinet-batch-two',receiptId:'auto-link',jobs:[{platformId:'kufar-parts',status:'link_recorded',url:'https://www.kufar.by/item/123456',message:'Автоматически'}]}}}));await new Promise(resolve=>setTimeout(resolve,15));});
   assert.ok(secondRow().querySelector('a[href="https://www.kufar.by/item/123456"]'));assert.equal(stored.get('existing-2').jobs[1].remoteStatus.state,'moderation','Progress on one site preserves the checked status on another');
   const saved=entries().find(e=>e.textContent.includes('Сохранённая фара 2'));await click('Открыть карточку',saved);
   assert.ok(requests.some(r=>r.path==='/api/workspace/ads/existing-2'));
   assert.equal(window.document.querySelector('[aria-label="Категория Onlíner"]').value,'20');
   assert.match(window.document.body.textContent,/Подготовьте объявление/);
   // Change a real editor control, then navigate away to flush the save.
   const selectedPlatform=window.document.querySelector('.platform-card input[type=checkbox]');assert.ok(selectedPlatform);
   const previousPlatforms=stored.get('existing-2').selected.length;
   await act(async()=>selectedPlatform.click());await click('Мои объявления');
   assert.notEqual(stored.get('existing-2').selected.length,previousPlatforms,'Edits are persisted');
   await click('В архив кабинета',entries().find(e=>e.textContent.includes('Сохранённая фара 2')));
   assert.equal(entries().length,3);await click('Архив');assert.equal(entries().length,1);assert.ok(entries().every(visible));
   await click('Вернуть в работу',entries()[0]);await click('В работе');assert.equal(entries().length,4);
   // Simulate closing/reopening the app: every card is fetched from the profile again.
   await act(async()=>root.render(null));await act(async()=>render());await click('Мои объявления');
   assert.equal(entries().length,4);assert.ok(entries().every(visible));await click('Открыть карточку',entries()[0]);
   // A primary category change resets site corrections and previews every universal marketplace.
   const primary=window.document.querySelector('.category-search select');
   await act(async()=>{primary.value='computers.gpu';primary.dispatchEvent(new window.Event('change',{bubbles:true}));});
   const gpuRoutes=window.document.querySelector('[aria-label="Категории площадок"]');
   assert.equal(gpuRoutes.querySelectorAll('.routing-entry').length,3);
   assert.match(gpuRoutes.textContent,/Комплектующие → Видеокарты/);
   assert.match(gpuRoutes.textContent,/Flagma/);
   assert.equal(gpuRoutes.querySelector('[aria-label="Категория Onlíner"]').value,'');
   await click('Подтвердить и продолжить');
   const gpuRecord=[...stored.values()].find(r=>r.listing.taxonomyId==='computers.gpu');assert.ok(gpuRecord);
   assert.deepEqual(gpuRecord.selected,['kufar-general','onliner-general']);assert.deepEqual(gpuRecord.categoryOverrides,{});
   // Paste uses the same photo pipeline as upload, without reading the clipboard in the background.
   const paste=async({items=[],files=[]},target=window.document.querySelector('.photo-zone'))=>{
     const event=new window.Event('paste',{bubbles:true,cancelable:true});
     Object.defineProperty(event,'clipboardData',{value:{items,files}});
     await act(async()=>{target.dispatchEvent(event);await new Promise(r=>setTimeout(r,15));});
     return event;
   };
   const png=new window.File(['test-image'],'screenshot.png',{type:'image/png'});
   const imageItem={kind:'file',type:'image/png',getAsFile:()=>png};
   const zone=window.document.querySelector('.photo-zone');assert.equal(zone.tabIndex,0);
   const textPaste=await paste({items:[{kind:'string',type:'text/plain'}]},window.document.querySelector('textarea'));
   assert.equal(textPaste.defaultPrevented,false);assert.equal(optimizedFiles.length,0);
   const imagePaste=await paste({items:[imageItem],files:[png]},window.document.querySelector('textarea'));
   assert.equal(imagePaste.defaultPrevented,true);assert.equal(optimizedFiles.length,1,'items and files must not duplicate one pasted image');
   assert.equal(zone.querySelectorAll('.photo-thumb').length,1);
   await paste({files:[png]});assert.equal(zone.querySelectorAll('.photo-thumb').length,2,'FileList-only clipboard fallback');
   await paste({items:Array.from({length:11},()=>imageItem)});assert.equal(zone.querySelectorAll('.photo-thumb').length,12);
   await paste({items:[imageItem]});assert.equal(optimizedFiles.length,12,'At limit, additional images are not decoded');
   assert.ok(notices.some(n=>n.includes('12 фотографий')));
   await click('Мои объявления');assert.equal(stored.get(gpuRecord.id).photos.length,12,'Pasted photos are saved with the card');
   assert.equal((await paste({items:[imageItem]},window.document.querySelector('main'))).defaultPrevented,false,'Cabinet view does not intercept paste');
   await click('Открыть карточку',entries().find(e=>e.textContent.includes('Видеокарты')));
   assert.equal(window.document.querySelectorAll('.photo-thumb').length,12,'Pasted photos survive reopening');
   const comparison=window.document.querySelector('[aria-label="Сравнение цен"]');assert.ok(comparison);
   assert.equal(messages.filter(m=>m.type==='PRICE_SEARCH').length,0);
   await click('Определить товар для поиска',comparison);assert.match(comparison.textContent,/RX 570/);
   const identityRequest=requests.find(r=>r.body?.task==='identify');assert.ok(identityRequest);assert.ok(!identityRequest.body.text.includes('+375291112233'));
   await click('Найти цены на площадках',comparison);assert.match(comparison.textContent,/Найдено площадкой: 42/);assert.match(comparison.textContent,/180 BYN/);
   const ram=[...window.document.querySelectorAll('[aria-label="Характеристики категории"] select')].find(e=>e.getAttribute('aria-label')==='Видеопамять');assert.ok(ram);
   await act(async()=>{ram.value=ram.options[1].value;ram.dispatchEvent(new window.Event('change',{bubbles:true}));});
   assert.doesNotMatch(comparison.textContent,/Найдено площадкой: 42/,'Changing product attributes invalidates the previous comparison');
   await click('Мои объявления');assert.ok(stored.get(gpuRecord.id).attributes.computers_desktop_ram);
   await click('Мой профиль');assert.match(window.document.body.textContent,/Телефон/);assert.match(window.document.body.textContent,/Город/);
   assert.equal(notices.some(n=>/ошиб|не удалось/i.test(n)),false);
 }finally{
   await act(async()=>root.unmount());globalThis.fetch=realFetch;
   await window.happyDOM.abort();window.close();
   for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 }
});
