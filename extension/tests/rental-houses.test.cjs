const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const recipe = p => JSON.parse(fs.readFileSync(path.join(__dirname,
  '../../data/rental/houses_long_term_rent/runtime/browser_' + p + '.json'), 'utf8'));
async function windowFor(t, html) {
  const {Window} = await import('happy-dom');
  const w = new Window(); t.after(() => w.close()); w.document.body.innerHTML = html;
  for (const file of ['rental-autocomplete.js', 'rental-form.js'])
    w.eval(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  return w;
}

test('Domovita house sale waits for the selected category using its sibling label', async t => {
  const r = JSON.parse(fs.readFileSync(path.join(__dirname,
    '../../data/rental/houses_sale/runtime/browser_domovita.json'), 'utf8'));
  const w = await windowFor(t, '<input id="sale" name="action" type="radio" value="sale" checked><label for="sale">Продаже</label><input id="house" name="type" type="radio" value="cottages"><label for="house">Коттеджи/Дома</label><input id="dacha" name="type" type="radio" value="dacha" checked><label for="dacha">Дачи</label><input name="area_total">');
  r.setup = [];
  r.controls = [{...r.controls.find(c => c.field === 'domovita.area_total'),value:'160'}];
  const form = new w.AutopostRentalForm.Form(r);
  await form.tick();
  assert.equal(form.ready(), false);
  assert.equal(w.document.querySelector('[name="area_total"]').value, '');
  w.document.querySelector('#house').checked = true;
  await form.tick();
  assert.equal(form.ready(), true);
  assert.equal(w.document.querySelector('[name="area_total"]').value, '160');
  w.document.querySelector('#dacha').checked = true;
  r.ready[1].text = 'Дачи';
  assert.equal(new w.AutopostRentalForm.Form(r).ready(), true);
});

test('house choices on Domovita are scoped by heading even when inputs have no name or value', async t => {
  const rows = [{id:'rooms',heading:'Количество комнат',labels:['3','4'],value:4,wanted:'4'},
    {id:'gas',heading:'Газ',labels:['В доме','Нет'],value:0,wanted:'Нет'},
    {id:'electro',heading:'Электричество',labels:['Есть','Нет'],value:1,wanted:'Есть'}];
  const html = rows.map(r => `<div class="form-item-horizontal"><label class="form-item-label"><span>${r.heading}</span></label><div>${r.labels.map(label => `<label aria-hidden="true"><input type="checkbox" hidden value=""><p>${label}</p></label>`).join('')}</div></div>`).join('');
  const w = await windowFor(t, html);
  for (const label of w.document.querySelectorAll('label[aria-hidden]'))
    label.getBoundingClientRect = () => ({width:100,height:30});
  const controls = rows.map(r => ({...recipe('domovita').controls.find(c => c.field === 'domovita.' + r.id),
    value:r.value, labels:{[r.value]:r.wanted}}));
  const form = new w.AutopostRentalForm.Form({controls});
  for(let i=0;i<8;i++) await form.tick();
  assert.equal(form.done.size, 3);
  assert.deepEqual([...w.document.querySelectorAll('input:checked')].map(e => e.closest('label').textContent), ['4','Нет','Есть']);
});

test('Kufar accepts a house address before deal selection but does not fill another category', async t => {
  const w = await windowFor(t, '<div data-testid="name_selected_category">Дома, агроусадьбы, коттеджи</div><input id="geocoder">');
  const r = recipe('kufar');
  r.controls = [{...r.controls.find(c => c.field === 'kufar.address'),value:'Минск Садовая 10'}];
  const form = new w.AutopostRentalForm.Form(r);
  await form.tick();
  assert.equal(w.document.querySelector('input').value, 'Минск Садовая 10');
  w.document.querySelector('input').value='';
  w.document.querySelector('div').textContent='Автомобили';
  await new w.AutopostRentalForm.Form(r).tick();
  assert.equal(w.document.querySelector('input').value, '');
});

test('all house adapters leave next steps and final submission to the user', () => {
  for (const p of ['realt','kufar','domovita','onliner']) {
    assert.deepEqual(recipe(p).next, []);
    assert.deepEqual(recipe(p).submit, []);
  }
});

test('Kufar house setup uses category 1020 despite changes to its display name', async t => {
  for (const title of ['Дома, дачи, коттеджи', 'Дома, агроусадьбы, коттеджи']) {
    const w = await windowFor(t, `<ul><li data-testid="sub-category-1020">${title}</li><li data-testid="sub-category-1010">Квартиры</li></ul>`);
    const clicks = [];
    w.document.addEventListener('click', e => clicks.push(e.target.dataset.testid));
    await new w.AutopostRentalForm.Form(recipe('kufar')).tick();
    assert.deepEqual(clicks, ['sub-category-1020']);
  }
});

test('Kufar house dropdowns select only their own modal when several dialogs are mounted', async t => {
  const w = await windowFor(t, ['house_rent_rooms','house_rent_couchettes'].map(name =>
    `<div data-name="${name}"><div data-testid="base-dropdown-ui"><span class="x_value">Выберите</span></div></div>
     <div data-testid="modal-container"><div data-testid="popup-title"><div data-name="${name}.hint"></div></div><div data-testid="popup-body"><div>5</div><div>8</div></div></div>`).join(''));
  const clicks=[];
  for (const modal of w.document.querySelectorAll('[data-testid="modal-container"]')) {
    const name=modal.querySelector('[data-name]').dataset.name.replace('.hint','');
    for(const option of modal.querySelectorAll('[data-testid="popup-body"] > div')) option.onclick=()=>{
      clicks.push(name+':'+option.textContent);
      w.document.querySelector(`[data-name="${name}"] .x_value`).textContent=option.textContent;
      modal.remove();
    };
  }
  const controls=['house_rent_rooms','house_rent_couchettes'].map((name,i)=>({
    ...recipe('kufar').controls.find(c=>c.field==='kufar.'+name),value:i?8:5}));
  const form=new w.AutopostRentalForm.Form({controls,oneChangePerTick:true});
  for(let i=0;i<6;i++) await form.tick();
  assert.deepEqual(clicks,['house_rent_rooms:5','house_rent_couchettes:8']);
  assert.equal(form.done.size,2);
});

test('Realt house furniture uses its switch and leaves other switches untouched', async t => {
  const w = await windowFor(t, '<section id="additional"><button role="switch" aria-checked="false">Мебель</button><button role="switch" aria-checked="false">Другое</button></section>');
  const switches = [...w.document.querySelectorAll('[role="switch"]')];
  for (const button of switches) button.onclick = () => button.setAttribute('aria-checked', String(button.getAttribute('aria-checked') !== 'true'));
  const c = recipe('realt').controls.find(c => c.field === 'realt.additional.furniture');
  for (const value of [true, false]) {
    const form = new w.AutopostRentalForm.Form({controls:[{...c,value}]});
    for (let i=0;i<5;i++) await form.tick();
    assert.equal(form.done.has(c.field), true);
    assert.equal(switches[0].getAttribute('aria-checked'), String(value));
    assert.equal(switches[1].getAttribute('aria-checked'), 'false');
  }
});

test('Kufar reports a visible login requirement and resumes when the form becomes available', async t => {
  const w = await windowFor(t, '<button><span>Войти или зарегистрироваться</span></button>');
  let tick;
  const reports=[];
  w.setInterval=fn=>{tick=fn;return 1;};w.clearInterval=()=>{};
  w.AutopostCore={fillNavigation:()=>({type:'navigate'})};
  const task={jobId:'house-login',categoryId:'houses_long_term_rent',photos:[],recipe:{platform:'kufar',ready:[{selector:'#ready'}],controls:[{field:'price',action:'text',selector:'#price',value:'1900'}]}};
  w.chrome={runtime:{id:'test',onMessage:{addListener(){}},async sendMessage(m){
    if(m.type==='GET')return {task};
    if(m.type==='REPORT')reports.push(m.payload);
    return {ok:true};
  }}};
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  await w.eval(fs.readFileSync(path.join(__dirname,'../rental-page.js'),'utf8'));
  await flush();
  assert.equal(reports.at(-1).status,'needs_action');
  assert.match(reports.at(-1).message,/Войдите.*Kufar/);
  w.document.body.innerHTML='<div id="ready"><input id="price"></div>';
  for(let i=0;i<3;i++){tick();await flush();}
  assert.equal(w.document.querySelector('#price').value,'1900');
});
