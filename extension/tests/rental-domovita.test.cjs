const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const recipe = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/rental/apartments_long_term_rent/runtime/browser_domovita.json'), 'utf8'));
async function setup(t, values = {town:'Минск',street:'Ольшевского',house_number:'27/1'}) {
  const {Window} = await import('happy-dom');
  const w = new Window(); t.after(()=>w.close());
  const names=['town_id','street_name','house_number'];
  w.document.body.innerHTML=names.map((name,i)=>`<div id="select-${i}"><div class="custom-select__control"><input role="combobox" ${i?'disabled':''}></div><input type="hidden" name="${name}"></div>`).join('');
  for(const file of ['rental-autocomplete.js','rental-form.js'])w.eval(fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
  const controls=recipe.controls.filter(c=>c.action==='autocomplete').map(c=>({...c,value:values[c.field.split('.')[1]]}));
  controls[0].matchValue='г. '+values.town;controls[1].matchValue='ул. '+values.street;
  const form=new w.AutopostRentalForm.Form({controls});
  let clicks=[];
  function options(index, labels, accept=true) {
    const container=w.document.getElementById('select-'+index),input=container.querySelector('[role="combobox"]');
    const menu=w.document.createElement('div'); menu.setAttribute('role','listbox');container.append(menu);
    for(const label of labels){const option=w.document.createElement('div');option.setAttribute('role','option');option.textContent=label;menu.append(option);option.onclick=()=>{
      clicks.push(label);if(!accept)return;
      const display=w.document.createElement('div');display.className='custom-select__single-value';display.textContent=label;container.querySelector('.custom-select__control').append(display);input.value='';menu.remove();
      const next=w.document.querySelector(`#select-${index+1} [role="combobox"]`);if(next)next.disabled=false;
    };}
  }
  return {w,form,controls,options,clicks};
}
test('Domovita selects full city label, typed street and exact house in order; confirms cleared React Select input by display',async t=>{
  const f=await setup(t);
  f.options(0,['г. Минск МИНСКАЯ ОБЛАСТЬ Минский район','ст. Минский Водник МИНСКАЯ ОБЛАСТЬ Логойский район']);
  f.options(1,['пер. Ольшевского','ул. Ольшевского']);f.options(2,['27/1','27/2']);
  await f.form.tick();await f.form.tick();await f.form.tick();
  assert.equal(f.form.done.has('domovita.town'),false);
  assert.equal(f.w.document.querySelector('#select-1 [role="combobox"]').value,'');
  for(let i=0;i<12;i++)await f.form.tick();
  assert.deepEqual(f.clicks,['г. Минск МИНСКАЯ ОБЛАСТЬ Минский район','ул. Ольшевского','27/1']);
  assert.equal(f.form.done.size,3);
});
test('Domovita duplicate towns require region and district and wait for loading',async t=>{
  const f=await setup(t,{town:'Лесная',street:'Мира',house_number:'1'});f.controls[0].matchValue='д. Лесная';
  f.options(0,['д. Лесная БРЕСТСКАЯ ОБЛАСТЬ Ивацевичский район','д. Лесная МИНСКАЯ ОБЛАСТЬ Минский район']);
  for(let i=0;i<4;i++)await f.form.tick();assert.equal(f.clicks.length,0);
  f.controls[0].matchContext=['Брестская область','Ивацевичский район'];
  const busy=f.w.document.createElement('div');busy.className='custom-select__menu-notice--loading';f.w.document.querySelector('#select-0').append(busy);
  for(let i=0;i<3;i++)await f.form.tick();assert.equal(f.clicks.length,0);
  busy.remove();for(let i=0;i<4;i++)await f.form.tick();
  assert.deepEqual(f.clicks,['д. Лесная БРЕСТСКАЯ ОБЛАСТЬ Ивацевичский район']);
});
test('Domovita does not confirm rejected clicks or overwrite a preselected city',async t=>{
  const f=await setup(t);f.options(0,['г. Минск МИНСКАЯ ОБЛАСТЬ Минский район'],false);
  for(let i=0;i<14;i++)await f.form.tick();assert.equal(f.clicks.length,1);assert.equal(f.form.done.size,0);
  const g=await setup(t);const display=g.w.document.createElement('div');display.className='custom-select__single-value';display.textContent='г. Брест БРЕСТСКАЯ ОБЛАСТЬ Брестский район';g.w.document.querySelector('#select-0 .custom-select__control').append(display);
  await g.form.tick();assert.equal(g.form.protected.has('domovita.town'),true);assert.equal(g.w.document.querySelector('[role="combobox"]').value,'');
});
test('Domovita disabled photo dropzone does not consume claim; unlocking transfers photos once',async t=>{
  const f=await setup(t);const {w}=f;
  w.document.body.innerHTML='<div class="styles_image-upload-dropzone-disabled__Z7KvA"><input type="file" multiple style="display:none"></div>';
  let claims=0,changes=0;
  const c=recipe.controls.find(c=>c.action==='files');
  const form=new w.AutopostRentalForm.Form({controls:[c]},[{name:'photo.png',dataUrl:'data:image/png;base64,YQ=='}],async()=>{claims++;return true;});
  const input=w.document.querySelector('input');input.onchange=()=>{changes++;assert.equal(input.files[0].name,'photo.png');};
  for(let i=0;i<12;i++)await form.tick();
  assert.equal(claims,0);assert.equal(form.photoSent,false);assert.match(form.blockedReason(),/Подтвердите телефон/);assert.equal(form.done.size,0);
  input.parentElement.className='styles_image-upload-dropzone__YhG0G';
  for(let i=0;i<3;i++)await form.tick();
  assert.equal(form.blockedReason(),'');assert.equal(claims,1);assert.equal(changes,1);assert.equal(form.done.has(c.field),true);
});

test('page waits for photo verification without advancing and resumes after unlocking',async t=>{
  const f=await setup(t);const {w}=f;
  w.document.body.innerHTML='<div class="styles_image-upload-dropzone-disabled__Z7KvA"><input type="file" multiple></div><button id="next">Далее</button>';
  let next=0,claims=0,tick;const reports=[];
  w.document.querySelector('#next').onclick=()=>next++;
  w.setInterval=(fn)=>{tick=fn;return 1;};w.clearInterval=()=>{};
  w.AutopostCore={fillNavigation:()=>({type:'navigate'})};
  const task={jobId:'test',mode:'automatic',recipe:{controls:[recipe.controls.find(c=>c.action==='files')],next:[{selector:'#next',text:'Далее'}]},photos:[{name:'photo.png',dataUrl:'data:image/png;base64,YQ=='}]};
  w.chrome={runtime:{id:'test',onMessage:{addListener(){}},async sendMessage(message){
    if(message.type==='GET')return {task};
    if(message.type==='CLAIM_PHOTOS'){claims++;return {ok:true};}
    if(message.type==='REPORT')reports.push(message.payload);
    return {};
  }}};
  await w.eval(fs.readFileSync(path.join(__dirname,'../rental-page.js'),'utf8'));
  const flush=()=>new Promise(resolve=>setImmediate(resolve));await flush();
  for(let i=0;i<12;i++){tick();await flush();}
  assert.equal(claims,0);assert.equal(next,0);assert.equal(reports.at(-1).status,'needs_action');
  w.document.querySelector('input').parentElement.className='';
  for(let i=0;i<5;i++){tick();await flush();}
  assert.equal(claims,1);assert.equal(next,0);
});
