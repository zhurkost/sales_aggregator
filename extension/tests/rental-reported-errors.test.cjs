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
