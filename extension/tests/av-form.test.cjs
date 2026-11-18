const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const bindings=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/automotive/cars_used_sale/browser-overrides.json'))).av;
async function fixture(t,html,controls){const {Window}=await import('happy-dom');const w=new Window();t.after(()=>w.close());w.document.body.innerHTML=html;w.eval(fs.readFileSync(path.join(__dirname,'../car-form.js'),'utf8'));return {w,form:new w.AutopostCarForm.Form({platform:'av',controls},[])};}
const control=(key,value,name)=>({field:'av.'+key,value,name,binding:bindings['av.'+key]});
const dropdown=(id,value,options=[])=>`<div class="form-row__item"><button class="dropdown__control ${value?'dropdown__control--active':''}" id="${id}"><span class="dropdown-button__value">${value}</span></button><div class="dropdown-list">${options.map(x=>`<button type="button" class="dropdown__listbutton">${x}</button>`).join('')}</div></div>`;
const mod=()=>({field:'av.modification',value:'1.6 AT',name:'1.6 AT',binding:{action:'choose',match:'engine_transmission',depends_on:['av.body_type','av.transmission_type','av.engine_type','av.drive_type'],target:{selectors:['button#p-7-modification']},suggestions:{selector:'#p-7-modification + .dropdown-list .dropdown__listbutton'},verify:{kind:'selected_text_equals',within_target:'.dropdown-button__value'}}});
const tech=()=>'<main><div class="newad__step">'+dropdown('p-9-body_type','седан')+'<div id="p-11-transmission_type" class="button-group"><label><input id="p-11-transmission_type_1" type="radio" checked value="1">автомат</label></div>'+dropdown('p-12-engine_type','бензин')+dropdown('p-15-drive_type','передний привод')+dropdown('p-7-modification','',['1,4 AT (100 л.с.)','1,6 MT (123 л.с.)','1,6 AT (123 л.с.)','1,6 AT (140 л.с.)'])+'<div class="newad__step-next"><button type="button">Далее</button></div></div></main>';
const controls=()=>[control('body_type',1,'седан'),control('transmission_type',1,'автомат'),control('engine_type',1,'бензин'),control('drive_type',1,'передний привод'),mod()];
const equipment=()=>'<main><div class="newad__step"><h3>Комплектация</h3><div class="chips__list"><button type="button" class="chips__item" id="ABS-1" aria-pressed="false">ABS</button><button type="button" class="chips__item" id="ESP-2" aria-pressed="false">ESP</button><button type="button" class="chips__item" id="Парктроники-11" aria-pressed="true">Парктроники</button></div><div class="newad__step-next"><button type="button">Далее</button></div></div></main>';

const priceStep=()=>'<main><div class="newad__step"><h3>Описание и цена</h3><textarea id="p-30-description"></textarea><input id="p-32-price_amount" type="number" min="50"><div class="button-group" id="p-31-price_currency"><label><input type="radio" name="currency" value="2">USD</label><label><input type="radio" name="currency" value="1">BYN</label></div><div class="button-group" id="p-34-exchange_options">'+['не интересует','любой вариант','с доплатой покупателя','с доплатой продавца'].map((name,i)=>`<label><input type="radio" name="exchange" value="${i+1}">${name}</label>`).join('')+'</div><div class="newad__step-next"><button type="button">Далее</button></div></div></main>';
const priceControls=currency=>[control('description','Продаю Kia Rio. Один владелец.','Продаю Kia Rio. Один владелец.'),control('price_amount',39500,'39500'),control('price_currency',currency,currency===1?'BYN':'USD')];
const photoStep=()=>'<main><div class="newad__step"><div id="file-uploader"><input type="file" multiple id="p-27-photo"><div class="form-inputfile__hint"><small>можно еще 30 фото</small></div><ul class="uploader__thumbs"></ul></div><input id="p-29-video_url"><div class="newad__step-next"><button type="button">Далее</button></div></div></main>';
function previews(w,count){
 w.document.querySelector('.uploader__thumbs').innerHTML=Array.from({length:count},(_,i)=>`<li class="uploader__thumb"><div class="uploader__thumb-wrap"><img src="blob:https://av.by/test-${i}"></div><button class="uploader__thumb-rotate" type="button">Повернуть</button><button class="uploader__thumb-delete" type="button">Удалить</button></li>`).join('');
 w.document.querySelector('small').textContent=`можно еще ${30-count} фото`;
 for(const img of w.document.querySelectorAll('img')){Object.defineProperty(img,'complete',{value:true,configurable:true});Object.defineProperty(img,'naturalWidth',{value:801,configurable:true});}
}
test('AV uploads once, accepts decoded local previews and the exact counter, then advances once',async t=>{
 for(const count of [1,3,30]){
  const {w,form}=await fixture(t,photoStep(),[control('video_url','https://youtu.be/test','https://youtu.be/test')]);let claims=0,uploads=0,next=0;
  form.recipe.photoBinding=bindings['av.photo'];form.photos=Array.from({length:count},(_,i)=>({name:`photo-${i}.png`,type:'image/png',dataUrl:'data:image/png;base64,AA=='}));form.claimPhotos=async()=>{claims++;return true;};
  w.document.getElementById('p-27-photo').onchange=()=>uploads++;
  w.document.querySelector('.newad__step-next button').onclick=()=>{assert.equal(w.document.getElementById('p-29-video_url').value,'https://youtu.be/test');next++;};
  for(let i=0;i<4;i++)await form.tick();assert.equal(claims,1);assert.equal(uploads,1);assert.equal(next,0);
  previews(w,count);for(let i=0;i<6;i++)await form.tick();assert(form.done.has('photos'));assert.equal(next,1);assert.equal(uploads,1);
 }
});
test('AV photo step refuses incomplete, broken, foreign, busy or conflicting previews and final buttons',async t=>{
 for(const scenario of ['missing','broken','decoding','foreign','counter','disabled-action','missing-action','busy','error','video-conflict','unknown','submit','publish']){
  const {w,form}=await fixture(t,photoStep(),scenario==='video-conflict'?[control('video_url','https://youtu.be/wanted','https://youtu.be/wanted')]:[]);
  form.recipe.photoBinding=bindings['av.photo'];form.photos=[{},{}];form.photoSent=true;previews(w,2);
  const img=w.document.querySelector('img'),button=w.document.querySelector('.newad__step-next button');
  if(scenario==='missing')w.document.querySelector('.uploader__thumb').remove();
  if(scenario==='broken')Object.defineProperty(img,'naturalWidth',{value:0});if(scenario==='decoding')Object.defineProperty(img,'complete',{value:false});
  if(scenario==='foreign')img.src='blob:https://other.example/image';if(scenario==='counter')w.document.querySelector('small').textContent='можно еще 29 фото';
  if(scenario==='disabled-action')w.document.querySelector('.uploader__thumb-delete').disabled=true;if(scenario==='missing-action')w.document.querySelector('.uploader__thumb-rotate').remove();
  if(scenario==='busy')w.document.getElementById('file-uploader').setAttribute('aria-busy','true');if(scenario==='error')button.insertAdjacentHTML('beforebegin','<div class="form-error">Ошибка</div>');
  if(scenario==='video-conflict')w.document.getElementById('p-29-video_url').value='https://youtu.be/other';
  if(scenario==='unknown')button.before(w.document.createElement('input'));if(scenario==='submit')button.type='submit';if(scenario==='publish')button.textContent='Опубликовать';
  button.onclick=()=>assert.fail(scenario);for(let i=0;i<6;i++)await form.tick();
 }
});
test('AV rechecks photos removed before transition and never claims pre-existing photos as its upload',async t=>{
 const {w,form}=await fixture(t,photoStep(),[]);form.recipe.photoBinding=bindings['av.photo'];form.photos=[{}];previews(w,1);
 form.claimPhotos=async()=>assert.fail('Do not append to existing photos');let next=0;w.document.querySelector('.newad__step-next button').onclick=()=>next++;
 for(let i=0;i<4;i++)await form.tick();assert.equal(next,0);assert(!form.done.has('photos'));
 form.photoSent=true;assert(await form.photo());w.document.querySelector('.uploader__thumb').remove();
 await form.tick();assert(!form.done.has('photos'));assert.equal(next,0);
});
test('AV price step fills both currencies, preserves unspecified exchange and advances once',async t=>{
 for(const currency of [1,2])for(const preset of [false,true]){
  const {w,form}=await fixture(t,priceStep(),priceControls(currency));let next=0;
  const exchange=w.document.querySelector('#p-34-exchange_options input');exchange.checked=preset;
  for(const e of w.document.querySelectorAll('#p-34-exchange_options input'))e.onclick=()=>assert.fail('No exchange instruction');
  w.document.querySelector('.newad__step-next button').onclick=()=>{
    assert.equal(w.document.querySelector('#p-31-price_currency input:checked').value,String(currency));
    assert.equal(w.document.getElementById('p-32-price_amount').value,'39500');
    assert.equal(w.document.querySelector('textarea').value,priceControls(currency)[0].value);next++;
  };
  for(let i=0;i<10;i++)await form.tick();assert.equal(next,1);assert.equal(exchange.checked,preset);
 }
});
test('AV price step waits for requested exchange acceptance',async t=>{
 for(const value of [1,2,3,4]){
  const {w,form}=await fixture(t,priceStep(),[...priceControls(1),control('exchange_options',value,['не интересует','любой вариант','с доплатой покупателя','с доплатой продавца'][value-1])]);let next=0;
  const exchange=w.document.querySelector(`#p-34-exchange_options input[value="${value}"]`);
  exchange.onclick=e=>e.preventDefault();w.document.querySelector('.newad__step-next button').onclick=()=>next++;
  for(let i=0;i<8;i++)await form.tick();assert.equal(next,0);
  exchange.checked=true;for(let i=0;i<6;i++)await form.tick();assert.equal(next,1);
 }
});
test('AV price step blocks absent or conflicting data, validation errors and final actions',async t=>{
 for(const scenario of ['missing-description','missing-price','missing-currency','missing-dom','conflict','currency-conflict','error','invalid','busy','disabled','required-exchange','unknown','submit','publish']){
  let cs=priceControls(1);
  const missing={'missing-description':'av.description','missing-price':'av.price_amount','missing-currency':'av.price_currency'}[scenario];if(missing)cs=cs.filter(c=>c.field!==missing);
  const {w,form}=await fixture(t,priceStep(),cs),button=w.document.querySelector('.newad__step-next button');
  if(scenario==='missing-dom')w.document.querySelector('textarea').remove();
  if(scenario==='conflict')w.document.getElementById('p-32-price_amount').value='42000';
  if(scenario==='currency-conflict'){const input=w.document.querySelector('#p-31-price_currency input[value="1"]');input.onclick=e=>e.preventDefault();}
  if(scenario==='error')button.insertAdjacentHTML('beforebegin','<div class="form-error">Ошибка</div>');
  if(scenario==='invalid')w.document.querySelector('textarea').setAttribute('aria-invalid','true');
  if(scenario==='busy')button.closest('.newad__step').setAttribute('aria-busy','true');
  if(scenario==='disabled')button.disabled=true;
  if(scenario==='required-exchange')w.document.querySelector('#p-34-exchange_options input').required=true;
  if(scenario==='unknown')button.before(w.document.createElement('input'));
  if(scenario==='submit')button.type='submit';if(scenario==='publish')button.textContent='Опубликовать';
  button.onclick=()=>assert.fail(scenario);for(let i=0;i<10;i++)await form.tick();
 }
});

test('AV registration fills country and status and advances only after acceptance',async t=>{
 for(const status of [1,2]){
  const cs=[control('registration_country',2,'Беларусь'),control('registration_status',status,status===1?'на учёте в ГАИ':'снят с учёта')];
  const html='<main><div class="newad__step"><h3>Информация о регистрации</h3>'+dropdown('p-17-registration_country','',['Беларусь','Россия','Другая страна'])+'<div id="p-18-registration_status" class="button-group"><label><input type="radio" name="registration" value="1">на учёте в ГАИ</label><label><input type="radio" name="registration" value="2">снят с учёта</label></div><div class="newad__step-next"><button type="button">Далее</button></div></div></main>';
  const {w,form}=await fixture(t,html,cs);let next=0,countryClicks=0;
  w.document.querySelector('.dropdown__listbutton').onclick=()=>countryClicks++;
  w.document.querySelector('.newad__step-next button').onclick=()=>next++;
  for(let i=0;i<5;i++)await form.tick();assert.equal(countryClicks,1);assert.equal(next,0);
  w.document.querySelector('.dropdown-button__value').textContent='Беларусь';
  for(let i=0;i<7;i++)await form.tick();assert.equal(w.document.querySelector('input:checked')?.value,String(status));assert.equal(next,1);
 }
});
test('AV registration refuses missing data, conflicting selections, errors and final buttons',async t=>{
 for(const scenario of ['missing','country-conflict','status-conflict','error','disabled','submit','publish']){
  const cs=scenario==='missing'?[]:[control('registration_country',2,'Беларусь'),control('registration_status',1,'на учёте в ГАИ')];
  const html='<main><div class="newad__step">'+dropdown('p-17-registration_country',scenario==='country-conflict'?'Россия':'Беларусь')+'<div id="p-18-registration_status" class="button-group"><input type="radio" checked value="'+(scenario==='status-conflict'?2:1)+'"></div><div class="newad__step-next"><button type="button">Далее</button></div></div></main>';
  const {w,form}=await fixture(t,html,cs),button=w.document.querySelector('.newad__step-next button');
  if(scenario==='error')button.insertAdjacentHTML('beforebegin','<div class="form-error">Ошибка</div>');
  if(scenario==='disabled')button.disabled=true;if(scenario==='submit')button.type='submit';if(scenario==='publish')button.textContent='Опубликовать';
  button.onclick=()=>assert.fail(scenario);for(let i=0;i<6;i++)await form.tick();
 }
});

test('AV equipment uses native codes, waits for acceptance and preserves additional manual options',async t=>{
 const c=control('options',[{value:1,name:'Renamed ABS'},{value:2,name:'ESP'}],'Комплектация');
 const {w,form}=await fixture(t,equipment(),[c]);let next=0,abs=0;
 w.document.getElementById('ABS-1').onclick=()=>abs++;
 w.document.getElementById('ESP-2').onclick=e=>e.currentTarget.setAttribute('aria-pressed','true');
 w.document.getElementById('Парктроники-11').onclick=()=>assert.fail('Keep manual selection');
 w.document.querySelector('.newad__step-next button').onclick=()=>next++;
 for(let i=0;i<4;i++)await form.tick();assert.equal(abs,1);assert.equal(next,0);assert.equal(w.document.getElementById('ESP-2').getAttribute('aria-pressed'),'true');
 w.document.getElementById('ABS-1').setAttribute('aria-pressed','true');
 for(let i=0;i<5;i++)await form.tick();assert.equal(next,1);assert(form.done.has('av.options'));assert.equal(w.document.getElementById('Парктроники-11').getAttribute('aria-pressed'),'true');
});
test('AV equipment advances once with no supplied options without changing any selection',async t=>{
 for(const cs of [[],[control('options',[],'Комплектация')]]){
  const {w,form}=await fixture(t,equipment(),cs);let next=0;
  for(const chip of w.document.querySelectorAll('.chips__item'))chip.onclick=()=>assert.fail('No options requested');
  w.document.querySelector('.newad__step-next button').onclick=()=>next++;
  for(let i=0;i<5;i++)await form.tick();assert.equal(next,1);
 }
});
test('AV equipment continues other choices while an earlier choice is unavailable',async t=>{
 for(const scenario of ['missing','duplicate','disabled']){
  const {w,form}=await fixture(t,equipment(),[control('options',[{value:1,name:'ABS'},{value:2,name:'ESP'}],'Комплектация')]);
  const abs=w.document.getElementById('ABS-1'),esp=w.document.getElementById('ESP-2');let clicks=0;
  if(scenario==='missing')abs.remove();if(scenario==='duplicate')abs.after(abs.cloneNode(true));if(scenario==='disabled')abs.disabled=true;
  esp.onclick=()=>{clicks++;esp.setAttribute('aria-pressed','true');};
  w.document.querySelector('.newad__step-next button').onclick=()=>assert.fail('Unconfirmed equipment must block Next');
  for(let i=0;i<5;i++)await form.tick();assert.equal(clicks,1);assert.equal(form.done.has('av.options'),false);
 }
});
test('AV fills every catalog equipment code once, including overlapping numeric suffixes',async t=>{
 const runtime=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/automotive/cars_used_sale/runtime.json')));
 const options=runtime.sourceFields['av.options'].options;
 assert.equal(new Set(options.map(o=>o.value)).size,options.length);
 const html='<main><div class="newad__step"><h3>Комплектация</h3>'+options.map(o=>`<button type="button" class="chips__item" id="option-${o.value}" aria-pressed="false">${o.name}</button>`).join('')+'<div class="newad__step-next"><button type="button">Далее</button></div></div></main>';
 const {w,form}=await fixture(t,html,[control('options',options,'Комплектация')]);let next=0;const clicked=[];
 for(const chip of w.document.querySelectorAll('.chips__item'))chip.onclick=()=>{clicked.push(chip.id);chip.setAttribute('aria-pressed','true');};
 w.document.querySelector('.newad__step-next button').onclick=()=>{assert.equal(clicked.length,options.length);next++;};
 for(let i=0;i<options.length+5;i++)await form.tick();
 assert.equal(new Set(clicked).size,options.length);assert.equal(clicked.length,options.length);assert.equal(next,1);assert(form.done.has('av.options'));
});
test('AV equipment blocks missing, duplicate, disabled or manually protected choices and final buttons',async t=>{
 for(const scenario of ['missing','duplicate','disabled','protected','error','submit','publish']){
  const {w,form}=await fixture(t,equipment(),[control('options',[{value:1,name:'ABS'}],'Комплектация')]);const chip=w.document.getElementById('ABS-1'),next=w.document.querySelector('.newad__step-next button');
  if(scenario==='missing')chip.remove();if(scenario==='duplicate')chip.after(chip.cloneNode(true));if(scenario==='disabled')chip.disabled=true;if(scenario==='protected')form.protect(chip);
  if(scenario==='error')next.insertAdjacentHTML('beforebegin','<div class="form-error">Ошибка</div>');
  if(scenario==='submit')next.type='submit';if(scenario==='publish')next.textContent='Опубликовать';
  next.onclick=()=>assert.fail(scenario);for(let i=0;i<5;i++)await form.tick();
 }
});

test('AV accepts matching modification before advancing technical step exactly once',async t=>{
 const {w,form}=await fixture(t,tech(),controls());let next=0,chosen='';
 const trigger=w.document.getElementById('p-7-modification');
 for(const option of trigger.nextElementSibling.children)option.onclick=()=>{chosen=option.textContent;};
 w.document.querySelector('.newad__step-next button').onclick=()=>next++;
 for(let i=0;i<4;i++)await form.tick();assert.equal(chosen,'1,6 AT (123 л.с.)');assert.equal(next,0,'Click is not acceptance');
 trigger.firstElementChild.textContent=chosen;
 for(let i=0;i<5;i++)await form.tick();assert.equal(next,1);assert(form.done.has('av.modification'));
});
test('AV blocks Next for conflicts, errors, empty fields, disabled controls and final buttons',async t=>{
 for(const scenario of ['conflict','error','empty','unknown','disabled','submit','publish','duplicate']){
  const {w,form}=await fixture(t,tech(),controls());const next=w.document.querySelector('.newad__step-next button');
  w.document.querySelector('#p-7-modification span').textContent='1,6 AT (123 л.с.)';
  if(scenario==='conflict')w.document.querySelector('#p-7-modification span').textContent='1,6 MT (123 л.с.)';
  if(scenario==='error')next.insertAdjacentHTML('beforebegin','<div class="error-message">Ошибка</div>');
  if(scenario==='empty'){w.document.querySelector('#p-7-modification span').textContent='';w.document.getElementById('p-7-modification').nextElementSibling.remove();}
  if(scenario==='unknown')next.closest('.newad__step').insertAdjacentHTML('afterbegin','<input id="p-999-unknown">');
  if(scenario==='disabled')next.disabled=true;
  if(scenario==='submit')next.type='submit';
  if(scenario==='publish')next.textContent='Опубликовать';
  if(scenario==='duplicate')next.after(next.cloneNode(true));
  for(const button of w.document.querySelectorAll('.newad__step-next button'))button.onclick=()=>assert.fail(scenario);
  for(let i=0;i<5;i++)await form.tick();
 }
});
test('AV skips absent VIN once on technical and standalone steps without filling or clearing it',async t=>{
 for(const technical of [false,true]){
  const html=technical?tech().replace('<div class="newad__step-next">','<input id="p-26-vin" required><div class="newad__step-next">'):'<main><div class="newad__step"><input id="p-26-vin" required><div class="newad__step-next"><button type="button">Далее</button></div></div></main>';
  const {w,form}=await fixture(t,html,technical?controls():[]);let next=0;
  if(technical)w.document.querySelector('#p-7-modification span').textContent='1,6 AT (123 л.с.)';
  w.document.querySelector('.newad__step-next button').onclick=()=>next++;
  for(let i=0;i<6;i++)await form.tick();assert.equal(next,1);assert.equal(w.document.getElementById('p-26-vin').value,'');
 }
});
test('AV fills supplied VIN before Next and stops on conflicts or site validation errors',async t=>{
 for(const scenario of ['supplied','conflict','error']){
  const cs=scenario==='error'?[]:[control('vin','TESTVIN1234567890','TESTVIN1234567890')];
  const {w,form}=await fixture(t,'<main><div class="newad__step"><input id="p-26-vin" required><div class="newad__step-next"><button type="button">Далее</button></div></div></main>',cs);let next=0;
  const vin=w.document.getElementById('p-26-vin');
  if(scenario==='conflict')vin.value='OTHER';
  if(scenario==='error'){vin.setAttribute('aria-invalid','true');vin.insertAdjacentHTML('afterend','<div class="form-error">Укажите VIN</div>');}
  w.document.querySelector('button').onclick=()=>{assert.equal(vin.value,'TESTVIN1234567890');next++;};
  for(let i=0;i<6;i++)await form.tick();assert.equal(next,scenario==='supplied'?1:0);
 }
});

test('AV fills condition and verifies mileage, color and interior before advancing once',async t=>{
 const cs=[control('condition',2,'с пробегом'),control('mileage',135976,'135976'),control('mileage_unit',1,'км'),control('color',1,'черный'),control('interior_material',1,'ткань'),control('interior_color',2,'тёмный')];
 const html='<main><div class="newad__step">'+dropdown('p-16-condition','',['с пробегом','аварийный','на запчасти'])+'<input id="p-20-mileage" value="135976"><div id="p-21-mileage_unit" class="button-group"><label><input type="radio" value="1" checked>км</label></div>'+dropdown('p-23-color','чёрный')+dropdown('p-24-interior_material','ткань')+'<div id="p-25-interior_color" class="button-group"><label><input type="radio" value="2" checked>тёмный</label></div><div class="newad__step-next"><button type="button">Далее</button></div></div></main>';
 const {w,form}=await fixture(t,html,cs);let next=0,selected=0;const condition=w.document.getElementById('p-16-condition');
 condition.nextElementSibling.firstElementChild.onclick=()=>selected++;
 w.document.querySelector('.newad__step-next button').onclick=()=>next++;
 for(let i=0;i<4;i++)await form.tick();assert.equal(selected,1);assert.equal(next,0,'Wait for the site to accept condition');
 condition.firstElementChild.textContent='с пробегом';
 w.document.getElementById('p-20-mileage').value='999';
 for(let i=0;i<4;i++)await form.tick();assert.equal(next,0,'Do not advance with conflicting mileage');
 w.document.getElementById('p-20-mileage').value='135976';
 for(let i=0;i<5;i++)await form.tick();assert.equal(next,1);for(const c of cs)assert(form.done.has(c.field),c.field);
});

test('AV later dropdowns and numeric fields use native controls, units before values, without Next',async t=>{
 const cs=[control('mileage',12345,'12345'),control('mileage_unit',1,'км'),control('color',1,'черный'),control('description','Текст объявления','Текст объявления'),control('phone_number','291112233','291112233')];
 const html='<main><div class="newad__step"><input id="p-20-mileage"><div class="button-group" id="p-21-mileage_unit"><label><input type="radio" value="1">км</label><label><input type="radio" value="2">мили</label></div>'+dropdown('p-23-color','',['черный','белый'])+'<textarea id="p-30-description"></textarea><input id="p-41-0-40-phone_number"><div class="newad__step-next"><button type="button">Далее</button></div></div></main>';
 const {w,form}=await fixture(t,html,cs);
 const color=w.document.getElementById('p-23-color');color.nextElementSibling.firstElementChild.onclick=()=>color.firstElementChild.textContent='черный';
 w.document.querySelector('.newad__step-next button').onclick=()=>assert.fail('Unreviewed step');
 await form.tick();assert.equal(w.document.getElementById('p-20-mileage').value,'');
 for(let i=0;i<8;i++)await form.tick();for(const c of cs)assert(form.done.has(c.field),c.field);
 assert.equal(w.document.getElementById('p-20-mileage').value,'12345');assert.equal(w.document.querySelector('textarea').value,'Текст объявления');
});
