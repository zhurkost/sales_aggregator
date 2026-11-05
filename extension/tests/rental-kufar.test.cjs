const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const recipe = JSON.parse(fs.readFileSync(path.join(__dirname,
  '../../data/rental/apartments_long_term_rent/runtime/browser_kufar.json'), 'utf8'));
const control = (field, extra = {}) => ({...recipe.controls.find(c => c.field === 'kufar.' + field), ...extra});
async function fixture(t, html, controls, photos = [], claim = async () => true) {
  const {Window} = await import('happy-dom');
  const w = new Window(); t.after(() => w.close());
  w.document.body.innerHTML = html;
  for (const file of ['rental-autocomplete.js', 'rental-form.js'])
    w.eval(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  return {w, doc: w.document, form: new w.AutopostRentalForm.Form({controls}, photos, claim)};
}

test('Kufar selects all kitchen amenities across asynchronous renders without toggling earlier choices', async t => {
  const c = control('kitchen_amenities', {value:['1','2'], labels:{1:'Холодильник',2:'СВЧ-печь'}});
  const f = await fixture(t, '', [c]);
  let chosen = new Set(), clicks = 0;
  function render() {
    f.doc.body.innerHTML = '<div data-name="flat_kitchen">' + ['1','2'].map(v =>
      `<div role="button" data-value="${v}" class="chip__${chosen.has(v)?'filled-green':'outlined'}">${c.labels[v]}</div>`).join('') + '</div>';
    for (const e of f.doc.querySelectorAll('[role="button"]')) e.onclick = () => {
      clicks++;
      const next = new Set(chosen), v = e.dataset.value;
      next.has(v) ? next.delete(v) : next.add(v);
      queueMicrotask(() => { chosen = next; render(); });
    };
  }
  render();
  for (let i=0; i<6; i++) await f.form.tick();
  assert.deepEqual([...chosen], ['1','2']);
  assert.equal(clicks, 2);
  assert.equal(f.form.done.has(c.field), true);
});

test('Kufar confirms photos by upload counter even when the file input is removed', async t => {
  const c = control('photos'); let claims = 0;
  const photos = [{name:'a.png',dataUrl:'data:image/png;base64,YQ=='}];
  const f = await fixture(t, '<div data-name="images"><span class="abc_counter">Загружено 0 из 50</span><input id="imageLoaderDropzone" type="file"></div>', [c], photos, async()=>{claims++;return true;});
  const input = f.doc.querySelector('input');
  input.onchange = () => input.remove();
  await f.form.tick();
  assert.equal(f.form.done.size, 0);
  assert.equal(f.form.awaitingPhotos(), true);
  for(let i=0;i<4;i++) await f.form.tick();
  f.doc.querySelector('span').textContent = 'Загружено 1 из 50';
  await f.form.tick(); await f.form.tick();
  assert.equal(f.form.done.has(c.field), true);
  assert.equal(f.form.awaitingPhotos(), false);
  assert.equal(claims, 1);
});

test('Kufar does not duplicate existing photos or mark a failed upload as complete', async t => {
  for (const count of [0,1]) {
    let claims=0;
    const c=control('photos');
    const f=await fixture(t, `<div data-name="images"><span class="x_counter">Загружено ${count} из 50</span><input id="imageLoaderDropzone" type="file"></div>`, [c],
      [{name:'a.png',dataUrl:'data:image/png;base64,YQ=='}], async()=>{claims++;return true;});
    f.doc.querySelector('input').onchange=()=>{f.doc.querySelector('input').value='';};
    for(let i=0;i<5;i++)await f.form.tick();
    assert.equal(f.form.done.size,0);
    assert.equal(claims,count?0:1);
  }
});

test('Kufar enters title case query and selects first suggestion without matching its text', async t => {
  const c=control('address_text',{value:'Минск Брикета 18', matchValue:'г. Минск, ул. Брикета, д. 18'});
  const f=await fixture(t, '<input id="geocoder"><div id="options"></div>', [c]);
  await f.form.tick();
  assert.equal(f.doc.querySelector('input').value,'Минск Брикета 18');
  const labels=['улица Брикета, 18, Минск','Минск Брикета 18'];
  f.doc.querySelector('#options').innerHTML=labels.map((l,i)=>`<div role="button" data-name="autocomplete-option-${i}">${l}</div>`).join('');
  let clicks=[];
  for(const e of f.doc.querySelectorAll('[role="button"]'))e.onclick=()=>{
    clicks.push(e.textContent);f.doc.querySelector('input').value=e.textContent;f.doc.querySelector('#options').replaceChildren();
  };
  for(let i=0;i<5;i++)await f.form.tick();
  assert.deepEqual(clicks,[labels[0]]);
  assert.equal(f.form.done.has(c.field),true);
});

for (const [currency, label] of [['BYR','руб.'],['USD','$'],['EUR','€']])
test(`Kufar waits for ${currency} before entering unchanged amount and leaves promotion untouched`, async t => {
  const controls=[control('price',{value:'1300'}),control('currency',{value:currency})];
  const f=await fixture(t, '<div data-name="price"><input name="price"><div data-testid="base-dropdown-ui"><span class="abc_value">$</span></div></div><button data-cy="vas-no_vas">Без продвижения</button>',controls);
  let promo=0; f.doc.querySelector('button').onclick=()=>promo++;
  f.doc.querySelector('span').textContent=currency==='USD'?'€':'$';
  f.doc.querySelector('[data-testid="base-dropdown-ui"]').onclick=()=>{
    if(f.doc.querySelector('[data-testid="dropdown-popup-ui"]')) return;
    const menu=f.doc.createElement('div');menu.dataset.testid='dropdown-popup-ui';
    menu.innerHTML='<div>руб.</div><div>$</div><div>€</div>';
    f.doc.querySelector('[data-name="price"]').append(menu);
    for(const option of menu.children)option.onclick=()=>{f.doc.querySelector('span').textContent=option.textContent;menu.remove();};
  };
  await f.form.tick();assert.equal(f.doc.querySelector('input').value,'');
  for(let i=0;i<6;i++)await f.form.tick();
  assert.equal(f.doc.querySelector('input').value,'1300');
  assert.equal(f.doc.querySelector('span').textContent,label);
  assert.equal(promo,0);
  assert.deepEqual(recipe.next,[]);assert.deepEqual(recipe.submit,[]);
});

test('Kufar supports calls and messages radio input',async t=>{
  const c=control('contact_method',{value:'0'});
  const f=await fixture(t,'<label><input type="radio" name="phone_hidden" value="0">Звонки и сообщения</label><label><input type="radio" name="phone_hidden" value="1" checked>Только сообщения</label>',[c]);
  await f.form.tick();await f.form.tick();
  assert.equal(f.doc.querySelector('[value="0"]').checked,true);
  assert.equal(f.form.done.has(c.field),true);
});

test('page waits for delayed uploads and ignores next, submit and promotion even in old automatic recipes',async t=>{
  const photos=[{name:'a.png',dataUrl:'data:image/png;base64,YQ=='}];
  const c=control('photos');
  const f=await fixture(t,'<p>К оплате: 14,10</p><div data-name="images"><span class="x_counter">Загружено 0 из 50</span><input id="imageLoaderDropzone" type="file"></div><button id="submit">Опубликовать</button>',[c]);
  const {w}=f;let tick,claims=0,submitted=0;const reports=[];
  f.doc.querySelector('input').onchange=()=>f.doc.querySelector('input').remove();
  f.doc.querySelector('#submit').onclick=()=>submitted++;
  w.setInterval=fn=>{tick=fn;return 1;};w.clearInterval=()=>{};
  w.AutopostCore={fillNavigation:()=>({type:'navigate'})};
  const task={jobId:'test',mode:'automatic',recipe:{controls:[c],next:[{selector:'#submit',text:'Опубликовать'}],submit:[{selector:'#submit',text:'Опубликовать'}]},photos};
  w.chrome={runtime:{id:'test',onMessage:{addListener(){}},async sendMessage(m){
    if(m.type==='GET')return {task};
    if(m.type==='CLAIM_PHOTOS'){claims++;return {ok:true};}
    if(m.type==='REPORT')reports.push(m.payload);
    return {};
  }}};
  await w.eval(fs.readFileSync(path.join(__dirname,'../rental-page.js'),'utf8'));
  const flush=()=>new Promise(resolve=>setImmediate(resolve));await flush();
  for(let i=0;i<12;i++){tick();await flush();}
  assert.equal(reports.at(-1).status,'running');
  f.doc.querySelector('[class="x_counter"]').textContent='Загружено 1 из 50';
  for(let i=0;i<10;i++){tick();await flush();}
  assert.equal(claims,1);assert.equal(submitted,0);
  assert.equal(reports.at(-1).status,'needs_action');
  assert.equal(reports.at(-1).remaining.includes(c.field),false);
});
