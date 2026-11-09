const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const recipe = platform => JSON.parse(fs.readFileSync(path.join(__dirname,
  '../../data/rental/houses_sale/runtime/browser_' + platform + '.json'), 'utf8'));
async function setup(t, html, controls) {
  const {Window} = await import('happy-dom');
  const w = new Window({url:'https://realt.by/podat-obyavlenie/'});
  t.after(() => w.close());
  w.document.body.innerHTML = html;
  for (const file of ['rental-autocomplete.js','rental-form.js'])
    w.eval(fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
  return {w,doc:w.document,form:new w.AutopostRentalForm.Form({controls})};
}

test('Kufar fills responsive currency, walls and year from their own portal dialogs', async t => {
  const inputs = [
    ['currency','price','EUR','€'], ['wall_material','wall_material','brick','Кирпичный'],
    ['year_built','year_built','2025','2025']
  ];
  const controls = inputs.map(([field,,value,label]) => ({...recipe('kufar').controls.find(c=>c.field==='kufar.'+field),value,labels:{[value]:label}}));
  const f = await setup(t, inputs.map(([,name])=>`<div data-name="${name}"><div data-testid="base-dropdown-ui"><span class="dropdown_value">Выберите</span></div></div>`).join(''),controls);
  let clicks=0;
  for (const [field,name,,label] of inputs) {
    const trigger=f.doc.querySelector(`[data-name="${name}"] [data-testid="base-dropdown-ui"]`);
    trigger.onclick=()=>{
      assert.equal(f.doc.querySelectorAll('[data-testid="modal-container"]').length,0,'do not stack unresolved menus');
      const modal=f.doc.createElement('div');modal.dataset.testid='modal-container';
      modal.innerHTML=(field==='currency'?'':`<div data-testid="popup-title"><div data-name="${name}.hint"></div></div>`)+
        `<div data-testid="popup-body"><div>${label}</div></div>`;
      modal.querySelector('[data-testid="popup-body"] > div').onclick=()=>{
        clicks++;trigger.querySelector('span').textContent=label;modal.remove();
      };
      f.doc.body.append(modal);
    };
  }
  for(let i=0;i<25;i++)await f.form.tick();
  assert.equal(clicks,3);
  assert.deepEqual([...f.form.done].sort(),controls.map(c=>c.field).sort());
});

test('Realt stages mobile city and street, applies only selected suggestions and confirms the form', async t => {
  const source=recipe('realt');
  const controls=source.controls.filter(c=>['settlement','street','house'].includes(c.addressPart)).map(c=>({...c,
    value:({settlement:'Гродно',street:'Садовая',house:'15'})[c.addressPart],
    ...(c.addressPart==='street'?{streetType:'ул',matchValue:'ул. Садовая'}:{})}));
  const f=await setup(t,'<div id="location"><div class="border" role="button">Населенный пункт, район, область</div><div class="border" role="button">Улица</div></div><input id="location.houseNumber">',controls);
  let applied=0,wrong=0;
  const openers=[...f.doc.querySelectorAll('#location [role=button]')];
  openers.forEach((opener,index)=>opener.onclick=()=>{
    const sheet=f.doc.createElement('div');sheet.className='fixed bottom-0';
    sheet.innerHTML=`<p class="text-headline">${index?'Улица':'Адрес'}</p><input name="search"><ul></ul><button>Применить</button>`;
    let chosen;
    sheet.querySelector('input').oninput=()=>{
      sheet.querySelector('ul').innerHTML=index
        ? '<li><div role="button">Садовая пер.</div></li><li><div role="button">Садовая ул.</div></li><li><div role="button">Добавить: Садовая</div></li>'
        : '<li><div role="button"><p>г. Гродно</p><p>Гродненская область</p></div></li>';
      for(const option of sheet.querySelectorAll('[role=button]'))option.onclick=()=>{
        if(index&&option.textContent!=='Садовая ул.')wrong++;
        chosen=index?option.textContent:option.querySelector('p').textContent;
        queueMicrotask(()=>option.append(f.doc.createElement('svg')));
      };
    };
    sheet.querySelector('button').onclick=()=>{
      assert.ok(chosen,'must not apply an unselected query');applied++;opener.textContent=chosen;sheet.remove();
    };
    f.doc.body.append(sheet);
  });
  for(let i=0;i<30;i++)await f.form.tick();
  assert.equal(applied,2);assert.equal(wrong,0);
  assert.equal(openers[0].textContent,'г. Гродно');assert.equal(openers[1].textContent,'Садовая ул.');
  assert.equal(f.doc.getElementById('location.houseNumber').value,'15');
  assert.equal(f.form.remaining().length,0);
});

test('Realt leaves a pre-existing different mobile address unchanged', async t => {
  const c={...recipe('realt').controls.find(c=>c.addressPart==='settlement'),value:'Гродно'};
  const f=await setup(t,'<div id="location"><div class="border" role="button">г. Минск</div></div>',[c]);
  let clicked=0;f.doc.querySelector('[role=button]').onclick=()=>clicked++;
  await f.form.tick();assert.equal(clicked,0);assert.ok(f.form.protected.has(c.field));assert.ok(!f.form.done.has(c.field));
});

test('Realt does not take over a user-opened sheet while another field is pending', async t => {
  const c={...recipe('realt').controls.find(c=>c.addressPart==='settlement'),value:'Гродно'};
  const f=await setup(t,'<div id="location"><div class="border" role="button">Населенный пункт, район, область</div></div><div class="fixed bottom-0"><p class="text-headline">Адрес</p><input name="search" value="Минск"><ul></ul><button>Применить</button></div>',[c]);
  f.form.waiting={field:'another-field',tries:0,until:Date.now()+30000};
  await f.form.fill(c);
  assert.equal(f.doc.querySelector('input').value,'Минск');
  assert.equal(f.form.pending.size,0);
});
