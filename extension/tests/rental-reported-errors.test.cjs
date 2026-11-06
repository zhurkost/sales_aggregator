const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const recipe = (site) => JSON.parse(fs.readFileSync(path.join(__dirname,
  '../../data/rental/apartments_long_term_rent/runtime/browser_' + site + '.json'), 'utf8'));

async function fixture(html, controls) {
  const { Window } = await import('happy-dom');
  const window = new Window();
  window.document.body.innerHTML = html;
  window.eval(fs.readFileSync(path.join(__dirname, '../rental-form.js'), 'utf8'));
  const form = new window.AutopostRentalForm.Form({controls});
  return {window, document: window.document, form};
}

test('phone prefix is not mistaken for a manually entered number; formatted numbers are confirmed', async () => {
  for (const [html, value, expected] of [
    ['<input id="phone" value="+375">', '+375291234567', '+375291234567'],
    ['<input id="phone" value="+375 (__) ___-__-__">', '+375291234567', '+375291234567'],
    ['<div><span>+375</span><input id="phone"></div>', '+375291234567', '291234567'],
    ['<input id="phone" value="+375 (29) 123-45-67">', '+375291234567', '+375 (29) 123-45-67'],
    ['<input id="phone" value="+375299999999">', '+375291234567', '+375299999999'],
  ]) {
    const f = await fixture(html, [{field:'contact.phone',action:'text',selector:'#phone',value}]);
    await f.form.tick();
    assert.equal(f.document.querySelector('#phone').value, expected);
    assert.equal(f.form.done.has('contact.phone'), !expected.endsWith('9999999'));
    f.window.happyDOM.abort();
  }
});

test('Domovita building height is filled before storey can auto-populate it', async () => {
  const controls = recipe('domovita').controls.filter(c => ['domovita.storey','domovita.storeys'].includes(c.field))
    .map(c => ({...c,value:c.field==='domovita.storey' ? 3 : 9}));
  const f = await fixture('<input name="storey"><input name="storeys">', controls);
  const floor = f.document.querySelector('[name="storey"]'), total = f.document.querySelector('[name="storeys"]');
  floor.oninput = () => { if(Number(total.value)<Number(floor.value)) total.value=floor.value; };
  await f.form.tick();
  assert.equal(floor.value, '3');
  assert.equal(total.value, '9');
  assert.equal(f.form.done.size, 2);
  f.window.happyDOM.abort();
});

test('Domovita React Select currency opens on mousedown and price waits for confirmed BYN', async () => {
  const controls = recipe('domovita').controls.filter(c => ['domovita.currency','domovita.monthly_price'].includes(c.field))
    .map(c => ({...c,value:c.field==='domovita.currency' ? 'BYN' : '1300'}));
  const f = await fixture('<input name="price"><div id="currency"><div class="custom-select__control"><div class="custom-select__single-value">USD</div><input role="combobox" style="visibility:hidden"></div><input type="hidden" name="price_currency_text"></div>', controls);
  // React Select attaches onControlMouseDown; HTMLElement.click() alone never opens it.
  f.document.querySelector('.custom-select__control').onmousedown = (event) => {
    assert.equal(event.button,0);
    if(f.document.querySelector('[role="option"]')) return;
    const option=f.document.createElement('div'); option.setAttribute('role','option');option.textContent='BYN';
    option.onclick=()=>{f.document.querySelector('.custom-select__single-value').textContent='BYN';option.remove();};
    f.document.body.appendChild(option);
  };
  await f.form.tick();
  assert.equal(f.document.querySelector('[name="price"]').value,'');
  for(let i=0;i<4;i++) await f.form.tick();
  assert.equal(f.document.querySelector('.custom-select__single-value').textContent,'BYN');
  assert.equal(f.document.querySelector('[name="price"]').value,'1300');
  assert.equal(f.form.done.size,2);
  f.window.happyDOM.abort();
});

test('Kufar nested choice labels and ARIA checkbox/radio controls fill all reported groups once', async () => {
  const rows = [
    ['kufar.bathroom','bathroom','2','Совмещенный'],
    ['kufar.balcony','balcony','3','Лоджия'],
    ['kufar.repair','flat_repair','5','Евро'],
    ['kufar.household_amenities','flat_improvement','6','Мебель'],
    ['kufar.bathroom_amenities','flat_bath','3','Стиральная машина'],
    ['kufar.kitchen_amenities','flat_kitchen','1','Холодильник'],
  ];
  const controls=rows.map(([id,,code,label])=>({...recipe('kufar').controls.find(c=>c.field===id),
    value:id.includes('amenities')?[code]:code,labels:{[code]:label}}));
  const html=rows.map(([,name,,label],i)=>`<div data-name="${name}"><div role="${i<3?'radio':'checkbox'}" aria-checked="false"><label>${label.replace('Совмещенный','Совмещённый')}</label></div></div>`).join('');
  const f=await fixture(html,controls);let clicks=0;
  for(const el of f.document.querySelectorAll('[aria-checked]'))el.onclick=()=>{clicks++;el.setAttribute('aria-checked',el.getAttribute('aria-checked')==='true'?'false':'true');};
  await f.form.tick();await f.form.tick();
  assert.equal(f.form.done.size,6);assert.equal(clicks,6);
  assert.equal(f.document.querySelectorAll('[aria-checked="true"]').length,6);
  f.window.happyDOM.abort();
});

test('Realt receives separate rooms and its own short description, not full listing text', async () => {
  const controls=recipe('realt').controls.filter(c=>['realt.separate_rooms','realt.short_description'].includes(c.field))
    .map(c=>({...c,value:c.field==='realt.separate_rooms'?'2':'Светлая квартира рядом с парком.'}));
  const f=await fixture('<input id="apartment.separateRooms"><textarea id="description.shortDescription" maxlength="500"></textarea>',controls);
  await f.form.tick();
  assert.equal(f.document.querySelector('input').value,'2');
  assert.equal(f.document.querySelector('textarea').value,'Светлая квартира рядом с парком.');
  assert.equal(f.form.done.size,2);f.window.happyDOM.abort();
});

test('Onliner replaces restored values, confirms the formatted price and respects subsequent manual input', async t => {
  const controls = [
    {field:'onliner.price_amount', action:'text', selector:'#price', value:1475},
    {field:'onliner.description', action:'text', selector:'textarea', value:'Новое объявление'},
    {field:'onliner.facilities', action:'choices', selector:'.facility', value:['internet','furniture'], replaceGroup:true},
    {field:'onliner.rent_rules', action:'choices', selector:'.rule', value:[], replaceGroup:true},
  ];
  const {window:w, document:d, form} = await fixture(
    '<input id="price" value="1 300,00"><textarea>Прежнее объявление</textarea>' +
    '<input class="facility" type="checkbox" value="internet"><input class="facility" type="checkbox" value="furniture">' +
    '<input class="rule" type="checkbox" value="without_children" checked>',controls);
  t.after(()=>w.close());
  // Mirror the native input event emitted synchronously by programmatic checkbox activation.
  d.addEventListener('input', e=>{if(e.target.type==='checkbox') form.protect(e.target);});
  d.querySelector('#price').oninput=e=>{e.target.value='1 475,00';};
  for(let i=0;i<5;i++) await form.tick();
  assert.equal(d.querySelector('textarea').value,'Новое объявление');
  assert.equal(d.querySelector('#price').value,'1 475,00');
  assert.equal(d.querySelectorAll('.facility:checked').length,2);
  assert.equal(d.querySelector('.rule').checked,false);
  assert.deepEqual(Array.from(form.remaining()),[]);
  const manual = new w.AutopostRentalForm.Form({controls});
  const editor = d.querySelector('textarea');
  editor.value='Правка пользователя'; manual.protect(editor);
  await manual.tick();
  assert.equal(editor.value,'Правка пользователя');
});

test('Onliner decimal price survives the Belarusian ruble mask and keeps kopecks', async t => {
  const {window:w,document:d,form}=await fixture('<input id="price" placeholder="0,00">',
    [{field:'onliner.price_amount',action:'text',selector:'#price',value:990.5}]);
  t.after(()=>w.close());
  const input=d.querySelector('input');
  input.oninput=()=>{input.value=Number(input.value.replace(/[^0-9,]/g,'').replace(',','.')).toFixed(2).replace('.',',');};
  await form.tick();
  assert.equal(input.value,'990,50');
  assert.deepEqual(Array.from(form.remaining()),[]);
});

test('Realt opens the adjacent area section and rejects a truncated house number', async t=>{
  const controls=['realt.kitchen_area','realt.house_number'].map((field,i)=>({
    ...recipe('realt').controls.find(c=>c.field===field),after:undefined,value:[8.4,'12А'][i]}));
  const {window:w,document:d,form}=await fixture('<div id="area"></div><button>Все параметры</button><input id="location.houseNumber">',controls);
  t.after(()=>w.close());
  d.querySelector('button').onclick=e=>{d.getElementById('area').innerHTML='<input id="area.kitchen">';e.currentTarget.remove();};
  const house=d.getElementById('location.houseNumber');
  house.oninput=()=>{house.value=house.value.replace(/[^0-9]/g,'');};
  await form.tick();await form.tick();
  assert.equal(d.getElementById('area.kitchen').value,'8.4');
  assert.equal(house.value,'');
  assert.deepEqual(Array.from(form.remaining()),['realt.house_number']);
});

test('Onliner keeps restored photos until replacement previews arrive, without sending the files twice', async t => {
  const c=recipe('onliner').controls.find(c=>c.action==='files');
  const {window:w,document:d}=await fixture('<input class="new-photos__input-file" type="file" name="file">',[]);
  t.after(()=>w.close());
  function preview(id) {
    const figure=d.createElement('div');figure.className='new-photos__thumbnail-figure';
    figure.innerHTML='<img src="https://content.onliner.by/apartments_photo/'+id+'.jpg"><a class="new-photos__thumbnail-remove">Удалить</a>';
    figure.querySelector('a').onclick=()=>figure.remove();d.body.append(figure);return figure;
  }
  const old=preview('old');
  let claims=0;
  const form=new w.AutopostRentalForm.Form({controls:[c]},[{name:'new.png',dataUrl:'data:image/png;base64,YQ=='}],async()=>{claims++;return true;});
  await form.tick();await form.tick();
  assert.equal(old.isConnected,true);assert.equal(form.done.size,0);
  const fresh=preview('new');
  await form.tick();await form.tick();
  assert.equal(old.isConnected,false);assert.equal(fresh.isConnected,true);
  assert.equal(claims,1);assert.equal(form.done.has(c.field),true);
});

test('Kufar can deselect a default paid package without clicking a paid offer or submitting',async t=>{
  const {window:w,document:d,form}=await fixture('<div role="button" data-cy="vas-express" class="abc_card--selected"></div><div role="button" data-cy="vas-no_vas">Без увеличения просмотров</div><button>Подать объявление</button>',[]);
  t.after(()=>w.close());form.recipe.platform='kufar';
  const clicks=[];d.addEventListener('click',e=>clicks.push(e.target.dataset.cy));
  await form.tick();await form.tick();assert.deepEqual(clicks,['vas-no_vas']);
});
