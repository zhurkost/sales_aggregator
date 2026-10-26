import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import ts from 'typescript';
import {Window} from 'happy-dom';
import React,{act} from 'react';

// Render our own components in a synthetic DOM, without a browser or remote pages.
test('description is classified, explicitly confirmed, saved and visible in the cabinet',async()=>{
 const window=new Window({url:'http://127.0.0.1:5173'});
 const previous=new Map();
 for(const [key,value] of Object.entries({window,document:window.document,location:window.location,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){
   previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 }
 const realFetch=globalThis.fetch;const stored=new Map();const requests=[];const notices=[];
 globalThis.fetch=async(path,options={})=>{
   const body=options.body?JSON.parse(options.body):undefined;requests.push({path,body});
   if(path==='/api/ai-settings')return Response.json({serverConfigured:true});
   if(path==='/api/workspace/ads'){
     if(body){const ad={...body,revision:(stored.get(body.id)?.revision||0)+1,updatedAt:new Date().toISOString()};stored.set(ad.id,ad);return Response.json({ad});}
     return Response.json({ads:[...stored.values()].map(({photos,text,...r})=>({...r,photoCount:photos.length}))});
   }
   if(path==='/api/analyze')return Response.json(body.task==='classify'?{candidates:[{id:'auto.parts.optics',confidence:.9,reason:'Фара — автомобильная оптика'}]}:{listing:{category:'parts',title:'Фара Passat',partName:'Фара',partNumber:'3G1941035D',description:'Есть царапина',currency:'BYN',price:'450',condition:'Б/у',priceUnit:'За штуку'}});
   throw new Error('Unexpected API '+path);
 };
 window.postMessage=message=>queueMicrotask(()=>window.dispatchEvent(new window.MessageEvent('message',{source:window,origin:window.location.origin,data:{source:'autopost-extension',type:'RESPONSE',requestId:message.requestId,payload:message.type==='PING'?{version:'0.3.0'}:{batches:[]}}})));
 mkdirSync(new URL('../work/',import.meta.url),{recursive:true});
 const code=ts.transpileModule(readFileSync(new URL('../components/workspace-ui.tsx',import.meta.url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/(from\s+["']\.\.\/lib\/[^"']+)(["'])/g,'$1.ts$2');
 const generated=new URL('../work/ui-test.generated.mjs',import.meta.url);writeFileSync(generated,code);
 const {Workspace}=await import(generated.href);const {createRoot}=await import('react-dom/client');
 const root=createRoot(window.document.body);
 const click=async(label)=>{const button=[...window.document.querySelectorAll('button')].find(b=>b.textContent.trim()===label);assert.ok(button,'Button: '+label);assert.equal(button.disabled,false);await act(async()=>{button.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));await new Promise(r=>setTimeout(r,15));});};
 try{
   await act(async()=>root.render(React.createElement(Workspace,{profile:{id:'ui-profile',name:'Тест',login:'test'},onLogout(){},notify:s=>notices.push(s)})));
   await click('Пример запчасти');await click('Определить категорию');
   assert.equal(stored.size,0,'classification alone does not prepare a listing');
   assert.match(window.document.body.textContent,/Фара — автомобильная оптика/);
   await click('Подтвердить и продолжить');
   assert.equal([...stored.values()][0].categoryConfirmed,true);assert.equal([...stored.values()][0].listing.taxonomyId,'auto.parts.optics');
   assert.ok(requests.filter(r=>r.path==='/api/analyze').every(r=>!('photos'in r.body)));
   await click('Мои объявления');assert.match(window.document.body.textContent,/Фара Passat/);
   assert.equal(notices.some(n=>/ошиб|не удалось/i.test(n)),false);
 }finally{
   await act(async()=>root.unmount());globalThis.fetch=realFetch;
   await window.happyDOM.abort();window.close();
   for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 }
});
