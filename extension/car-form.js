(function(root){
 'use strict';
 const norm=v=>String(v??'').normalize('NFKC').trim().toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ');
 // Normalize presentation only; native IDs, field values and technical parsing stay intact.
 // Symbol-only labels (notably currencies) must not all become the same empty string.
 const textKey=v=>{const raw=norm(v);return raw.replace(/[^\p{L}\p{N}]+/gu,' ').trim()||raw;};
 const labelName=v=>textKey(v);
 function modificationMatches(label,wanted){
   const latin=v=>norm(v).replace(/[мта]/g,c=>({'м':'m','т':'t','а':'a'}[c]));
   const spec=latin(wanted).match(/^(\d+(?:[.,]\d+)?)\s+(mt|at|cvt|amt)$/);
   const text=latin(label),capacity=text.match(/(?:^|[^\d.,])(\d+(?:[.,]\d+)?)/);
   return !!spec&&!!capacity&&Number(capacity[1].replace(',','.'))===Number(spec[1].replace(',','.'))
     &&new RegExp('(?:^|[^a-zа-я])'+spec[2]+'(?:$|[^a-zа-я])').test(text);
 }
 const visible=e=>!!e&&!e.closest('[hidden],[aria-hidden="true"]')&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden'&&(e.getClientRects().length>0||navigator.userAgent.includes('HappyDOM'));
 const query=s=>{try{return [...document.querySelectorAll(s)].filter(e=>!e.closest('#autopost-rental-helper'));}catch{return [];}};
 const enabled=e=>!e.disabled&&e.getAttribute('aria-disabled')!=='true';
 const rendered=e=>visible(e)||e.tagName==='OPTION'&&visible(e.parentElement)||[...e.labels||[]].some(visible);
 const content=e=>e.tagName==='INPUT'&&['checkbox','radio'].includes(e.type)?[...e.labels||[]].map(l=>l.textContent).join(' '):e.textContent;
 const events=e=>{for(const type of ['input','change','blur'])e.dispatchEvent(new Event(type,{bubbles:true}));};
 function setValue(e,value){const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')?.set.call(e,String(value));events(e);}
 const equal=(a,b)=>typeof b==='number'?Number(String(a).replace(/\s/g,'').replace(',','.'))===b:norm(a)===norm(b);
 function fallback(c){
   // Exact labels only. An unreviewed field is never guessed by its order on the page.
   let controls=query('input:not([type=hidden]),textarea,select,button[aria-haspopup],button.dropdown__control').filter(e=>rendered(e)&&enabled(e)&&(
    textKey(e.getAttribute('placeholder'))===textKey(c.label)||textKey(e.getAttribute('aria-label'))===textKey(c.label)||[...e.labels||[]].some(l=>textKey(l.textContent)===textKey(c.label))));
   if(controls.length===1)return controls[0];
   const labels=query('label,.form-label,.form__label').filter(e=>visible(e)&&textKey(e.textContent)===textKey(c.label));
   if(labels.length!==1)return null;
   const group=labels[0].closest('.form-row,.form__field,.form-item,.form__group')||labels[0].parentElement;
   controls=[...group.querySelectorAll('input:not([type=hidden]),textarea,select,button.dropdown__control')].filter(e=>rendered(e)&&enabled(e));
   return controls.length===1?controls[0]:null;
 }
 function targets(c){const b=c.binding||{};if(b.status==='unsupported')return [];
  if(b.target?.label){const labels=query(b.target.labels).filter(e=>visible(e)&&labelName(e.textContent)===labelName(b.target.label));if(labels.length!==1)return [];const box=b.target.container?labels[0].closest(b.target.container):labels[0].parentElement;const found=b.target.selector?[...box?.querySelectorAll(b.target.selector)||[]]:[box];return found.filter(e=>e&&rendered(e)&&enabled(e));}
  if(b.target?.selectors){for(const selector of b.target.selectors){const found=query(selector).filter(e=>rendered(e)&&(enabled(e)||b.read_disabled===true));if(found.length)return found;}}const e=fallback(c);return e?[e]:[];}
 function toggleChoices(c,target){return [...target.querySelectorAll(c.binding.suggestions.within_target)].filter(rendered);}
 function toggleMatches(choices,value){return value!=null&&String(value)!==''?choices.filter(e=>e.id.endsWith('-'+String(value))):[];}
 function read(c,target){const b=c.binding||{},v=b.verify||{};
  if(b.action==='select_toggles')return Array.isArray(c.value)&&c.value.every(value=>{const matches=toggleMatches(toggleChoices(c,target),value.value);return matches.length===1&&matches[0].getAttribute('aria-pressed')==='true';});
  const candidates=v.within_target?[...target.querySelectorAll(v.within_target)].filter(rendered):v.target?.selectors? v.target.selectors.flatMap(query).filter(rendered):[target];
  // Onliner removes the identity radio group after selection and shows its name in the step header.
  if(!candidates.length&&v.fallbackTextSelectors){
    // AV adds a decorative separator and production dates to the selected generation breadcrumb.
    const name=v.fallbackTextTransform==='av_generation'?value=>textKey(norm(value).replace(/\s*,\s*\d{4}.*$/,'')):textKey;
    const labels=v.fallbackTextSelectors.flatMap(query).filter(e=>visible(e)&&!!name(c.name)&&name(e.textContent)===name(c.name));return labels.length===1;
  }
  if(candidates.length!==1)return false;const e=candidates[0];
  if(v.kind==='element_id_equals')return e.id===b.id_prefix+String(c.value);
  if(v.kind==='phone_digits_equals'){const wanted=String(c.value??'').replace(/\D/g,'');return !!wanted&&String(e.value??'').replace(/\D/g,'')===wanted;}
  if(b.match==='engine_transmission')return modificationMatches(content(e),c.name);
  if(b.match==='av_native_option'&&e.matches('input[type=radio]'))return equal(e.value,c.value);
  if(v.kind==='checked_equals'||b.action==='set_checked')return e.checked===c.value;
  if(v.kind==='value_equals'||b.action==='set_value'||b.action==='select_option'||!b.action&&['INPUT','TEXTAREA','SELECT'].includes(e.tagName))return equal(e.value,c.value);
  return textKey(e.tagName==='SELECT'?e.selectedOptions[0]?.textContent:content(e))===textKey(b.displayLabels?.[c.value]??c.name);
 }
 class Form {
  constructor(recipe,photos,claimPhotos){this.recipe=recipe;this.controls=recipe.controls;this.photos=photos;this.claimPhotos=claimPhotos;this.done=new Set();this.tried=new Set();this.protected=new WeakSet();this.photoSent=false;this.activeDropdown=null;this.pending=new Map();}
  click(e){if(!e)return;this.writing=true;try{e.click();}finally{this.writing=false;}}
  protect(e){if(e&&!this.writing){this.protected.add(e);for(const c of this.controls){const boxes=targets(c);if(boxes.some(box=>box===e||!box.matches('form,.vehicle-form,body')&&box.contains(e))||c.binding?.suggestions?.selector&&query(c.binding.suggestions.selector).some(x=>x===e||x.contains(e))){this.protected.add(c);this.done.delete(c.field);}}}}
  resumeQueries(){this.activeDropdown=null;this.dropdownTicks=0;}
  retry(){this.tried.clear();this.resumeQueries();this.continueSnapshot=null;this.continueAttempts=new Set();}
  openDropdown(c,e){
    if(this.activeDropdown||this.tried.has(e))return false;
    this.tried.add(e);this.activeDropdown=c.field;this.dropdownTicks=0;this.click(e);return true;
  }
  popupQuery(target,selector){
    const prefix=/^\[data-testid=["']popup-body["']\]/;
    if(this.recipe.platform==='kufar'&&prefix.test(selector)){
      // Desktop options live beside their control; narrow layouts use a shared modal.
      const field=target.closest('[data-name]');
      const local=[...field?.querySelectorAll('[data-testid="dropdown-popup-ui"]')||[]].filter(visible);
      if(local.length){
        if(local.length!==1)return [];
        const suffix=selector.replace(prefix,'').trim();
        return suffix?[...local[0].querySelectorAll(suffix)]:local;
      }
    }
    return query(selector);
  }
  openCarCategory(){
    if(this.recipe.platform!=='kufar'||this.ready())return false;
    const popup=query('[data-testid="kufar-chose-category-popup"]').filter(visible);
    const initial=query('[data-testid="ain-show-all-categories"],button').filter(e=>visible(e)&&enabled(e)&&norm(e.textContent)==='выбрать категорию');
    if(!this.categoryStarted&&initial.length!==1)return false;
    let choices;
    if(popup.length===1){
      const exact=text=>{const items=[...popup[0].querySelectorAll('li,button,[role="button"],[data-testid^="sub-category-"]')].filter(e=>visible(e)&&enabled(e)&&norm(e.textContent)===text);return items.filter(e=>!items.some(other=>other!==e&&e.contains(other)));};
      choices=exact('легковые авто');
      if(!choices.length)choices=exact('авто и запчасти');
    }else choices=initial;
    if(choices.length!==1||this.protected.has(choices[0])||this.tried.has(choices[0]))return false;
    this.categoryStarted=true;this.tried.add(choices[0]);this.click(choices[0]);return true;
  }
  openUsedCarForm(){
    if(this.recipe.platform!=='av'||this.usedCarOpened)return false;
    const links=query('a,button').filter(e=>!e.matches('.newad__breadcrumb-button')&&visible(e)&&enabled(e)&&(e.querySelector('.category-item__title')
      ?norm(e.querySelector('.category-item__title').textContent)==='автомобиль с пробегом'
      :/^автомобиль с пробегом(?:\s|$)/.test(norm(e.textContent))));
    if(links.length!==1||this.protected.has(links[0]))return false;
    this.usedCarOpened=true;this.click(links[0]);return true;
  }
  openManualForm(){
    if(this.recipe.platform!=='abw'||this.manualOpened||this.controls.some(c=>c.field==='abw.vin'&&norm(c.value)))return false;
    const vins=query('input').filter(e=>visible(e)&&(/vin/i.test(e.getAttribute('placeholder')||'')||/vin/i.test(e.getAttribute('aria-label')||'')||[...e.labels||[]].some(l=>/vin/i.test(l.textContent))));
    const buttons=query('button').filter(e=>visible(e)&&enabled(e)&&norm(e.textContent)==='заполнить вручную');
    if(vins.length!==1||vins[0].value.trim()||this.protected.has(vins[0])||buttons.length!==1||this.protected.has(buttons[0]))return false;
    this.manualOpened=true;this.click(buttons[0]);return true;
  }
  continueAbw(changed){
    if(this.recipe.platform!=='abw')return false;
    if(this.continueAbwVinLookup(changed))return true;
    const buttons=query('.adverts-form > button[type="button"]').filter(e=>visible(e)&&enabled(e)&&['продолжить','введите цену'].includes(norm(e.textContent)));
    if(buttons.length!==1||this.protected.has(buttons[0]))return false;
    let panel=buttons[0].parentElement;
    if(panel.querySelector('[aria-busy="true"],[aria-invalid="true"]'))return false;
    const price=panel.querySelector('input[placeholder="Цена"]');
    if(price){
      const fields=[...panel.querySelectorAll('input:not([type="hidden"]),textarea,select')].filter(rendered);
      const amount=this.controls.find(c=>c.field==='abw.price'),currency=this.controls.find(c=>c.field==='abw.currency');
      const currencyTargets=currency?targets(currency):[];
      if(fields.length!==1||fields[0]!==price||!amount||!currency||!norm(price.value)||price.validity?.valid===false||price.matches('[class*="_inputError_"]')
        ||!this.done.has(amount.field)||!this.done.has(currency.field)||!read(amount,price)
        ||currencyTargets.length!==1||!panel.contains(currencyTargets[0])||!read(currency,currencyTargets[0])){
        this.continueSnapshot=null;return false;
      }
      return this.continueStep(buttons[0],panel,'abw-price',changed);
    }
    if(norm(buttons[0].textContent)!=='продолжить')return false;
    const contactName=panel.querySelector('input[placeholder="Имя"]'),contactPhone=panel.querySelector('input[placeholder="Номер телефона"]');
    if(contactName&&contactPhone){
      const inputs=[...panel.querySelectorAll('input:not([type="hidden"]),textarea,select')].filter(rendered);
      const supplied=this.controls.filter(c=>['abw.seller_name','abw.email','abw.phone','abw.city'].includes(c.field)&&norm(c.value));
      const unaccepted=supplied.some(c=>{const ts=targets(c);return ts.length!==1||!panel.contains(ts[0])||!read(c,ts[0]);});
      const cities=[...panel.querySelectorAll('button')].filter(e=>visible(e)&&/город\s*\*?$/i.test(norm(e.textContent)));
      const citySelected=cities.length===1&&!!norm(cities[0].textContent).replace(/город\s*\*?$/,'').trim();
      if(!norm(contactName.value)||!norm(contactPhone.value)||!citySelected||unaccepted
        ||inputs.some(e=>e.validity?.valid===false||e.getAttribute('aria-invalid')==='true'||e.matches('[class*="_inputError_"]')
          ||e.required&&!norm(e.value))){this.continueSnapshot=null;return false;}
      return this.continueStep(buttons[0],panel,'abw-contacts',changed);
    }
    if(panel.querySelector('input[type="file"].uploader-field')){
      if(!this.photoSent||!this.done.has('photos'))return false;
      return this.continueStep(buttons[0],panel,'abw-photos',changed);
    }
    const description=panel.querySelector('textarea[placeholder="Честно опишите достоинства и недостатки своего автомобиля"]');
    if(description){
      const control=this.controls.find(c=>c.field==='abw.description');
      if(!control||!norm(control.value)||!this.done.has(control.field)||!read(control,description)||description.validity?.valid===false)return false;
      return this.continueStep(buttons[0],panel,'abw-description',changed);
    }
    const vin=panel.querySelector('input[placeholder="VIN"]');
    if(vin){
      // Only the standalone VIN step, not an initial VIN lookup or a contacts/final form.
      const fields=[...panel.querySelectorAll('input:not([type="hidden"]),textarea,select')].filter(rendered);
      if(fields.length!==1||fields[0]!==vin||!enabled(vin)||vin.validity?.valid===false
        ||[...panel.querySelectorAll('button')].some(e=>norm(e.textContent)==='заполнить вручную'))return false;
      const control=this.controls.find(c=>c.field==='abw.vin'&&norm(c.value));
      if(control&&(!this.done.has(control.field)||!read(control,vin)))return false;
      if(!norm(vin.value)&&(vin.required||vin.getAttribute('aria-required')==='true'))return false;
      return this.continueStep(buttons[0],panel,'abw-vin',changed);
    }
    // Only the reviewed vehicle-details step; no publication, contacts or paid promotion steps.
    let labels=[...panel.querySelectorAll('.item-title')].filter(visible).map(e=>labelName(e.textContent));
    // ABW places the button in the nested condition/color section, beside the technical section.
    if(['цвет кузова','состояние','наличие'].every(label=>labels.includes(label))){
      panel=panel.parentElement?.closest('.adverts-form')||panel;
      labels=[...panel.querySelectorAll('.item-title')].filter(visible).map(e=>labelName(e.textContent));
    }
    if(!['марка','модель','год выпуска'].every(label=>labels.includes(label))||panel.querySelector('[aria-busy="true"]'))return false;
    // ABW renders accepted values in item-selected; typed search text is not a selection.
    const required=[...panel.querySelectorAll('.item-title_required')].filter(visible);
    const missingChoice=required.some(label=>!norm(label.closest('.adverts-form-item')?.querySelector('.item-selected')?.textContent));
    const inputs=[...panel.querySelectorAll('input,select,textarea')].filter(e=>rendered(e)&&enabled(e));
    const missingInput=inputs.some(e=>e.validity?.valid===false||e.getAttribute('aria-invalid')==='true'
      ||(e.required||e.getAttribute('aria-required')==='true'||e.getAttribute('placeholder')==='Пробег, км')&&!norm(e.value));
    const unaccepted=this.controls.some(c=>{
      if(c.value==null||c.binding?.status==='unsupported'||this.protected.has(c))return false;
      return targets(c).some(e=>panel.contains(e)&&!this.protected.has(e)&&!read(c,e)
        &&!(c.binding?.match==='engine_transmission'&&norm(e.querySelector('.item-selected')?.textContent)));
    });
    if(missingChoice||missingInput||unaccepted||[...panel.querySelectorAll('[aria-invalid="true"]')].some(visible)){
      this.continueSnapshot=null;return false;
    }
    return this.continueStep(buttons[0],panel,'abw-details',changed);
  }
  continueAbwVinLookup(changed){
    const control=this.controls.find(c=>c.field==='abw.vin'&&norm(c.value));
    if(!control)return false;
    const inputs=targets(control);if(inputs.length!==1)return false;
    const vin=inputs[0];
    const manual=query('button').filter(e=>visible(e)&&norm(e.textContent)==='заполнить вручную');
    if(manual.length!==1)return false;
    let panel=vin.parentElement;
    while(panel&&!panel.contains(manual[0]))panel=panel.parentElement;
    if(!panel||panel.querySelector('[aria-busy="true"],[aria-invalid="true"]'))return false;
    const fields=[...panel.querySelectorAll('input:not([type="hidden"]),textarea,select')].filter(rendered);
    // Once VIN lookup returns a vehicle, confirm that result instead of repeating lookup.
    const confirmation=query('button').filter(e=>visible(e)&&norm(e.textContent)==='это мой автомобиль');
    const next=confirmation.length?confirmation:[...panel.querySelectorAll('button')].filter(e=>visible(e)&&['далее','продолжить'].includes(norm(e.textContent)));
    if(fields.length!==1||fields[0]!==vin||next.length!==1||!panel.contains(next[0])||!enabled(next[0])||this.protected.has(next[0])
      ||!enabled(vin)||vin.readOnly||vin.validity?.valid===false||vin.matches('[class*="_inputError_"]')
      ||!/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin.value.trim())||!this.done.has(control.field)||!read(control,vin))return false;
    return this.continueStep(next[0],panel,confirmation.length?'abw-vin-confirm':'abw-vin-lookup',changed);
  }
  continueAv(changed){
    if(this.recipe.platform!=='av')return false;
    const buttons=query('main .newad__step-next > button[type="button"]').filter(e=>visible(e)&&enabled(e)&&norm(e.textContent)==='далее');
    if(buttons.length!==1||this.protected.has(buttons[0]))return false;
    const panel=buttons[0].closest('.newad__step');if(!panel)return false;
    if([...panel.querySelectorAll('[aria-busy="true"],[aria-invalid="true"],.error-message,.form-error')].some(visible))return false;
    const photo=panel.querySelector('input#p-27-photo[type=file]');
    if(photo){
      if(this.protected.has(photo)||!this.photos.length||!this.photoSent||!this.done.has('photos')||!this.avPhotosReady())return false;
      const widgets=[...panel.querySelectorAll('input:not([type=hidden]),textarea,select,button.dropdown__control')].filter(rendered);
      for(const e of widgets){
        if(e===photo)continue;
        if(e.id!=='p-29-video_url'||!enabled(e)||this.protected.has(e)||e.validity?.valid===false)return false;
        const c=this.controls.find(c=>c.field==='av.video_url');
        if(c&&(!this.done.has(c.field)||!read(c,e)))return false;
      }
      return this.continueStep(buttons[0],panel,'av-photos:'+JSON.stringify([...panel.querySelectorAll('.uploader__thumb img')].map(e=>e.currentSrc||e.src)),changed);
    }
    const equipment=[...panel.querySelectorAll('h2,h3')].some(e=>visible(e)&&textKey(e.textContent)==='комплектация');
    if(equipment){
      const chips=[...panel.querySelectorAll('button.chips__item[aria-pressed]')].filter(visible);
      if(!chips.length||[...panel.querySelectorAll('input:not([type=hidden]):not([type=checkbox]),textarea,select,button.dropdown__control')].some(rendered))return false;
      const c=this.controls.find(c=>c.field==='av.options');
      if(c){const ts=targets(c);if(ts.length!==1||ts[0]!==panel||!read(c,panel))return false;}
      return this.continueStep(buttons[0],panel,'av-equipment:'+JSON.stringify(chips.map(e=>[e.id,e.getAttribute('aria-pressed')])),changed);
    }
    // Reviewed technical, VIN, condition, registration and description/price steps.
    const body=panel.querySelector('#p-9-body_type'),vin=panel.querySelector('input#p-26-vin'),condition=panel.querySelector('#p-16-condition'),registration=panel.querySelector('#p-17-registration_country'),price=panel.querySelector('input#p-32-price_amount');
    if(![body,vin,condition,registration,price].some(visible))return false;
    if(visible(price)){
      for(const field of ['av.description','av.price_amount','av.price_currency']){
        const c=this.controls.find(c=>c.field===field),ts=c?targets(c):[];
        if(!c||!norm(c.value)||!this.done.has(field)||ts.length!==1||!panel.contains(ts[0])||!read(c,ts[0]))return false;
      }
      if([...panel.querySelectorAll('input')].some(e=>rendered(e)&&e.validity?.valid===false))return false;
    }
    if([...panel.querySelectorAll('[aria-busy="true"],[aria-invalid="true"],.error-message,.form-error')].some(visible))return false;
    const widgets=[...panel.querySelectorAll('button.dropdown__control,.button-group,input:not([type=radio]):not([type=checkbox]):not([type=hidden]),textarea,select')].filter(rendered);
    const suppliedVin=this.controls.find(c=>c.field==='av.vin'&&norm(c.value));
    const skipEmptyVin=e=>e===vin&&!suppliedVin&&!norm(e.value);
    if(!widgets.length||widgets.some(e=>!enabled(e)||!skipEmptyVin(e)&&e.validity?.valid===false||this.protected.has(e)))return false;
    for(const e of widgets){
      // No VIN in the card: leave the field untouched and allow one Next attempt.
      // If the site rejects it, its visible error blocks subsequent attempts.
      if(e===vin&&!suppliedVin)continue;
      const id=e.id.match(/^p-(?:\d+-)+([a-z_]+)$/)?.[1];
      const c=this.controls.find(c=>c.field==='av.'+id);
      // No exchange instruction: preserve the site's optional choice without inventing one.
      if(visible(price)&&id==='exchange_options'&&!c&&!e.matches('[required],[aria-required="true"]')&&!e.querySelector('[required],[aria-required="true"]'))continue;
      if(!c||!this.done.has(c.field))return false;
      const ts=targets(c);if(ts.length!==1||!read(c,ts[0]))return false;
    }
    // Includes selected dropdown text so a new form state cannot reuse an old stability check.
    const step=(visible(price)?'av-description-price:':registration?'av-registration:':condition?'av-condition:':body?'av-technical:':'av-vin:')+JSON.stringify(widgets.map(e=>[e.id,e.value,e.textContent]));
    return this.continueStep(buttons[0],panel,step,changed);
  }
  continueOnliner(changed){
    if(this.recipe.platform!=='onliner')return false;
    const buttons=query('.vehicle-form__step-item .vehicle-form__control a.vehicle-form__button').filter(e=>visible(e)&&enabled(e)&&['далее','продолжить'].includes(norm(e.textContent)));
    if(buttons.length!==1||this.protected.has(buttons[0]))return false;
    const panel=buttons[0].closest('.vehicle-form__step-item');
    // Only technical details, exterior and price. Contacts/final confirmation stay manual.
    const step=panel.querySelector('input[placeholder="Например, GT, CL, LX, WRC"]')?'tech':panel.querySelector('input[type="file"]')?'exterior':panel.querySelector('textarea')?'cost':null;
    if(!step||panel.querySelector('input[name="country"],input[type="tel"].vehicle-form__input_width_xxssmm,[aria-busy="true"]'))return false;
    if(step==='exterior'&&this.photos.length&&!this.done.has('photos'))return false;
    return this.continueStep(buttons[0],panel,'onliner-'+step,changed);
  }
  continueStep(button,panel,step,changed){
    // Compare the current step, not changes in unrelated controls elsewhere on the page.
    const signature=JSON.stringify([step,
      [...panel.querySelectorAll('.item-selected')].map(e=>norm(e.textContent)),
      [...panel.querySelectorAll('.button-style_active,.input-style__faux')].filter(rendered).map(e=>norm(e.textContent)),
      [...panel.querySelectorAll('input,select,textarea')].filter(rendered).map(e=>[e.name,e.value,e.checked]),
    ]);
    if(this.continueSnapshot!==signature){this.continueSnapshot=signature;this.continueStable=changed?0:1;return false;}
    if(++this.continueStable<2)return false;
    this.continueAttempts??=new Set();if(this.continueAttempts.has(signature))return false;
    this.continueAttempts.add(signature);this.click(button);return true;
  }
  ready(){return this.recipe.platform==='kufar'?query('[data-name="cars_brand_v2"]').some(visible):this.recipe.platform==='av'?query('input,select,textarea,button.dropdown__control,button.chips__item[aria-pressed]').some(rendered):query('input,select,textarea').some(visible);}
  blockedReason(){
    if(this.recipe.platform==='abw'){
      const c=this.controls.find(c=>c.field==='abw.phone'&&norm(c.value));
      if(c){const ts=targets(c);if(ts.length===1&&(!enabled(ts[0])||ts[0].readOnly)&&!read(c,ts[0]))
        return 'Телефон в объявлении отличается от телефона аккаунта ABW. Поле заблокировано площадкой; проверьте номер перед продолжением.';}
    }
    return null;
  }
  awaitingPhotos(){return this.photoSent&&this.photos.length&&!this.done.has('photos');}
  avPhotosReady(){
    const v=this.recipe.photoBinding?.verify;if(this.recipe.platform!=='av'||v?.kind!=='local_previews_ready')return false;
    const boxes=(v.target?.selectors||[]).flatMap(query).filter(visible);if(boxes.length!==1)return false;
    const box=boxes[0],items=[...box.querySelectorAll(v.items_selector)];
    if(!this.photos.length||items.length!==this.photos.length||items.length>v.counter.capacity)return false;
    if([...box.querySelectorAll('[aria-busy="true"],[aria-invalid="true"],.error-message,.form-error')].some(visible))return false;
    if(items.some(item=>{
      const imgs=[...item.querySelectorAll(v.image_selector)];
      return imgs.length!==1||!(imgs[0].currentSrc||imgs[0].src).startsWith(v.accepted_src_prefix)||!imgs[0].complete||imgs[0].naturalWidth<=0||
        v.ready_controls.some(selector=>{const controls=[...item.querySelectorAll(selector)];return controls.length!==1||!enabled(controls[0]);});
    }))return false;
    const counters=[...box.querySelectorAll(v.counter_selector)],match=counters.length===1?norm(counters[0].textContent).match(new RegExp(v.counter.pattern)):null;
    return !!match&&v.counter.capacity-Number(match[1])===items.length;
  }
  remaining(){return [...this.controls.filter(c=>!this.done.has(c.field)).map(c=>c.label||c.field),...(this.photos.length&&!this.done.has('photos')?['Фотографии']:[]),...(this.recipe.issues||[])];}
  async photo(){
    if(!this.photos.length||this.done.has('photos')&&!['abw','av'].includes(this.recipe.platform))return false;
    const b=this.recipe.photoBinding||{};
    if(this.photoSent){
      if(this.recipe.platform==='av'&&b.verify?.kind==='local_previews_ready'){
        if(this.done.has('photos')&&!query('input#p-27-photo[type=file]').some(rendered))return false;
        const ready=this.avPhotosReady(),was=this.done.has('photos');
        if(ready)this.done.add('photos');else this.done.delete('photos');
        return ready&&!was;
      }
      const v=b.verify;if(!v?.accepted_src_prefix)return false;
      const containers=(v.target?.selectors||[]).flatMap(query).filter(visible),items=containers.flatMap(e=>[...e.querySelectorAll(v.items_selector)]);
      let count=0;
      for(const item of items){const img=item.querySelector(v.image_selector);if(!img)continue;
        if(v.image_source==='background_image'){const source=getComputedStyle(img).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];if(source?.startsWith(v.accepted_src_prefix)){
          this.photoProbes??=new Map();let probe=this.photoProbes.get(source);
          if(!probe){probe=new Image();probe.src=source;this.photoProbes.set(source,probe);}
          if(probe.complete&&probe.naturalWidth>0)count++;
        }}
        else if(img.src?.startsWith(v.accepted_src_prefix)&&img.complete&&img.naturalWidth>0)count++;
      }
      const counters=(v.counter_target?.selectors||[]).flatMap(query).filter(visible);
      let counterOK=!v.counter_target;
      if(counters.length===1){const label=counters[0].textContent.trim(),match=label.match(new RegExp(v.counter?.pattern||'^(\\d+)\\s*(?:/|из)\\s*\\d+'));
        if(match)counterOK=(v.counter?.mode==='remaining'?v.counter.capacity-Number(match[1]):Number(match[1]))===count;
      }
      if(count===this.photos.length&&counterOK){const changed=!this.done.has('photos');this.done.add('photos');return changed;}
      this.done.delete('photos');return false;
    }
    const inputs=(b.target?.selectors||['input[type=file]']).flatMap(query).filter(e=>e.type==='file'&&enabled(e));
    if(inputs.length!==1||this.protected.has(inputs[0])||inputs[0].files?.length)return false;
    const v=b.verify;if(v?.target?.selectors&&(v.target.selectors.flatMap(query)).some(box=>box.querySelector(v.items_selector)))return false;
    if(!await this.claimPhotos())return false;
    const dt=new DataTransfer();for(const p of this.photos){const bytes=Uint8Array.from(atob(p.dataUrl.split(',')[1]),x=>x.charCodeAt(0));dt.items.add(new File([bytes],p.name,{type:p.type||'image/jpeg'}));}
    inputs[0].files=dt.files;inputs[0].dispatchEvent(new Event('change',{bubbles:true}));this.photoSent=true;return true;
  }
  async tick(){
    if(this.openCarCategory())return true;
    if(this.openUsedCarForm())return true;
    if(this.openManualForm())return true;
    if(!this.ready())return false;
    let changed=false;
    // A shared popup belongs to one field until selection settles or its bounded wait expires.
    // Reopening another field on every poll used to toggle Kufar's body picker indefinitely.
    if(this.activeDropdown&&++this.dropdownTicks>6)this.resumeQueries();
    const controls=this.activeDropdown?this.controls.filter(c=>c.field===this.activeDropdown):this.controls;
    for(const c of controls){
      if(c.value===null||c.binding?.status==='unsupported'||c.field==='abw.region')continue;
      if((c.binding?.depends_on||[]).some(id=>this.controls.some(x=>x.field===id)&&!this.done.has(id)))continue;
      const ts=targets(c);if(ts.length!==1)continue;const e=ts[0];
      if(read(c,e)){this.done.add(c.field);if(this.activeDropdown===c.field)this.resumeQueries();continue;}
      this.done.delete(c.field);
      if(this.protected.has(e)||this.protected.has(c)||!enabled(e)||e.readOnly)continue;
      const action=c.binding?.action;
      if(action==='select_toggles'){
        if(!Array.isArray(c.value))continue;
        const choices=toggleChoices(c,e);
          const next=c.value.map(v=>toggleMatches(choices,v.value)).find(matches=>matches.length===1&&matches[0].getAttribute('aria-pressed')!=='true'&&enabled(matches[0])&&!this.protected.has(matches[0])&&!this.tried.has(matches[0]));
          if(next){this.tried.add(next[0]);this.click(next[0]);changed=true;break;}
        continue;
      }
      if(c.binding?.preserve_selected&&query(c.binding.preserve_selected).some(rendered))continue;
      // Preserve a modification already selected manually or restored by ABW.
      if(c.binding?.match==='engine_transmission'&&norm(e.querySelector('.item-selected,.dropdown-button__value')?.textContent))continue;
      if(action==='set_value'||!action&&c.fieldType!=='enum'&&['INPUT','TEXTAREA'].includes(e.tagName)){
        // Existing form values are preserved, even if different from this card.
        if(e.value&&!c.binding?.replace_existing||e.type==='file'||['radio','checkbox'].includes(e.type)||this.tried.has(e))continue;
        this.tried.add(e);setValue(e,c.value);changed=true;continue;
      }
      if(action==='set_checked'){
        if(this.tried.has(e)||typeof c.value!=='boolean')continue;this.tried.add(e);
        if(e.checked!==c.value)this.click(visible(e)?e:e.labels?.[0]);changed=true;continue;
      }
      if(Array.isArray(c.value)){
        const b=c.binding||{},s=b.suggestions;
        if(!s?.checkbox_selector||!s.selector)continue;
        const shared=this.recipe.platform==='kufar'&&s.selector.includes('popup-body');
        const choices=shared&&this.activeDropdown!==c.field?[]:this.popupQuery(e,s.selector).filter(visible),wanted=c.value.map(x=>textKey(x.name));
        if(!choices.length){if(this.pending.get(c.field)==='complete'){this.done.add(c.field);if(this.activeDropdown===c.field)this.resumeQueries();continue;}if(this.openDropdown(c,e)){changed=true;break;}continue;}
        const selected=choices.filter(x=>x.querySelector(s.checkbox_selector)?.checked);
        // Existing selections not in this card belong to the user; never clear them.
        if(selected.some(x=>!wanted.includes(textKey(content(x)))))continue;
        const missing=c.value.find(v=>!selected.some(x=>textKey(content(x))===textKey(v.name)));
        if(missing){const match=choices.filter(x=>textKey(content(x))===textKey(missing.name));if(match.length===1){const input=match[0].querySelector(s.checkbox_selector);if(input&&enabled(input)&&!this.tried.has(input)){this.tried.add(input);this.click(match[0]);this.dropdownTicks=0;changed=true;break;}}continue;}
        if(selected.length===wanted.length){this.done.add(c.field);this.pending.set(c.field,'complete');const commit=(b.commit?.target?.selectors||[]).flatMap(s=>this.popupQuery(e,s)).filter(visible);if(commit.length===1){this.click(commit[0]);this.activeDropdown=null;changed=true;break;}}
        continue;
      }
      const isSelect=e.tagName==='SELECT';
      if(c.binding?.searchSelector){const search=query(c.binding.searchSelector).filter(visible);if(search.length===1&&!search[0].value&&!this.protected.has(search[0])){setValue(search[0],c.name);this.dropdownTicks=0;changed=true;break;}}
      let candidates=isSelect?[...e.options]:(c.binding?.suggestions?.within_target?[...e.querySelectorAll(c.binding.suggestions.within_target)]:c.binding?.suggestions?.selector?this.popupQuery(e,c.binding.suggestions.selector):query('[role=option],.dropdown-list__item,.select__option'));
      if(this.recipe.platform==='kufar'&&c.binding?.suggestions?.selector?.includes('popup-body')&&this.activeDropdown!==c.field)candidates=[];
      candidates=candidates.filter(x=>enabled(x)&&rendered(x)&&(c.binding?.match==='element_id'?x.id===c.binding.id_prefix+String(c.value):c.binding?.match==='value'||c.binding?.match==='av_native_option'&&x.matches('input[type=radio]')?equal(x.value,c.value):c.binding?.match==='engine_transmission'?modificationMatches(content(x),c.name):textKey(content(x))===textKey(c.binding?.optionLabels?.[c.value]??c.binding?.displayLabels?.[c.value]??c.name)));
      if(c.binding?.match==='engine_transmission')candidates=candidates.slice(0,1);
      if(candidates.length===1){const option=candidates[0];
        if(this.tried.has(option))continue;this.tried.add(option);
        if(option.tagName==='OPTION')setValue(option.parentElement,option.value);
        else this.click(visible(option)?option:option.labels?.[0]);
        if(this.activeDropdown===c.field)this.dropdownTicks=0;
        changed=true;break; // Verify the selection before opening a different shared popup.
      }
      if(!candidates.length&&c.binding?.expandSelector){const more=query(c.binding.expandSelector).filter(visible);if(more.length===1&&!this.tried.has(more[0])){this.tried.add(more[0]);this.click(more[0]);this.dropdownTicks=0;changed=true;break;}}
      if(c.binding?.open!==false&&!isSelect&&!['INPUT','TEXTAREA'].includes(e.tagName)&&this.activeDropdown!==c.field&&e.tagName!=='FORM'&&!e.classList.contains('vehicle-form')){
        if(this.openDropdown(c,e)){changed=true;break;}
      }
    }
    if(await this.photo())changed=true;
    if(!this.activeDropdown&&(this.continueAbw(changed)||this.continueOnliner(changed)||this.continueAv(changed)))changed=true;
    return changed||!!this.activeDropdown;
  }
 }
 root.AutopostCarForm=Object.freeze({Form,visible,norm});
 if(typeof module!=='undefined')module.exports=root.AutopostCarForm;
})(globalThis);
