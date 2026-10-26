import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Window} from 'happy-dom';
import {categoryById} from '../lib/taxonomy.ts';
const script=readFileSync(new URL('../extension/dom.js',import.meta.url),'utf8');

test('GPU category waits for the dependent type control, selects the exact type, and preserves seller edits',async()=>{
 const {window,document,dom}=environment('<div data-name="category">Компьютерная техника Комплектующие</div>');
 try{
  const task={listing:{category:'general'},mapping:categoryById('computers.gpu').mappings.kufar};
  assert.equal(await dom.category(task,'kufar'),false,'Cannot report category done before required type mounts');
  const field=document.createElement('div');field.dataset.name='computers_component_type';field.innerHTML='<div data-testid="base-dropdown-ui">Выберите тип</div>';document.body.append(field);
  const control=field.firstChild;control.onclick=()=>{const option=document.createElement('div');option.className='DefaultItem-styles-module__x__item';option.textContent='Видеокарты';option.onclick=()=>{control.textContent='Видеокарты';option.remove();};document.body.append(option);};
  assert.equal(await dom.category(task,'kufar'),true);assert.equal(control.textContent,'Видеокарты');
  control.textContent='Процессоры';assert.equal(await dom.category(task,'kufar'),false);assert.equal(control.textContent,'Процессоры');
 }finally{window.happyDOM.abort();window.close();}
});
function environment(html){const window=new Window({url:'https://www.kufar.by/ain/create',settings:{enableJavaScriptEvaluation:true}});window.document.body.innerHTML=html;window.HTMLElement.prototype.getBoundingClientRect=function(){return {width:100,height:30,top:0,left:0,right:100,bottom:30};};window.eval(script);return {window,document:window.document,dom:window.AutopostDOM};}

test('authenticated Onliner price input uses visible BYN hint and preserves USD safety',async()=>{
 const {window,document,dom}=environment('<div><input id="topic_price" type="text"><input name="topic_price" type="hidden"><div>ƃ</div></div><textarea name="topic_desc"></textarea>');
 try{const skipped=await dom.fillFields({listing:{price:'100',currency:'USD'}},'onliner');assert.ok(skipped.skipped.includes('price'));assert.equal(document.querySelector('#topic_price').value,'');
 const result=await dom.fillFields({listing:{price:'300',currency:'BYN'},attributes:[{key:'onliner_short_description',text:'Рабочая RX 570',platform:'onliner'}]},'onliner');assert.ok(result.filled.includes('price'));assert.equal(document.querySelector('#topic_price').value,'300');assert.equal(document.querySelector('textarea').value,'Рабочая RX 570');
 }finally{window.happyDOM.abort();window.close();}
});
test('category attributes fill observed Kufar chips and native text fields, preserving corrections',async()=>{
 const {window,document,dom}=environment('<div data-name="computers_desktop_ram"><button>4 ГБ</button><button>8-10 ГБ</button></div><div data-name="content_video"><input></div>');
 try{for(const b of document.querySelectorAll('button'))b.onclick=()=>b.setAttribute('aria-pressed','true');
 const task={listing:{},attributes:[{key:'computers_desktop_ram',text:'8-10 ГБ',label:'Видеопамять',platform:'kufar'},{key:'content_video',text:'https://www.youtube.com/watch?v=sample',label:'Видео',platform:'kufar'},{key:'onliner_short_description',text:'Only Onliner',platform:'onliner'}]};
 const result=await dom.fillFields(task,'kufar');assert.deepEqual([...result.filled],['attribute:computers_desktop_ram','attribute:content_video']);assert.equal(document.querySelectorAll('button')[1].getAttribute('aria-pressed'),'true');
 document.querySelector('input').value='Changed by seller';await dom.fillFields(task,'kufar');assert.equal(document.querySelector('input').value,'Changed by seller');
 }finally{window.happyDOM.abort();window.close();}
});
test('authenticated Bamper names, hidden Select2 controls and default radios transfer without touching activation',async()=>{
 const {window,document,dom}=environment('<table><tr><td>Марка</td><td><select style="display:none" name="MARKA_ID[]"><option value="">[не указано]</option><option value="1">Volkswagen</option></select></td></tr><tr><td><input name="ORIGINAL_NUM"><textarea name="COMMENT"></textarea><input name="PRICE"><input name="VERSIA"><input type="radio" name="CURRENCY" value="USD" checked><input type="radio" name="CURRENCY" value="BYN"><input type="radio" name="IS_NEW" value="0" checked><input type="radio" name="IS_NEW" value="1"><input type="radio" name="PREORDER" value="0" checked><input type="radio" name="PREORDER" value="1"><input type="checkbox" name="set_active" checked></td></tr></table>');
 try{const task={listing:{brand:'Volkswagen',partNumber:'000-123',description:'Проверенное состояние',price:'80',currency:'BYN',condition:'Новая',availability:'Под заказ'},attributes:[{key:'bamper_modification',text:'B8',platform:'bamper'}]};const result=await dom.fillFields(task,'bamper');
 assert.equal(document.querySelector('select').value,'1');assert.equal(document.querySelector('[name="PRICE"]').value,'80');assert.equal(document.querySelector('[name="ORIGINAL_NUM"]').value,'000-123');assert.equal(document.querySelector('[name="VERSIA"]').value,'B8');assert.ok(result.filled.includes('condition'));assert.equal(document.querySelector('[name="IS_NEW"]:checked').value,'1');assert.equal(document.querySelector('[name="set_active"]').checked,true);
 document.querySelector('[name="CURRENCY"][value="USD"]').click();await dom.fillFields(task,'bamper');assert.equal(document.querySelector('[name="CURRENCY"]:checked').value,'USD','Seller correction wins');
 }finally{window.happyDOM.abort();window.close();}
});
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
