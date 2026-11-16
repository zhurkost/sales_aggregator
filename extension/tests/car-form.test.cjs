const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
async function fixture(t,html,controls){const {Window}=await import('happy-dom');const w=new Window();t.after(()=>w.close());w.document.body.innerHTML=html;w.eval(fs.readFileSync(path.join(__dirname,'../car-form.js'),'utf8'));return {w,form:new w.AutopostCarForm.Form({platform:'abw',controls},[],async()=>true)};}
test('cars preserve existing values and trusted edits and do not submit',async t=>{
 const controls=[{field:'abw.mileage',label:'Пробег',value:12345,name:'12345'},{field:'abw.description',label:'Описание',value:'new',name:'new'}];
 const {w,form}=await fixture(t,'<input placeholder="Пробег"><textarea placeholder="Описание">existing</textarea><button type="submit">Опубликовать</button>',controls);
 let submitted=0;w.document.querySelector('button').onclick=()=>submitted++;
 await form.tick();await form.tick();assert.equal(w.document.querySelector('input').value,'12345');assert.equal(w.document.querySelector('textarea').value,'existing');assert.equal(form.done.has('abw.mileage'),true);assert.equal(form.done.has('abw.description'),false);assert.equal(submitted,0);
 w.document.querySelector('input').value='999';form.protect(w.document.querySelector('input'));await form.tick();assert.equal(w.document.querySelector('input').value,'999');assert.equal(form.done.has('abw.mileage'),false);
});
test('cars reject ambiguous labels and choose only exact native radio code',async t=>{
 const c={field:'onliner.model',label:'Модель',value:884,name:'Rio',binding:{status:'ready',action:'choose',match:'value',target:{selectors:['.vehicle-form']},suggestions:{selector:'input[name=model]'},verify:{kind:'value_equals',target:{selectors:['input[name=model]:checked']}}}};
 const {w,form}=await fixture(t,'<div class="vehicle-form"><label><input name="model" type="radio" value="884">Rio</label><label><input name="model" type="radio" value="999">Rio X</label></div><input placeholder="Цена"><input placeholder="Цена">',[c,{field:'abw.price',label:'Цена',value:20,name:'20'}]);
 await form.tick();await form.tick();assert.equal(w.document.querySelector('input:checked').value,'884');assert.equal(form.done.has(c.field),true);assert.deepEqual([...w.document.querySelectorAll('[placeholder]')].map(e=>e.value),['','']);
});
test('car jobs accept only category-specific origins and no automatic transitions',()=>{
 const core=require('../rental-core.js'),job={platform:'av',startUrl:'https://av.by/offer/draft/cars',contract:'cars-v1',format:1,controls:[],ready:[{selector:'body'}],setup:[],next:[],submit:[]};
 const payload={categoryId:'cars_used_sale',profileId:'owner',id:'card',revision:1,mode:'assist',jobs:[job],photos:[]};assert.doesNotThrow(()=>core.validate(payload));
 assert(core.origin('av','https://av.by/offer/draft/cars','cars_used_sale'));assert(!core.origin('onliner','https://ab.onliner.by/create','apartments_sale'));
 job.submit.push({action:'click',selector:'button',text:'Опубликовать'});assert.throws(()=>core.validate(payload));
});
test('cars select exact checkbox sets and preserve existing foreign selections',async t=>{
 const c={field:'onliner.options',label:'Опции',value:[{value:'abs',name:'ABS'},{value:'esp',name:'ESP'}],binding:{action:'choose',target:{selectors:['#choices']},suggestions:{selector:'#choices label',checkbox_selector:'input[type=checkbox]'}}};
 const {w,form}=await fixture(t,'<div id="choices"><label><input type="checkbox">ABS</label><label><input type="checkbox">ESP</label><label><input type="checkbox">Other</label></div>',[c]);
 await form.tick();await form.tick();await form.tick();assert.equal(w.document.querySelectorAll('input:checked').length,2);assert(form.done.has(c.field));
 const other=w.document.querySelectorAll('input')[2];other.checked=true;form.protect(other);await form.tick();assert.equal(w.document.querySelectorAll('input:checked').length,3);assert(!form.done.has(c.field));
});
test('car photos need loaded server previews and a matching accepted counter',async t=>{
 const {w,form}=await fixture(t,'<input><div id="photos"><span><img src="https://photos.example/1.jpg"></span><span><img src="blob:pending"></span></div><b id="counter">2 / 30</b>',[]);
 form.photos=[{},{}];form.photoSent=true;form.recipe.photoBinding={verify:{target:{selectors:['#photos']},items_selector:'span',image_selector:'img',accepted_src_prefix:'https://photos.example/',counter_target:{selectors:['#counter']}}};
 for(const img of w.document.querySelectorAll('img')){Object.defineProperty(img,'complete',{value:true});Object.defineProperty(img,'naturalWidth',{value:20});}
 assert.equal(await form.photo(),false);assert(!form.done.has('photos'));
 w.document.querySelectorAll('img')[1].src='https://photos.example/2.jpg';w.document.querySelector('#counter').textContent='1 / 30';assert.equal(await form.photo(),false);
 w.document.querySelector('#counter').textContent='2 / 30';assert.equal(await form.photo(),true);assert(form.done.has('photos'));assert.equal(await form.photo(),false);
});
test('ABW opens manual entry once only when both card and page VIN are empty',async t=>{
 for(const scenario of ['empty','card-vin','typed-vin','protected','other-platform','ambiguous']){
  const controls=scenario==='card-vin'?[{field:'abw.vin',value:'EXISTINGVIN'}]:[];
  const {w,form}=await fixture(t,'<input placeholder="VIN номер"><button>Далее</button><button>Заполнить вручную</button><button>Опубликовать</button>',controls);
  if(scenario==='typed-vin')w.document.querySelector('input').value='USERVIN';
  if(scenario==='protected')form.protect(w.document.querySelector('input'));
  if(scenario==='other-platform')form.recipe.platform='av';
  if(scenario==='ambiguous')w.document.body.insertAdjacentHTML('beforeend','<button>Заполнить вручную</button>');
  const clicks=[];for(const b of w.document.querySelectorAll('button'))b.onclick=()=>clicks.push(b.textContent);
  await form.tick();await form.tick();assert.deepEqual(clicks,scenario==='empty'?['Заполнить вручную']:[],scenario);
 }
});
test('Onliner verifies removed identity radios using exact step-header names before filling model',async t=>{
 const binding=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/parsing/cars_used_sale/binding_cars_used_sale_onliner.json'),'utf8'));
 const controls=[{field:'onliner.manufacturer',value:1,name:'BMW'},{field:'onliner.model',value:7,name:'7 серия'}].map(c=>({...c,binding:binding.fields.find(b=>b.option_id===c.field)}));
 const {w,form}=await fixture(t,'<div class="vehicle-form"><div class="vehicle-form__intro-list"><div class="vehicle-form__intro-item"><div class="vehicle-form__description"><a>BMW</a></div></div></div><label><input type="radio" name="model" value="7">7 серия</label></div>',controls);
 form.recipe.platform='onliner';await form.tick();await form.tick();assert(form.done.has('onliner.manufacturer'));assert(form.done.has('onliner.model'));
 w.document.querySelector('.vehicle-form').insertAdjacentHTML('beforeend','<div class="vehicle-form__intro-list"><div class="vehicle-form__intro-item"><div class="vehicle-form__description">Внешний вид и комплектация</div></div></div>');
 await form.tick();assert(form.done.has('onliner.manufacturer'),'Other step headers do not invalidate the selected brand');
 w.document.querySelector('a').textContent='BMW Alpina';w.document.querySelector('input').checked=false;await form.tick();assert(!form.done.has('onliner.manufacturer'));assert(!w.document.querySelector('input').checked);
});
test('AV enters the used-car form once without choosing new cars or publishing',async t=>{
 const {w,form}=await fixture(t,'<a>Автомобиль с пробегом <span>1 бесплатное объявление и до 5 платных</span></a><a>Новый автомобиль</a><button>Подать объявление</button>',[]);
 const clicks=[];for(const e of w.document.querySelectorAll('a,button'))e.onclick=()=>clicks.push(e.textContent);
 await form.tick();assert.equal(clicks.length,0);form.recipe.platform='av';assert.equal(form.ready(),false);
 await form.tick();await form.tick();assert.equal(clicks.length,1);assert.match(clicks[0],/^Автомобиль с пробегом/);
});

test('AV never reopens the used-car breadcrumb and recognizes labelled hidden radio controls',async t=>{
 const {w,form}=await fixture(t,'<button class="newad__breadcrumb-button">Автомобиль с пробегом</button><label for="catalogItem-brand_545"><input style="display:none" id="catalogItem-brand_545" type="radio">Kia</label>',[]);
 form.recipe.platform='av';
 w.document.querySelector('button').onclick=()=>assert.fail('Breadcrumb resets the selected car');
 assert(form.ready(),'The visible label makes the catalog usable even when the native radio is hidden');
 await form.tick();await form.tick();
 w.document.querySelector('label').hidden=true;assert.equal(form.ready(),false,'A hidden catalog is not usable');
});

test('AV chooses a brand by native catalog ID, verifies it and never clicks the breadcrumb',async t=>{
 const binding=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/automotive/cars_used_sale/browser-overrides.json'))).av['av.brand'];
 const control={field:'av.brand',label:'Марка',fieldType:'enum',value:545,name:'Kia',binding};
 const {w,form}=await fixture(t,'<main><button class="newad__breadcrumb-button">Автомобиль с пробегом</button><ul class="catalog__items"><li><label for="catalogItem-brand_545"><input class="catalog__control" style="display:none" id="catalogItem-brand_545" name="catalogItem-brand_545" type="radio">Kia</label></li><li><label><input class="catalog__control" id="catalogItem-brand_8" type="radio">Kia</label></li></ul></main>',[control]);
 form.recipe.platform='av';w.document.querySelector('button').onclick=()=>assert.fail('Do not reset the form');
 await form.tick();await form.tick();assert(w.document.getElementById('catalogItem-brand_545').checked);assert(!w.document.getElementById('catalogItem-brand_8').checked);assert(form.done.has('av.brand'));
 w.document.querySelector('ul').remove();w.document.querySelector('main').insertAdjacentHTML('beforeend','<button class="newad__breadcrumb-button">Kia</button><input placeholder="Модель">');
 for(const b of w.document.querySelectorAll('button'))b.onclick=()=>assert.fail('Never click selected identity breadcrumbs');
 await form.tick();assert(form.done.has('av.brand'),'Keep the prerequisite when the catalog is replaced by the model step');
 w.document.querySelectorAll('button')[1].textContent='BMW';await form.tick();assert(!form.done.has('av.brand'));
});

test('AV preserves an existing brand and rejects absent or duplicate native IDs',async t=>{
 const binding=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/automotive/cars_used_sale/browser-overrides.json'))).av['av.brand'];
 for(const scenario of ['existing','absent','duplicate']){
  const {w,form}=await fixture(t,'<main><label><input class="catalog__control" id="catalogItem-brand_8" type="radio">BMW</label><label><input class="catalog__control" id="catalogItem-brand_545" type="radio">Kia</label></main>',[{field:'av.brand',label:'Марка',fieldType:'enum',value:545,name:'Kia',binding}]);
  form.recipe.platform='av';
  if(scenario==='existing')w.document.getElementById('catalogItem-brand_8').checked=true;
  if(scenario==='absent')w.document.getElementById('catalogItem-brand_545').remove();
  if(scenario==='duplicate')w.document.querySelector('main').insertAdjacentHTML('beforeend','<label><input class="catalog__control" id="catalogItem-brand_545" type="radio">Kia</label>');
  for(const e of w.document.querySelectorAll('input'))e.onclick=()=>assert.fail(scenario);
  await form.tick();await form.tick();assert(!form.done.has('av.brand'));
 }
});
test('Kufar enters only an empty car category and waits for each dependent choice',async t=>{
 const {w,form}=await fixture(t,'<button data-testid="ain-show-all-categories">Выбрать категорию</button><button>Опубликовать</button>',[]);form.recipe.platform='kufar';
 const clicked=[];w.document.querySelector('button').onclick=()=>{clicked.push('open');w.document.body.insertAdjacentHTML('beforeend','<ul data-testid="kufar-chose-category-popup"><li>Авто и запчасти</li><li>Недвижимость</li></ul>');w.document.querySelector('li').onclick=()=>{clicked.push('parent');w.document.querySelector('ul').innerHTML='<li><div data-testid="sub-category-2010">Легковые авто</div></li><li>Мотоциклы</li>';w.document.querySelector('[data-testid="sub-category-2010"]').onclick=()=>{clicked.push('cars');w.document.body.insertAdjacentHTML('beforeend','<div data-name="cars_brand_v2"></div>');};};};
 await form.tick();await form.tick();await form.tick();await form.tick();assert.deepEqual(clicked,['open','parent','cars']);assert(form.ready());
 const second=await fixture(t,'<button data-testid="ain-show-all-categories">Изменить категорию</button>',[]);second.form.recipe.platform='kufar';second.w.document.querySelector('button').onclick=()=>assert.fail('Do not change an existing user category');await second.form.tick();
});
test('ABW continues the reviewed details step after filling settles, once per edited form',async t=>{
 const {w,form}=await fixture(t,'<div class="adverts-form"><div class="item-title">Марка</div><div class="item-title">Модель</div><div class="item-title">Год выпуска</div><input placeholder="Пробег"><button type="button">Продолжить</button><button type="submit">Опубликовать</button></div>',[{field:'abw.mileage',label:'Пробег',value:12000}]);
 let next=0;w.document.querySelector('[type=button]').onclick=()=>next++;w.document.querySelector('[type=submit]').onclick=()=>assert.fail('Never publish');
 await form.tick();assert.equal(next,0);await form.tick();assert.equal(next,0);await form.tick();assert.equal(next,1);
 await form.tick();assert.equal(next,1,'A validation failure must not cause repeated clicks');
 w.document.querySelector('input').value='13000';form.protect(w.document.querySelector('input'));await form.tick();await form.tick();assert.equal(next,2);
});
test('ABW does not continue disabled, ambiguous, unreviewed or other-site steps',async t=>{
 for(const scenario of ['disabled','ambiguous','unreviewed','other-site','busy']){
  const {w,form}=await fixture(t,'<div class="adverts-form"><div class="item-title">Марка</div><div class="item-title">Модель</div><div class="item-title">Год выпуска</div><input><button type="button">Продолжить</button></div>',[]);
  if(scenario==='disabled')w.document.querySelector('button').disabled=true;
  if(scenario==='ambiguous')w.document.querySelector('.adverts-form').insertAdjacentHTML('beforeend','<button type="button">Продолжить</button>');
  if(scenario==='unreviewed')w.document.querySelector('.item-title').textContent='Продвижение';
  if(scenario==='other-site')form.recipe.platform='av';
  if(scenario==='busy')w.document.querySelector('input').setAttribute('aria-busy','true');
  for(const button of w.document.querySelectorAll('button'))button.onclick=()=>assert.fail(scenario);
  await form.tick();await form.tick();await form.tick();
 }
});

test('ABW selects currency by ISO code and verifies its displayed symbol',async t=>{
 const base=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/automotive/cars_used_sale/browser-overrides.json'))).abw['abw.currency'];
 for(const [code,symbol] of Object.entries(base.displayLabels)){
  const c={field:'abw.currency',value:code,name:code.toUpperCase(),binding:base};
  const {w,form}=await fixture(t,'<input><div class="form__currency">Выберите</div>'+Object.values(base.optionLabels).map(s=>'<div class="form__currency-list-item">'+s+'</div>').join(''),[c]);
  for(const item of w.document.querySelectorAll('.form__currency-list-item'))item.onclick=()=>w.document.querySelector('.form__currency').textContent=base.displayLabels[item.textContent.toLowerCase()];
  await form.tick();await form.tick();assert.equal(w.document.querySelector('.form__currency').textContent,symbol);assert(form.done.has(c.field));
 }
});

const abwModification={field:'abw.modification',label:'Модификация',value:'1.6 MT',name:'1.6 MT',binding:{action:'choose',match:'engine_transmission',target:{label:'Модификация',labels:'.item-title',container:'.adverts-form-item',selector:'.item-header'},suggestions:{selector:'.list_modification .card_modification'},verify:{kind:'selected_text_equals',within_target:'.item-selected'}}};
test('ABW selects all supported currencies before setting price and confirms the standalone price step',async t=>{
 const b=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/automotive/cars_used_sale/browser-overrides.json'))).abw;
 for(const [code,symbol] of Object.entries(b['abw.currency'].displayLabels)){
  const controls=[{field:'abw.price',value:24500,binding:b['abw.price']},{field:'abw.currency',value:code,name:code.toUpperCase(),binding:b['abw.currency']}];
  const {w,form}=await fixture(t,'<div class="adverts-form"><input placeholder="Цена"><div class="form__currency">'+(code==='byn'?'$':'Br')+'</div>'+Object.values(b['abw.currency'].optionLabels).map(s=>'<div class="form__currency-list-item">'+s+'</div>').join('')+'<button type="button">Введите цену</button></div>',controls);
  const order=[];let next=0;
  for(const option of w.document.querySelectorAll('.form__currency-list-item'))option.onclick=()=>{order.push('currency');w.document.querySelector('.form__currency').textContent=b['abw.currency'].displayLabels[option.textContent.toLowerCase()];};
  const input=w.document.querySelector('input');input.oninput=()=>{assert.equal(w.document.querySelector('.form__currency').textContent,symbol);order.push('price');input.value='24 500';if(code!=='byn')w.document.querySelector('button').textContent='Продолжить';};
  w.document.querySelector('button').onclick=()=>{next++;assert(form.done.has('abw.price'));assert(form.done.has('abw.currency'));};
  for(let i=0;i<7;i++)await form.tick();assert.deepEqual(order,['currency','price']);assert.equal(next,1);assert.equal(input.value,'24 500');
 }
});
test('ABW does not confirm price with absent currency, pending validation, foreign values or contact inputs',async t=>{
 const b=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/automotive/cars_used_sale/browser-overrides.json'))).abw;
 for(const scenario of ['no-currency','wrong-currency','error','foreign-price','contacts']){
  const controls=[{field:'abw.price',value:24500,binding:b['abw.price']}];
  if(scenario!=='no-currency')controls.push({field:'abw.currency',value:'usd',name:'USD',binding:b['abw.currency']});
  const {w,form}=await fixture(t,'<div class="adverts-form"><input placeholder="Цена"><div class="form__currency">'+(scenario==='wrong-currency'?'Br':'$')+'</div><button type="button">Введите цену</button></div>',controls);
  const input=w.document.querySelector('input');let next=0;w.document.querySelector('button').onclick=()=>next++;
  if(scenario==='error')input.className='_inputError_1n9xe_56';
  if(scenario==='foreign-price')input.value='9900';
  if(scenario==='contacts')w.document.querySelector('.adverts-form').insertAdjacentHTML('beforeend','<input type="tel">');
  for(let i=0;i<8;i++)await form.tick();assert.equal(next,0,scenario);
  if(scenario==='error'){input.className='';for(let i=0;i<3;i++)await form.tick();assert.equal(next,1);}
  if(scenario==='foreign-price')assert.equal(input.value,'9900');
 }
});
const abwItem=(label,selected='',choices='')=>`<div class="adverts-form-item"><div class="item-header"><p class="item-title item-title_required">${label}</p><p class="item-selected">${selected}</p></div>${choices}</div>`;
const abwDetails=()=>abwItem('Марка','Kia')+abwItem('Модель','Rio')+abwItem('Год выпуска','2023');
const abwContacts=()=>'<div class="adverts-form"><input placeholder="Имя" value="Account"><input placeholder="E-mail"><input placeholder="Номер телефона" disabled value="+375 29 111 22 33"><button type="button">Минск Город *</button><button type="button">Продолжить</button></div>';
test('ABW sets supplied contacts over account defaults, reads locked matching phone and continues once',async t=>{
 const b=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/automotive/cars_used_sale/browser-overrides.json'))).abw;
 for(const locked of [true,false]){
  const controls=[['seller_name','Продавец'],['email','seller@example.test'],['phone','+375291112233']].map(([key,value])=>({field:'abw.'+key,value,binding:b['abw.'+key]}));
  const {w,form}=await fixture(t,abwContacts(),controls);let next=0;
  const phone=w.document.querySelector('[placeholder="Номер телефона"]');if(!locked){phone.disabled=false;phone.value='';}
  w.document.querySelectorAll('button')[1].onclick=()=>next++;
  for(let i=0;i<5;i++)await form.tick();
  assert.equal(w.document.querySelector('[placeholder="Имя"]').value,'Продавец');assert.equal(w.document.querySelector('[placeholder="E-mail"]').value,'seller@example.test');
  assert.equal(phone.value,locked?'+375 29 111 22 33':'+375291112233');assert.equal(next,1);assert(form.done.has('abw.phone'));assert.equal(form.blockedReason(),null);
 }
});
test('ABW cannot continue with mismatched locked phone, incomplete contacts, rejected email or manual edits',async t=>{
 const b=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/automotive/cars_used_sale/browser-overrides.json'))).abw;
 for(const scenario of ['phone','name','city','email','manual']){
  const controls=scenario==='phone'?[{field:'abw.phone',value:'+375291112244',binding:b['abw.phone']}]:scenario==='manual'?[{field:'abw.seller_name',value:'Card name',binding:b['abw.seller_name']}]:[];
  const {w,form}=await fixture(t,abwContacts(),controls);
  if(scenario==='name')w.document.querySelector('[placeholder="Имя"]').value='';
  if(scenario==='city')w.document.querySelector('button').textContent='Город *';
  if(scenario==='email')w.document.querySelector('[placeholder="E-mail"]').className='_inputError_1n9xe_56';
  if(scenario==='manual')form.protect(w.document.querySelector('[placeholder="Имя"]'));
  w.document.querySelectorAll('button')[1].onclick=()=>assert.fail(scenario);
  for(let i=0;i<4;i++)await form.tick();
  if(scenario==='phone')assert.match(form.blockedReason(),/Телефон.*отличается/);
  if(scenario==='manual')assert.equal(w.document.querySelector('[placeholder="Имя"]').value,'Account');
 }
});
test('ABW preserves unsupplied contacts and never presses the publication button',async t=>{
 const {w,form}=await fixture(t,abwContacts(),[]);let next=0;const button=w.document.querySelectorAll('button')[1];button.onclick=()=>next++;
 for(let i=0;i<3;i++)await form.tick();assert.equal(next,1);assert.equal(w.document.querySelector('[placeholder="E-mail"]').value,'');
 button.textContent='Опубликовать';button.onclick=()=>assert.fail('Never publish');form.retry();for(let i=0;i<3;i++)await form.tick();
});
test('ABW nested condition section validates sibling technical fields before Continue',async t=>{
 const {w,form}=await fixture(t,'<div class="adverts-form"><div class="adverts-form">'+abwDetails()+abwItem('Модификация')+'</div><div class="adverts-form">'+abwItem('Цвет кузова','черный')+abwItem('Состояние','с пробегом')+abwItem('Наличие','в наличии')+'<input placeholder="Пробег, км" value="12345"><button type="button">Продолжить</button></div></div>',[]);
 let next=0;w.document.querySelector('button').onclick=()=>next++;
 for(let i=0;i<3;i++)await form.tick();assert.equal(next,0);
 w.document.querySelectorAll('.item-selected')[3].textContent='1.6 MT 123 л.с.';
 for(let i=0;i<3;i++)await form.tick();assert.equal(next,1);
});
test('ABW selects volume and gearbox, verifies acceptance and only then continues',async t=>{
 const options=['1.4 MT 100 л.с.','1.6 AT 123 л.с.','11.6 MT 123 л.с.','1.6 AMT 123 л.с.','1,6 МТ 123 л.с.','1.6 MT 130 л.с.'];
 const html='<div class="adverts-form">'+abwDetails()+abwItem('Модификация','','<div class="list_modification">'+options.map(s=>'<div class="card_modification">'+s+'</div>').join('')+'</div>')+'<input placeholder="Пробег, км" value="12000"><button type="button">Продолжить</button></div>';
 const {w,form}=await fixture(t,html,[abwModification]);let selected='',next=0;
 for(const option of w.document.querySelectorAll('.card_modification'))option.onclick=()=>{selected=option.textContent;};
 w.document.querySelector('button').onclick=()=>next++;
 await form.tick();assert.equal(selected,'1,6 МТ 123 л.с.');
 for(let i=0;i<4;i++)await form.tick();assert.equal(next,0,'A click alone is not acceptance');
 w.document.querySelector('.list_modification').closest('.adverts-form-item').querySelector('.item-selected').textContent=selected;
 for(let i=0;i<3;i++)await form.tick();assert(form.done.has('abw.modification'));assert.equal(next,1);
 await form.tick();assert.equal(next,1);
});
test('ABW waits for every required selection and mileage, and does not consume Continue early',async t=>{
 const {w,form}=await fixture(t,'<div class="adverts-form">'+abwDetails()+abwItem('Модификация')+'<input placeholder="Пробег, км"><button type="button">Продолжить</button></div>',[]);let next=0;
 w.document.querySelector('button').onclick=()=>next++;
 for(let i=0;i<3;i++)await form.tick();assert.equal(next,0);
 w.document.querySelectorAll('.item-selected')[3].textContent='1.6 MT 123 л.с.';
 for(let i=0;i<3;i++)await form.tick();assert.equal(next,0);
 const input=w.document.querySelector('input');input.value='12000';input.setAttribute('aria-invalid','true');
 for(let i=0;i<3;i++)await form.tick();assert.equal(next,0);
 input.removeAttribute('aria-invalid');
 for(let i=0;i<3;i++)await form.tick();assert.equal(next,1);
});
test('ABW modification preserves existing choices and cannot use a different engine or gearbox',async t=>{
 for(const existing of ['', '1.4 MT 100 л.с.']){
  const {w,form}=await fixture(t,'<input>'+abwItem('Модификация',existing,'<div class="list_modification"><div class="card_modification">1.4 MT 100 л.с.</div><div class="card_modification">1.6 AT 123 л.с.</div></div>'),[abwModification]);
  for(const e of w.document.querySelectorAll('.card_modification'))e.onclick=()=>assert.fail('Must not select another engine/gearbox');
  for(let i=0;i<4;i++)await form.tick();assert.equal(w.document.querySelector('.item-selected').textContent,existing);assert(!form.done.has('abw.modification'));
 }
});
test('ABW advances after all server photo previews load, reusing asynchronous probes',async t=>{
 const bindings=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/automotive/cars_used_sale/browser-overrides.json'))).abw;
 const {w,form}=await fixture(t,'<div class="adverts-form"><div class="form__photos"><div class="form__image-wrapper"><div class="form__image" style="background-image:url(https://static.abw.by/upload/a.webp)"></div></div><div class="form__image-wrapper"><div class="form__image" style="background-image:url(blob:pending)"></div></div></div><input class="uploader-field" type="file"><button type="button">Продолжить</button></div>',[]);
 let next=0;const probes=[];w.Image=class {constructor(){this.complete=false;this.naturalWidth=0;probes.push(this);}};
 form.photos=[{},{}];form.photoSent=true;form.recipe.photoBinding=bindings['abw.photo'];
 w.document.querySelector('button').onclick=()=>next++;
 for(let i=0;i<3;i++)await form.tick();assert.equal(next,0);assert.equal(probes.length,1);
 probes[0].complete=true;probes[0].naturalWidth=100;
 await form.tick();assert.equal(next,0,'One accepted photo cannot stand in for the full batch');
 w.document.querySelectorAll('.form__image')[1].style.backgroundImage='url(https://static.abw.by/upload/b.webp)';
 await form.tick();assert.equal(probes.length,2);assert.equal(next,0);
 probes[1].complete=true;probes[1].naturalWidth=100;
 for(let i=0;i<3;i++)await form.tick();assert(form.done.has('photos'));assert.equal(next,1);assert.equal(probes.length,2);
 await form.tick();assert.equal(next,1);
});
test('ABW fills the actual description placeholder then advances, but never advances contacts',async t=>{
 const binding=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/automotive/cars_used_sale/browser-overrides.json'))).abw['abw.description'];
 const c={field:'abw.description',label:'Описание',value:'Kia Rio, ухоженный автомобиль.',name:'Kia Rio, ухоженный автомобиль.',binding};
 const {w,form}=await fixture(t,'<div class="adverts-form"><textarea placeholder="Честно опишите достоинства и недостатки своего автомобиля"></textarea><button type="button">Продолжить</button></div>',[c]);let next=0;
 w.document.querySelector('button').onclick=()=>next++;
 await form.tick();assert.equal(w.document.querySelector('textarea').value,c.value);assert.equal(next,0);
 for(let i=0;i<3;i++)await form.tick();assert.equal(next,1);assert(form.done.has(c.field));
 w.document.querySelector('.adverts-form').innerHTML='<input type="tel"><button type="button">Продолжить</button><button type="submit">Опубликовать</button>';
 for(const b of w.document.querySelectorAll('button'))b.onclick=()=>assert.fail('Contacts/final submission must stay manual');
 for(let i=0;i<3;i++)await form.tick();
});
test('ABW refuses description transition while the site rejects the value',async t=>{
 const binding=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/automotive/cars_used_sale/browser-overrides.json'))).abw['abw.description'];
 const {w,form}=await fixture(t,'<div class="adverts-form"><textarea placeholder="Честно опишите достоинства и недостатки своего автомобиля"></textarea><button type="button">Продолжить</button></div>',[{field:'abw.description',value:'Описание авто',binding}]);
 w.document.querySelector('textarea').addEventListener('input',e=>{e.target.value='';});w.document.querySelector('button').onclick=()=>assert.fail('Description has not been accepted');
 for(let i=0;i<4;i++)await form.tick();
});
test('ABW fills the standalone VIN step and continues once after verifying the value',async t=>{
 const binding=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/automotive/cars_used_sale/browser-overrides.json'))).abw['abw.vin'];
 const value='TESTVIN1234567890';
 const {w,form}=await fixture(t,'<div class="adverts-form"><input placeholder="VIN" maxlength="17"><button type="button">Продолжить</button></div>',[{field:'abw.vin',value,binding}]);
 let next=0;w.document.querySelector('button').onclick=()=>next++;
 await form.tick();assert.equal(w.document.querySelector('input').value,value);assert.equal(next,0);
 for(let i=0;i<4;i++)await form.tick();assert.equal(next,1);assert(form.done.has('abw.vin'));
});
test('ABW VIN waits on rejected values, preserves manual input and excludes lookup/contact steps',async t=>{
 const binding=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/automotive/cars_used_sale/browser-overrides.json'))).abw['abw.vin'];
 for(const scenario of ['invalid','rejected','manual','lookup','contacts']){
  const {w,form}=await fixture(t,'<div class="adverts-form"><input placeholder="VIN"><button type="button">Продолжить</button></div>',[{field:'abw.vin',value:'TESTVIN1234567890',binding}]);
  const input=w.document.querySelector('input'),panel=w.document.querySelector('.adverts-form');
  if(scenario==='invalid')input.setCustomValidity('VIN не принят');
  if(scenario==='rejected')input.oninput=()=>{input.value='';};
  if(scenario==='manual')input.value='USERVIN1234567890';
  if(scenario==='lookup')panel.insertAdjacentHTML('beforeend','<button>Заполнить вручную</button>');
  if(scenario==='contacts')panel.insertAdjacentHTML('beforeend','<input type="tel">');
  for(const button of w.document.querySelectorAll('button'))button.onclick=()=>assert.fail(scenario);
  for(let i=0;i<4;i++)await form.tick();
  if(scenario==='manual')assert.equal(input.value,'USERVIN1234567890');
 }
});
test('ABW leaves a missing VIN blank and passes only an optional standalone VIN step',async t=>{
 for(const required of [false,true]){
  const {w,form}=await fixture(t,'<div class="adverts-form"><input placeholder="VIN" '+(required?'required':'')+'><button type="button">Продолжить</button></div>',[]);let next=0;
  w.document.querySelector('button').onclick=()=>next++;
  for(let i=0;i<4;i++)await form.tick();assert.equal(w.document.querySelector('input').value,'');assert.equal(next,required?0:1);
 }
});
test('Onliner technical controls are scoped by label, not changing block positions',async t=>{
 const bindings=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/parsing/cars_used_sale/binding_cars_used_sale_onliner.json'))).fields;
 const controls=[['engineType','gasoline','Бензин'],['drivetrain','rear','Задний'],['transmission','automatic','Автоматическая'],['engineCapacity',3.0,'3'],['year',2020,'2020']].map(([id,value,name])=>({field:'onliner.'+id,value,name,binding:bindings.find(b=>b.option_id==='onliner.'+id)}));
 // Missing generation, added arbitrary groups, and another same-text choice elsewhere.
 const {w,form}=await fixture(t,'<div class="vehicle-form"><div class="vehicle-form__step-item"><div><input placeholder="Например, GT, CL, LX, WRC"><div><div class="vehicle-form__label">Привод</div><a class="vehicle-form__button_choose">Задний</a></div><div>Extra conditional field</div><div><div class="vehicle-form__label">Двигатель</div><a class="vehicle-form__button_choose">Бензин</a></div><div><div class="vehicle-form__label">Коробка передач</div><a class="vehicle-form__button_choose">Автоматическая</a></div><input type="text" maxlength="5"><div class="vehicle-form__group"><a class="vehicle-form__button_choose">2020</a><select class="vehicle-form__button-select"><option>2016</option></select></div></div></div></div><a>Бензин</a>',controls);
 form.recipe.platform='onliner';for(const a of w.document.querySelectorAll('.vehicle-form a'))a.onclick=()=>a.classList.add('button-style_active');
 for(let i=0;i<8;i++)await form.tick();assert.deepEqual([...form.done].sort(),controls.map(c=>c.field).sort());assert.equal(w.document.querySelector('[maxlength="5"]').value,'3');
});
test('Onliner absent static choices cannot starve a later field or select body as color',async t=>{
 const bindings=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/parsing/cars_used_sale/binding_cars_used_sale_onliner.json'))).fields;
 const controls=[['color','sedan','Седан'],['engineType','missing','Нет такого двигателя'],['year',2020,'2020']].map(([id,value,name])=>({field:'onliner.'+id,value,name,binding:bindings.find(b=>b.option_id==='onliner.'+id)}));
 const {w,form}=await fixture(t,'<div class="vehicle-form"><div class="vehicle-form__step-item"><input placeholder="Например, GT, CL, LX, WRC"><label><input name="bodyType" type="radio" value="sedan">Седан</label><div><div class="vehicle-form__label">Двигатель</div><a class="vehicle-form__button_choose">Бензин</a></div><div class="vehicle-form__group"><a class="vehicle-form__button_choose">2020</a><select class="vehicle-form__button-select"><option>2016</option></select></div></div></div>',controls);
 form.recipe.platform='onliner';w.document.querySelector('.vehicle-form__group a').onclick=e=>e.target.classList.add('button-style_active');await form.tick();await form.tick();assert(form.done.has('onliner.year'));assert(!form.done.has('onliner.color'));assert(!w.document.querySelector('[name=bodyType]').checked);
});

test('AV matches the entry title separately from an adjacent quota hint',async t=>{
 const {w,form}=await fixture(t,'<a class="category-item__button"><span class="category-item__title">Автомобиль с пробегом</span><span class="category-item__hint">1 бесплатное объявление и до 5 платных</span></a><a class="category-item__button"><span class="category-item__title">Новый автомобиль</span><span class="category-item__hint">Автомобиль с пробегом до 1000 км</span></a>',[]);
 form.recipe.platform='av';let clicked=0;w.document.querySelector('a').onclick=()=>clicked++;w.document.querySelectorAll('a')[1].onclick=()=>assert.fail('Must not select new cars');await form.tick();await form.tick();assert.equal(clicked,1);
});

test('Kufar accepts its actual photo counter only with loaded remote previews',async t=>{
 const binding=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/parsing/cars_used_sale/binding_cars_used_sale_kufar.json'))).fields.find(b=>b.option_id==='kufar.images');
 const {w,form}=await fixture(t,'<input><div data-name="images"><span class="X_counter">Загружено 1 из 30</span></div><div class="X_wrapper_photo"><div aria-roledescription="sortable"><img src="https://rms.kufar.by/v1/list_thumbs_2x/adim1/fixture"></div></div>',[]);
 form.recipe.photoBinding=binding;form.photos=[{}];form.photoSent=true;const img=w.document.querySelector('img');Object.defineProperty(img,'complete',{value:true});Object.defineProperty(img,'naturalWidth',{value:50});assert(await form.photo());assert(form.done.has('photos'));
 form.done.delete('photos');w.document.querySelector('span').textContent='Загружено 0 из 30';assert.equal(await form.photo(),false);assert(!form.done.has('photos'));
});

test('Kufar shared dropdown waits for its own options and never oscillates between fields',async t=>{
 const controls=['body','color'].map((id,i)=>({field:'kufar.'+id,label:id,value:i,name:i?'Серый':'Седан',binding:{action:'choose',target:{selectors:['#'+id]},suggestions:{selector:'[data-testid="popup-body"] .choice'},verify:{kind:'selected_text_equals'}}}));
 const {w,form}=await fixture(t,'<div data-name="cars_brand_v2"></div><button id="body">Тип кузова</button><button id="color">Цвет</button><textarea placeholder="Описание"></textarea>',[...controls,{field:'kufar.description',label:'Описание',value:'Описание автомобиля'}]);form.recipe.platform='kufar';
 const opens=[];for(const id of ['body','color'])w.document.querySelector('#'+id).onclick=()=>opens.push(id);
 await form.tick();await form.tick();await form.tick();assert.deepEqual(opens,['body']);
 w.document.body.insertAdjacentHTML('beforeend','<div data-testid="popup-body"><button class="choice">Седан</button></div>');
 w.document.querySelector('.choice').onclick=()=>{w.document.querySelector('#body').textContent='Седан';w.document.querySelector('[data-testid]').remove();};
 await form.tick();await form.tick();await form.tick();assert.deepEqual(opens,['body','color']);
 // The second picker never returns a matching option; do not reopen the first or starve text.
 for(let i=0;i<16;i++)await form.tick();assert.deepEqual(opens,['body','color']);assert.equal(w.document.querySelector('textarea').value,'Описание автомобиля');
});
test('Kufar never takes an identically named choice from another fields popup',async t=>{
 const {w,form}=await fixture(t,'<div data-name="cars_brand_v2"></div><button id="body">Выберите</button><div data-testid="popup-body"><button class="choice">Седан</button></div>',[{field:'kufar.body',value:1,name:'Седан',binding:{action:'choose',target:{selectors:['#body']},suggestions:{selector:'[data-testid="popup-body"] .choice'}}}]);form.recipe.platform='kufar';let opens=0;w.document.querySelector('.choice').onclick=()=>assert.fail('Unowned popup');w.document.querySelector('#body').onclick=()=>{opens++;w.document.querySelector('[data-testid]').remove();};await form.tick();assert.equal(opens,1);
});
test('Onliner automatically advances only reviewed intermediate steps, once per unchanged state',async t=>{
 for(const marker of ['<input placeholder="Например, GT, CL, LX, WRC">','<input type="file">','<textarea></textarea>']){
  const {w,form}=await fixture(t,'<div class="vehicle-form__step-item">'+marker+'<div class="vehicle-form__step-helper"><div class="vehicle-form__control"><a class="vehicle-form__button">Далее</a><a class="vehicle-form__button">Подтвердить</a></div></div></div>',[]);form.recipe.platform='onliner';let next=0;w.document.querySelector('a').onclick=()=>next++;w.document.querySelectorAll('a')[1].onclick=()=>assert.fail('Never confirm publication');
  await form.tick();await form.tick();assert.equal(next,1);for(let i=0;i<5;i++)await form.tick();assert.equal(next,1);form.retry();await form.tick();await form.tick();assert.equal(next,2);
 }
});
test('Onliner waits for photo acceptance and refuses contacts, disabled and ambiguous next links',async t=>{
 for(const scenario of ['contacts','disabled','ambiguous','photos']){
  const marker=scenario==='contacts'?'<input name="country">':scenario==='photos'?'<input type="file">':'<textarea></textarea>';
  const {w,form}=await fixture(t,'<div class="vehicle-form__step-item">'+marker+'<div class="vehicle-form__control"><a class="vehicle-form__button">Далее</a></div></div>',[]);form.recipe.platform='onliner';
  if(scenario==='disabled')w.document.querySelector('a').setAttribute('aria-disabled','true');
  if(scenario==='ambiguous')w.document.querySelector('.vehicle-form__control').insertAdjacentHTML('beforeend','<a class="vehicle-form__button">Далее</a>');
  if(scenario==='photos'){form.photos=[{}];form.photoSent=true;}
  for(const a of w.document.querySelectorAll('a'))a.onclick=()=>assert.fail(scenario);for(let i=0;i<4;i++)await form.tick();
 }
});
test('ABW next tracks the step state even when other page activity keeps reporting changed',async t=>{
 const {w,form}=await fixture(t,'<div class="adverts-form"><div class="item-title">Марка</div><div class="item-title">Модель</div><div class="item-title">Год выпуска</div><input><button type="button">Продолжить</button></div>',[]);let next=0;w.document.querySelector('button').onclick=()=>next++;
 form.continueAbw(true);form.continueAbw(true);form.continueAbw(true);assert.equal(next,1);form.continueAbw(true);assert.equal(next,1);form.retry();form.continueAbw(false);form.continueAbw(false);assert.equal(next,2);
});

test('Kufar waits through a multi-select with more than six successful choices',async t=>{
 const wanted=Array.from({length:9},(_,i)=>({value:i,name:'Опция '+i}));
 const {w,form}=await fixture(t,'<div data-name="cars_brand_v2"></div><button id="features">Выберите</button>',[{field:'kufar.features',value:wanted,binding:{action:'choose',target:{selectors:['#features']},suggestions:{selector:'[data-testid="popup-body"] label',checkbox_selector:'input'},commit:{target:{selectors:['#apply']}}}}]);form.recipe.platform='kufar';let opens=0,accepted=0;
 w.document.querySelector('button').onclick=()=>{opens++;w.document.body.insertAdjacentHTML('beforeend','<div data-testid="popup-body">'+wanted.map(v=>'<label><input type="checkbox">'+v.name+'</label>').join('')+'<button id="apply">Применить</button></div>');w.document.querySelector('#apply').onclick=()=>{accepted=w.document.querySelectorAll('input:checked').length;w.document.querySelector('[data-testid]').remove();};};
 for(let i=0;i<14;i++)await form.tick();assert.equal(opens,1);assert.equal(accepted,9);assert(form.done.has('kufar.features'));
});

test('car publication accepts more than twelve photos without truncating the batch',()=>{
 const core=require('../rental-core.js');const photos=Array.from({length:20},(_,i)=>({id:'photo-'+i,name:i+'.jpg',dataUrl:'data:image/jpeg;base64,AAAA'}));
 const payload={categoryId:'cars_used_sale',profileId:'owner',id:'card',revision:1,mode:'assist',jobs:[{platform:'av',startUrl:'https://av.by/offer/draft/cars',contract:'cars-v1',format:1,controls:[],ready:[{selector:'body'}],setup:[],next:[],submit:[]}],photos};
 assert.equal(core.validate(payload).photos.length,20);
});
