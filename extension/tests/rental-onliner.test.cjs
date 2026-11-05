const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const recipe = JSON.parse(fs.readFileSync(path.join(__dirname,
  '../../data/rental/apartments_long_term_rent/runtime/browser_onliner.json'), 'utf8'));

async function fixture(t, labels, value = 'Речица', accept = true) {
  const {Window} = await import('happy-dom');
  const w = new Window(); t.after(()=>w.close());
  w.document.body.innerHTML='<input data-bind="value: $root.data.location.user_address"><div id="suggestions"></div>';
  for(const file of ['rental-autocomplete.js','rental-form.js'])
    w.eval(fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
  const source=recipe.controls.find(c=>c.field==='onliner.address_query');
  const c={...source,value,matchValue:'г. '+value,autocomplete:{...source.autocomplete,optionSelector:'.test-option'}};
  const input=w.document.querySelector('input');let searches=0;const clicks=[];
  function render(rows) {
    const container=w.document.querySelector('#suggestions');container.replaceChildren();
    for(const label of rows){
      const option=w.document.createElement('div');option.className='test-option';option.textContent=label;
      option.onclick=()=>{clicks.push(label);if(accept){input.value=label;container.replaceChildren();}};
      container.append(option);
    }
  }
  input.onkeyup=()=>{searches++;render(labels);};
  const form=new w.AutopostRentalForm.Form({controls:[c]});
  return {w,input,form,c,clicks,render,searches:()=>searches};
}

test('Onliner searches on keyup and chooses full case-insensitive match among multiple suggestions',async t=>{
  const f=await fixture(t,['Новая Речица','рЕчИцА','Речицкий район']);
  await f.form.tick();
  assert.equal(f.input.value,'Речица');assert.equal(f.searches(),1);
  for(let i=0;i<5;i++)await f.form.tick();
  assert.deepEqual(f.clicks,['рЕчИцА']);assert.equal(f.form.done.has(f.c.field),true);
});

test('Onliner chooses a sole suggestion even when its label differs',async t=>{
  const f=await fixture(t,['Речица, Гомельская область']);
  for(let i=0;i<6;i++)await f.form.tick();
  assert.deepEqual(f.clicks,['Речица, Гомельская область']);
  assert.equal(f.form.done.has(f.c.field),true);
});

test('Onliner leaves empty, partial-only and duplicate exact results for the user',async t=>{
  for(const labels of [[],['Новая Речица','Речицкий район'],['Речица','РЕЧИЦА']]){
    const f=await fixture(t,labels);
    for(let i=0;i<10;i++)await f.form.tick();
    assert.deepEqual(f.clicks,[]);assert.equal(f.form.done.size,0);
  }
  const f=await fixture(t,['Зеленый Бор','Зелёный Борок'],'Зелёный Бор');
  for(let i=0;i<6;i++)await f.form.tick();assert.deepEqual(f.clicks,[]);
});

test('Onliner waits for stable results and does not confirm rejected selections',async t=>{
  const f=await fixture(t,['Новая Речица']);
  await f.form.tick();await f.form.tick();
  f.render(['Новая Речица','Речица']);
  await f.form.tick();assert.deepEqual(f.clicks,[]);
  await f.form.tick();await f.form.tick();assert.deepEqual(f.clicks,['Речица']);
  const g=await fixture(t,['Речица'],'Речица',false);
  for(let i=0;i<10;i++)await g.form.tick();
  assert.deepEqual(g.clicks,['Речица']);assert.equal(g.form.done.size,0);
});

test('Onliner preserves an address edited manually after query started',async t=>{
  const f=await fixture(t,['Речица']);
  await f.form.tick();f.input.value='Брест';
  for(let i=0;i<5;i++)await f.form.tick();
  assert.equal(f.input.value,'Брест');assert.deepEqual(f.clicks,[]);
});
