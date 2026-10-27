import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Window} from 'happy-dom';
import {extensionRecipe} from '../lib/extension-config.ts';
import {categoryFields,fieldVerification} from '../lib/attributes.ts';

// Reconstructed DOM from HAR client modules 66146 (catalog), 34966 (radios),
// 13762 (UID), 69466 (condition), 8556 (next step), and shared dropdown widgets.
function setup(html=''){
 const w=new Window({url:'https://av.by/offer/draft/cars',settings:{enableJavaScriptEvaluation:true}});
 w.document.body.innerHTML='<main>'+html+'</main>';
 w.HTMLElement.prototype.getBoundingClientRect=function(){return {width:this.closest('[hidden]')?0:100,height:30};};
 for(const name of ['dom','av'])w.eval(readFileSync(new URL('../extension/'+name+'.js',import.meta.url),'utf8'));
 w.AutopostDOM.pause=()=>new Promise(resolve=>setTimeout(resolve,1));
 // av captures the pause reference during initialization.
 w.eval(readFileSync(new URL('../extension/av.js',import.meta.url),'utf8'));
 const task={listing:{category:'cars',brand:'Audi',model:'100',year:'1993',body:'Универсал',transmission:'Автомат',fuel:'Бензин',drive:'Передний',engine:'2.0'},attributes:[],photos:[]};
 return {w,doc:w.document,av:w.AutopostAV,task,close:()=>{w.happyDOM.abort();w.close();}};
}
function catalog(name,title,values){return `<div class="newad__catalog"><h2 class="catalog__header">${title}</h2><ul class="catalog__items">${values.map((v,i)=>`<li class="catalog__item"><label class="catalog__label"><input type="radio" id="catalogItem-${name}_${i}" name="catalogItem-${name}_${i}"><span class="catalog__description-text">${v}</span></label></li>`).join('')}</ul></div>`;}
function dropdown(name,label,options,selected=''){
 return `<div class="form-row__item"><div class="form-label">${label}</div><div class="dropdown"><div class="dropdown__box"><button type="button" class="dropdown__control ${selected?'dropdown__control--active':''}" id="p-9-${name}" aria-pressed="false"><span class="dropdown-button__value">${selected||'Выберите'}</span></button><div class="dropdown-list" hidden>${options.map(v=>`<button type="button" class="dropdown__listbutton">${v}</button>`).join('')}</div></div></div></div>`;
}
function wireDropdowns(doc){for(const group of doc.querySelectorAll('.dropdown')){const c=group.querySelector('.dropdown__control'),list=group.querySelector('.dropdown-list');c.onclick=()=>{list.hidden=!list.hidden;c.setAttribute('aria-pressed',String(!list.hidden));};for(const o of list.querySelectorAll('button'))o.onclick=()=>{c.querySelector('span').textContent=o.textContent;c.classList.add('dropdown__control--active');list.hidden=true;c.setAttribute('aria-pressed','false');};}}
function step(content){return `<div class="newad__step"><div class="newad__step-item">${content}</div></div>`;}

test('new and used condition branches are selected by exact title without clicking paid confirmations',async()=>{
 for(const [value,year] of [['Новый автомобиль','2026'],['Автомобиль с пробегом','1993']]){
  const e=setup('<section class="category__section--cars"><a class="category-item__button"><span class="category-item__title">Автомобиль с пробегом</span></a><a class="category-item__button"><span class="category-item__title">Новый автомобиль</span></a></section><button id="pay">Оплатить</button>');
  try{
   e.task.listing.year=year;e.task.attributes=[{key:'av_condition_promotion',platform:'av',formName:'condition_promotion',text:value}];let clicks=0;
   e.doc.querySelector('#pay').onclick=()=>clicks++;
   for(const a of e.doc.querySelectorAll('a'))a.onclick=()=>{a.classList.add('category-item__button--active');};
   const r=await e.av.fill(e.task);assert.equal(r.continue,true);assert.equal(e.doc.querySelector('.category-item__button--active').textContent,value);assert.equal(clicks,0);
   assert.equal(e.av.desired(e.task).condition?.value,value==='Новый автомобиль'?'новый':undefined);
  }finally{e.close();}
 }
});

test('brand, model and year catalogs advance after asynchronous mounting; all-brands expansion works',async()=>{
 const e=setup(step(catalog('brand','Марка',['BMW'])));
 try{
  const first=e.doc.querySelector('.newad__catalog');first.insertAdjacentHTML('beforeend','<p class="catalog__show-all"><button type="button">Все марки</button></p>');
  const wire=(name,next)=>{for(const input of e.doc.querySelectorAll(`[id^="catalogItem-${name}_"]`))input.onclick=()=>{
   const label=input.parentElement.textContent;setTimeout(()=>{e.doc.querySelector('.newad__step-item').innerHTML=next;e.doc.querySelector('main').insertAdjacentHTML('afterbegin',`<button class="newad__breadcrumb-button">${label}</button>`);},0);
  };};
  first.querySelector('button').onclick=()=>{e.doc.querySelector('.newad__step-item').innerHTML=catalog('brand','Марка',['Audi','BMW']);wire('brand',catalog('model','Модель',['100','A6']));};
  assert.ok((await e.av.fill(e.task)).filled.includes('brand'));
  wire('model',catalog('year','Год',['1993','1994']));assert.ok((await e.av.fill(e.task)).filled.includes('model'));
  wire('year','<div class="generations"><label><input type="radio" name="generations"><span class="generations__title">4A, C4</span></label></div>');assert.ok((await e.av.fill(e.task)).filled.includes('year'));
  assert.equal((await e.av.fill(e.task)).continue,true,'Sole generation is unambiguous');
 }finally{e.close();}
});

test('parameter selectors match exact values, wait for accepted state and preserve user choices',async()=>{
 const e=setup(step(dropdown('body_type','Кузов',['седан','универсал'])+dropdown('transmission_type','Коробка передач',['механика','автомат'])));
 try{
  wireDropdowns(e.doc);assert.ok((await e.av.fill(e.task)).filled.includes('body'));
  assert.ok((await e.av.fill(e.task)).filled.includes('transmission'));
  e.doc.querySelector('#p-9-body_type span').textContent='седан';const r=await e.av.fill(e.task);assert.equal(r.blocked,true);assert.match(r.message,/Уже выбрано/);assert.equal(e.doc.querySelector('#p-9-body_type span').textContent,'седан');
 }finally{e.close();}
});

test('ambiguous drive and modification are never guessed; engine volume only selects a unique match',async()=>{
 const e=setup(step(dropdown('drive_type','Привод',['подключаемый полный привод','постоянный полный привод'])+dropdown('modification','Модификация',['2,0 AT (115 л.с.)','2,0 AT (150 л.с.)'])));
 try{
  wireDropdowns(e.doc);e.task.listing.drive='Полный';let r=await e.av.fill(e.task);assert.equal(r.blocked,true);assert.equal(e.doc.querySelectorAll('.dropdown__control--active').length,0);
  e.task.attributes.push({key:'av_drive_type',platform:'av',formName:'drive_type',text:'постоянный полный привод'},{key:'av_modification',platform:'av',formName:'modification',text:'2,0 AT (150 л.с.)'});
  await e.av.fill(e.task);r=await e.av.fill(e.task);assert.ok(r.filled.includes('attribute:av_modification'));
 }finally{e.close();}
 const single=setup(step(dropdown('modification','Модификация',['2,0 AT (115 л.с.)','2,8 AT (174 л.с.)'])));
 try{wireDropdowns(single.doc);assert.equal((await single.av.fill(single.task)).continue,true);assert.match(single.doc.querySelector('.dropdown__control').textContent,/2,0/);}finally{single.close();}
});

test('currency is confirmed before amount; later manual currency changes block price; cm3 and phone are normalized',async()=>{
 const e=setup(step(dropdown('price_currency','Валюта',['USD','BYN'],'USD')+'<div class="form-row__item"><label>Цена</label><input id="p-33-32-price_amount"></div>'));
 try{
  wireDropdowns(e.doc);e.task.listing.currency='BYN';e.task.listing.price='15000';
  await e.av.fill(e.task);assert.equal(e.doc.querySelector('input').value,'');
  await e.av.fill(e.task);assert.equal(e.doc.querySelector('input').value,'15000');
  e.doc.querySelector('.dropdown__control span').textContent='USD';e.doc.querySelector('input').value='';const r=await e.av.fill(e.task);assert.equal(r.blocked,true);assert.equal(e.doc.querySelector('input').value,'');
  e.task.listing.phone='+375 (29) 123-45-67';const d=e.av.desired(e.task);assert.equal(d.engine_capacity.value,'2000');assert.equal(d.phone_number.value,'291234567');assert.equal(d.phone_country.value,'+375');
 }finally{e.close();}
});

test('only the observed next-step button advances, once per state, never publication or payment',async()=>{
 const e=setup(step('<div class="form-row__item"><label class="form-label">Код из 17 символов</label><input id="p-26-vin"></div>')+'<div class="newad__submit"><button type="submit">Опубликовать объявление</button><button>Сохранить и оплатить позже</button></div>');
 try{
  e.doc.querySelector('.newad__step').insertAdjacentHTML('beforeend','<div class="newad__step-next"><button type="button">Далее</button></div>');
  let next=0,submit=0;e.doc.querySelector('.newad__step-next button').onclick=()=>next++;for(const b of e.doc.querySelectorAll('.newad__submit button'))b.onclick=()=>submit++;
  assert.equal((await e.av.fill(e.task)).continue,true);e.task.avStable.at-=1100;await e.av.fill(e.task);await e.av.fill(e.task);assert.equal(next,1);assert.equal(submit,0);
  e.doc.querySelector('.newad__step-item').innerHTML=dropdown('interior_material','Материал салона',['ткань','натуральная кожа']);wireDropdowns(e.doc);
  const r=await e.av.fill(e.task);assert.equal(r.blocked,true);assert.match(r.message,/Материал салона/);assert.equal(next,1);
 }finally{e.close();}
});

test('server recipe exposes AV-specific fields as optional card inputs and retains exact choices',()=>{
 const listing={category:'cars',taxonomyId:'auto.cars',title:'Audi 100',description:'Автомобиль'};
 const fields=categoryFields(listing);assert.ok(fields.some(f=>f.key==='av_condition_promotion'));assert.ok(fields.some(f=>f.key==='av_registration_country'));
 const recipe=extensionRecipe({listing,attributes:{av_condition_promotion:'5',av_modification:'1,4 AT (159 л.с.)',av_name:'Продавец'}});
 assert.equal(recipe.entries.find(f=>f.key==='av_condition_promotion').text,'Новый автомобиль');assert.equal(recipe.entries.find(f=>f.key==='av_modification').formName,'modification');
 assert.equal(fieldVerification('auto.cars','av').status,'har_inspected');
 assert.equal(fields.some(f=>f.key==='av_number_masking'),false,'Privacy/promotions are not silently changed');
});

test('a delayed dropdown selection cannot continue after pause or count an unaccepted click as filled',async()=>{
 const e=setup(step(dropdown('body_type','Кузов',['универсал'])));
 try {
  const c=e.doc.querySelector('.dropdown__control'),list=e.doc.querySelector('.dropdown-list');
  c.onclick=()=>{list.hidden=false;c.setAttribute('aria-pressed','true');e.task.paused=true;};
  let clicked=0;e.doc.querySelector('.dropdown__listbutton').onclick=()=>clicked++;
  const r=await e.av.fill(e.task);assert.equal(clicked,0);assert.equal(r.filled.includes('body'),false);
 }finally{e.close();}
 const reject=setup(step(dropdown('body_type','Кузов',['универсал'])));
 try {
  const c=reject.doc.querySelector('.dropdown__control');c.onclick=()=>{reject.doc.querySelector('.dropdown-list').hidden=false;c.setAttribute('aria-pressed','true');};
  const r=await reject.av.fill(reject.task);assert.equal(r.filled.includes('body'),false);assert.equal(r.blocked,true);
 }finally{reject.close();}
});

test('matching initial currency is protected from later overwrites, photos and missing required fields hold the step',async()=>{
 const e=setup(step(dropdown('price_currency','Валюта',['USD','BYN'],'BYN')+'<input id="p-33-32-price_amount">'));
 try {
  wireDropdowns(e.doc);e.task.listing.currency='BYN';e.task.listing.price='15000';await e.av.fill(e.task);
  e.doc.querySelector('.dropdown__control span').textContent='USD';e.doc.querySelector('input').value='';await e.av.fill(e.task);
  assert.equal(e.doc.querySelector('.dropdown__control span').textContent,'USD');assert.equal(e.doc.querySelector('input').value,'');
  e.doc.querySelector('main').innerHTML='<div class="newad__step"><div id="photo-block-id"></div><div class="newad__step-next"><button type="button">Далее</button></div></div>';
  e.task.photos=[{name:'photo.jpg'}];let clicks=0;e.doc.querySelector('button').onclick=()=>clicks++;
  const r=await e.av.fill(e.task);assert.equal(r.blocked,true);assert.equal(clicks,0);assert.match(r.message,/Фотографии/);
 }finally{e.close();}
});
