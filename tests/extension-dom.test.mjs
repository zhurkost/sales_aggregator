import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Window} from 'happy-dom';
const script=readFileSync(new URL('../extension/dom.js',import.meta.url),'utf8');
function environment(html){const window=new Window({url:'https://www.kufar.by/ain/create',settings:{enableJavaScriptEvaluation:true}});window.document.body.innerHTML=html;window.HTMLElement.prototype.getBoundingClientRect=function(){return {width:100,height:30,top:0,left:0,right:100,bottom:30};};window.eval(script);return {window,document:window.document,dom:window.AutopostDOM};}
// Names and DOM attributes observed in the public Kufar creation form on 2026-10-26.
const base=`<div data-name="category">Авто и запчасти Легковые авто<button data-testid="ain-show-all-categories">Изменить категорию</button></div>
<div data-name="subject"><input id="subject" name="subject" maxlength="50"></div>
<textarea id="body" name="body" maxlength="4000"></textarea>
<div data-name="price"><input name="price" min="0" max="99000000"><div data-testid="base-dropdown-ui">$</div></div>
<input name="mileage" type="number"><input name="vehicle_vin" maxlength="17">`;
test('Kufar body is description, title and price fill; currency never goes into the price box',async()=>{
 const {window,document,dom}=environment(base);try{
  let events=0;document.querySelector('#body').addEventListener('input',()=>events++);
  const task={listing:{category:'cars',title:'Volkswagen Passat 2018',description:'Царапина на бампере.',price:'18900',currency:'USD',mileage:'164000'}};
  assert.equal(await dom.category(task,'kufar'),true);const result=await dom.fillFields(task,'kufar');
  assert.equal(document.querySelector('#subject').value,task.listing.title);assert.equal(document.querySelector('#body').value,task.listing.description);assert.equal(document.querySelector('[name=price]').value,'18900');assert.ok(events>0);assert.ok(result.filled.includes('description'));assert.ok(result.filled.includes('price'));
  document.querySelector('#body').value='Исправлено продавцом';await dom.fillFields(task,'kufar');assert.equal(document.querySelector('#body').value,'Исправлено продавцом');
 }finally{window.happyDOM.abort();window.close();}
});
test('Kufar custom currency selection waits for actual option and protects amount',async()=>{
 const {window,document,dom}=environment(base);try{
  const dropdown=document.querySelector('[data-name=price] [data-testid]');dropdown.addEventListener('click',()=>{const option=document.createElement('div');option.className='DefaultItem-styles-module__x__item';option.textContent='руб.';option.onclick=()=>{dropdown.textContent='руб.';option.remove();};document.body.append(option);});
  const result=await dom.fillFields({listing:{category:'cars',currency:'BYN',price:'50000'}},'kufar');assert.equal(dropdown.textContent,'руб.');assert.equal(document.querySelector('[name=price]').value,'50000');assert.ok(result.filled.includes('currency'));
 }finally{window.happyDOM.abort();window.close();}
});
test('unconfirmed currency does not copy a USD amount into BYN-only form',async()=>{
 const {window,document,dom}=environment(base.replace('<div data-testid="base-dropdown-ui">$</div>','руб.'));try{const result=await dom.fillFields({listing:{category:'general',price:'100',currency:'USD'}},'kufar');assert.equal(document.querySelector('[name=price]').value,'');assert.ok(result.skipped.includes('price'));}finally{window.happyDOM.abort();window.close();}
});
test('category wizard is navigated from visible labels without fabricated session IDs',async()=>{
 const {window,document,dom}=environment(`<div data-name="category"><button data-testid="ain-show-all-categories">Выбрать категорию</button></div>`);try{
  const scope=document.querySelector('[data-name=category]');scope.querySelector('button').onclick=()=>{const root=document.createElement('div');root.textContent='Авто и запчасти';root.onclick=()=>{root.remove();const leaf=document.createElement('div');leaf.textContent='Запчасти';leaf.onclick=()=>{scope.textContent='Авто и запчасти Запчасти';leaf.remove();const type=document.createElement('div');type.dataset.name='spares_type';type.innerHTML='<div role="button">Запчасти для легковых авто</div>';type.firstChild.onclick=()=>type.firstChild.className='chip__filled';document.body.append(type);};document.body.append(leaf);};document.body.append(root);};
  assert.equal(await dom.category({listing:{category:'parts'},mapping:{path:['Авто и запчасти','Запчасти']}},'kufar'),true);assert.match(document.querySelector('[data-name=spares_type]').firstChild.className,/filled/);
 }finally{window.happyDOM.abort();window.close();}
});
test('newly mounted controls are filled on a later pass, no one-shot lock',async()=>{
 const {window,document,dom}=environment(base);try{
  const task={listing:{category:'parts',partNumber:'000123-AB'}};assert.ok((await dom.fillFields(task,'kufar')).skipped.includes('partNumber'));const input=document.createElement('input');input.name='spares_parts_number';document.body.append(input);const result=await dom.fillFields(task,'kufar');assert.equal(input.value,'000123-AB');assert.ok(result.filled.includes('partNumber'));
 }finally{window.happyDOM.abort();window.close();}
});
