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
