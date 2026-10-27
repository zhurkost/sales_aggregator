import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Window} from 'happy-dom';

const html=`<form id="ai-form"><input name="subject" value="Видеокарта RX 570"><textarea name="body">Описание видеокарты</textarea><input name="price" value="100">
<div data-name="images">Фотографии Загружено 1 из 9</div><input id="imageLoaderDropzone" type="file" accept="image/jpeg">
<div data-name="region"><div data-testid="base-dropdown-ui">Минск</div></div><div data-name="area"><div data-testid="base-dropdown-ui">Фрунзенский</div></div>
<input name="phone_hidden" type="radio" checked><div role="button" data-cy="vas-no_vas" class="card--selected">Без увеличения просмотров</div>
<button type="submit">Подать объявление</button></form>`;
function setup(){
 const w=new Window({url:'https://www.kufar.by/ain/create',settings:{enableJavaScriptEvaluation:true}});w.document.body.innerHTML=html;
 for(const script of ['core','navigation','publication','autopublish'])w.eval(readFileSync(new URL('../extension/'+script+'.js',import.meta.url),'utf8'));
 const task={jobId:'job',name:'Kufar',publishMode:'automatic',expiresAt:Date.now()+60000,listing:{category:'general',title:'Видеокарта RX 570',description:'Описание видеокарты',price:'100',currency:'BYN'},photos:[{name:'one.jpg'}],photosAttempted:true,photosTransferred:1,attributes:[]};
 const result={filled:['title','description','price'],skipped:[],details:[]};
 const inspect=()=>w.AutopostAutoPublish.inspect(w.document,'kufar',w.location.href,task,result,true,e=>!e.hidden);
 return {w,task,result,inspect};
}
test('automatic preflight requires server photo count, free publication, valid fields and exact values',()=>{
 const {w,task,result,inspect}=setup();try{
  assert.equal(inspect().ready,true);
  const input=w.document.createElement('input');input.name='required-extra';input.required=true;w.document.querySelector('form').append(input);
  assert.match(inspect().message,/обязательное/);input.remove();
  const required=w.document.createElement('div');required.dataset.name='new_parameter';required.innerHTML='<div class="field__label">Новый параметр*</div><div data-testid="base-dropdown-ui">Выберите</div>';w.document.querySelector('form').append(required);
  assert.match(inspect().message,/Новый параметр/);required.remove();
  w.document.querySelector('[data-name="images"]').textContent='Загружено 0 из 9';assert.equal(inspect().ready,false);
  w.document.querySelector('[data-name="images"]').textContent='Загружено 1 из 9';
  const due=w.document.createElement('p');due.textContent='К оплате: 3,4 р.';w.document.querySelector('form').append(due);assert.match(inspect().message,/платные/);due.remove();
  w.document.querySelector('[name="price"]').value='200';assert.equal(inspect().ready,false);w.document.querySelector('[name="price"]').value='100';
  task.attributes=[{key:'computers_desktop_ram',platform:'kufar',label:'Видеопамять'}];assert.equal(inspect().ready,false);result.filled.push('attribute:computers_desktop_ram');assert.equal(inspect().ready,true);
  const chat=w.document.createElement('input');chat.type='file';w.document.body.append(chat);
  assert.equal(w.AutopostAutoPublish.fileInput(w.document,'kufar').id,'imageLoaderDropzone');
  assert.equal(w.AutopostAutoPublish.supported('bamper',task.listing),false);assert.equal(w.AutopostAutoPublish.supported('onliner',{category:'cars'}),false);
 }finally{w.close();}
});
test('Onliner scopes photo uploads to the ad form, rejects missing previews and accepts server-backed thumbnails',()=>{
 const {w,task,result}=setup();try{
  w.document.body.innerHTML='<form id="posting"><input name="subject" value="Видеокарта RX 570"><textarea name="message">Описание видеокарты</textarea><input name="topic_price" value="100"><select name="f"><option value="286">Видеокарты</option></select><input name="region" value="1"><input name="city" value="1"><div class="drop-style__wrapper"><input type="file" name="file"><div class="preview"></div></div><a id="btnFleaMarketPostingSubmitEnabled">Добавить объявление</a></form><input type="file" id="chat">';
  const inspect=()=>w.AutopostAutoPublish.inspect(w.document,'onliner','https://baraholka.onliner.by/fleamarketposting.php',task,result,true,()=>true);
  assert.equal(w.AutopostAutoPublish.fileInput(w.document,'onliner').name,'file');assert.equal(inspect().ready,false);
  w.document.querySelector('.preview').style.backgroundImage='url("https://content.onliner.by/photo.jpg")';assert.equal(inspect().ready,true);
  w.document.querySelector('.preview').style.backgroundImage='url("blob:https://baraholka.onliner.by/local")';assert.equal(inspect().ready,false);
 }finally{w.close();}
});
test('controller sends once only after explicit automatic mode, stable form and persisted worker grant',async()=>{
 const {w,task,result}=setup();const messages=[];let tick,now=Date.now(),clicks=0,listener;
 task.publishMode='manual';w.Date.now=()=>now;
 w.setInterval=fn=>{tick=fn;return 1;};w.clearInterval=()=>{};w.MutationObserver=class{observe(){}disconnect(){}};
 w.AutopostDOM={visible:e=>!e.hidden,findNative:()=>w.document.querySelector('[name="body"]'),category:async()=>true,fillFields:async()=>result};
 w.document.querySelector('button').addEventListener('click',e=>{e.preventDefault();clicks++;});
 w.chrome={runtime:{id:'ext',onMessage:{addListener(fn){listener=fn;}},async sendMessage(m){messages.push(m);
  if(m.kind==='GET_TASK')return {task:{...task}};
  if(m.kind==='AUTO_BEGIN'){task.submission={id:'attempt',automatic:true,at:now,title:task.listing.title,existing:[]};task.autoAttempt='attempt';return {ok:true,submission:task.submission};}
  return {ok:true};
 }}};
 try{
  await w.eval(readFileSync(new URL('../extension/marketplace.js',import.meta.url),'utf8'));
  await tick();await new Promise(r=>setTimeout(r,10));assert.equal(clicks,0);assert.equal(messages.some(m=>m.kind==='AUTO_BEGIN'),false);
  task.publishMode='automatic';await tick();await new Promise(r=>setTimeout(r,10));assert.equal(clicks,0);
  now+=5000;await tick();await new Promise(r=>setTimeout(r,10));assert.equal(clicks,1);
  await tick();assert.equal(clicks,1);assert.equal(messages.filter(m=>m.kind==='AUTO_BEGIN').length,1);
  listener({kind:'TASK_MODE',publishMode:'manual',paused:true},{id:'ext'});await tick();assert.equal(clicks,1);
 }finally{await w.happyDOM.abort();w.close();}
});

test('a pause arriving with the one-shot grant prevents the final click',async()=>{
 const {w,task,result}=setup();let tick,listener,now=Date.now(),clicks=0;
 w.Date.now=()=>now;w.setInterval=fn=>{tick=fn;return 1;};w.clearInterval=()=>{};w.MutationObserver=class{observe(){}disconnect(){}};
 w.AutopostDOM={visible:e=>!e.hidden,findNative:()=>w.document.querySelector('[name="body"]'),category:async()=>true,fillFields:async()=>result};
 w.document.querySelector('button').addEventListener('click',e=>{e.preventDefault();clicks++;});
 w.chrome={runtime:{id:'ext',onMessage:{addListener(fn){listener=fn;}},async sendMessage(m){
  if(m.kind==='GET_TASK')return {task:{...task}};
  if(m.kind==='AUTO_BEGIN') {task.paused=true;listener({kind:'TASK_MODE',publishMode:'manual',paused:true},{id:'ext'});return {ok:true,submission:{id:'attempt',automatic:true,at:now}};}
  return {ok:true};
 }}};
 try{
  await w.eval(readFileSync(new URL('../extension/marketplace.js',import.meta.url),'utf8'));
  now+=5000;await tick();await new Promise(r=>setTimeout(r,10));assert.equal(clicks,0);
 }finally{await w.happyDOM.abort();w.close();}
});
