(function(root){
 'use strict';
 const norm=v=>String(v??'').normalize('NFKC').trim().toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ');
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
    norm(e.getAttribute('placeholder'))===norm(c.label)||norm(e.getAttribute('aria-label'))===norm(c.label)||[...e.labels||[]].some(l=>norm(l.textContent)===norm(c.label))));
   if(controls.length===1)return controls[0];
   const labels=query('label,.form-label,.form__label').filter(e=>visible(e)&&norm(e.textContent.replace(/\*$/,''))===norm(c.label));
   if(labels.length!==1)return null;
   const group=labels[0].closest('.form-row,.form__field,.form-item,.form__group')||labels[0].parentElement;
   controls=[...group.querySelectorAll('input:not([type=hidden]),textarea,select,button.dropdown__control')].filter(e=>rendered(e)&&enabled(e));
   return controls.length===1?controls[0]:null;
 }
 function targets(c){const b=c.binding||{};if(b.status==='unsupported')return [];
  if(b.target?.label){const labels=query(b.target.labels).filter(e=>visible(e)&&norm(e.textContent)===norm(b.target.label));if(labels.length!==1)return [];const box=b.target.container?labels[0].closest(b.target.container):labels[0].parentElement;const found=b.target.selector?[...box?.querySelectorAll(b.target.selector)||[]]:[box];return found.filter(e=>e&&rendered(e)&&enabled(e));}
  if(b.target?.selectors){for(const selector of b.target.selectors){const found=query(selector).filter(e=>rendered(e)&&enabled(e));if(found.length)return found;}}const e=fallback(c);return e?[e]:[];}
 function read(c,target){const b=c.binding||{},v=b.verify||{};const candidates=v.within_target?[...target.querySelectorAll(v.within_target)].filter(rendered):v.target?.selectors? v.target.selectors.flatMap(query).filter(rendered):[target];
  // Onliner removes the identity radio group after selection and shows its name in the step header.
  if(!candidates.length&&v.fallbackTextSelectors){const labels=v.fallbackTextSelectors.flatMap(query).filter(e=>visible(e)&&!!norm(c.name)&&norm(e.textContent)===norm(c.name));return labels.length===1;}
  if(candidates.length!==1)return false;const e=candidates[0];
  if(v.kind==='checked_equals'||b.action==='set_checked')return e.checked===c.value;
  if(v.kind==='value_equals'||b.action==='set_value'||b.action==='select_option'||!b.action&&['INPUT','TEXTAREA','SELECT'].includes(e.tagName))return equal(e.value,c.value);
  return norm(e.tagName==='SELECT'?e.selectedOptions[0]?.textContent:content(e))===norm(b.displayLabels?.[c.value]??c.name);
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
    const links=query('a,button').filter(e=>visible(e)&&enabled(e)&&(e.querySelector('.category-item__title')
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
    const buttons=query('.adverts-form > button[type="button"]').filter(e=>visible(e)&&enabled(e)&&norm(e.textContent)==='продолжить');
    if(buttons.length!==1||this.protected.has(buttons[0]))return false;
    const panel=buttons[0].parentElement;
    // Only the reviewed vehicle-details step; no publication, contacts or paid promotion steps.
    const labels=[...panel.querySelectorAll('.item-title')].filter(visible).map(e=>norm(e.textContent));
    if(!['марка','модель','год выпуска'].every(label=>labels.includes(label))||panel.querySelector('[aria-busy="true"]'))return false;
    return this.continueStep(buttons[0],panel,'abw-details',changed);
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
  ready(){return this.recipe.platform==='kufar'?query('[data-name="cars_brand_v2"]').some(visible):query('input,select,textarea').some(visible);}
  blockedReason(){return null;}
  awaitingPhotos(){return this.photoSent&&this.photos.length&&!this.done.has('photos');}
  remaining(){return [...this.controls.filter(c=>!this.done.has(c.field)).map(c=>c.label||c.field),...(this.photos.length&&!this.done.has('photos')?['Фотографии']:[]),...(this.recipe.issues||[])];}
  async photo(){
    if(!this.photos.length||this.done.has('photos'))return false;
    const b=this.recipe.photoBinding||{};
    if(this.photoSent){
      const v=b.verify;if(!v?.accepted_src_prefix)return false;
      const containers=(v.target?.selectors||[]).flatMap(query).filter(visible),items=containers.flatMap(e=>[...e.querySelectorAll(v.items_selector)]);
      let count=0;
      for(const item of items){const img=item.querySelector(v.image_selector);if(!img)continue;
        if(v.image_source==='background_image'){const source=getComputedStyle(img).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];if(source?.startsWith(v.accepted_src_prefix)){const probe=new Image();probe.src=source;if(probe.complete&&probe.naturalWidth>0)count++;}}
        else if(img.src?.startsWith(v.accepted_src_prefix)&&img.complete&&img.naturalWidth>0)count++;
      }
      const counters=(v.counter_target?.selectors||[]).flatMap(query).filter(visible);
      let counterOK=!v.counter_target;
      if(counters.length===1){const label=counters[0].textContent.trim(),match=label.match(new RegExp(v.counter?.pattern||'^(\\d+)\\s*(?:/|из)\\s*\\d+'));
        if(match)counterOK=(v.counter?.mode==='remaining'?v.counter.capacity-Number(match[1]):Number(match[1]))===count;
      }
      if(count===this.photos.length&&counterOK){this.done.add('photos');return true;}return false;
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
      if(this.protected.has(e)||this.protected.has(c))continue;
      const action=c.binding?.action;
      if(action==='set_value'||!action&&c.fieldType!=='enum'&&['INPUT','TEXTAREA'].includes(e.tagName)){
        // Existing form values are preserved, even if different from this card.
        if(e.value||e.type==='file'||['radio','checkbox'].includes(e.type)||this.tried.has(e))continue;
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
        const choices=shared&&this.activeDropdown!==c.field?[]:query(s.selector).filter(visible),wanted=c.value.map(x=>norm(x.name));
        if(!choices.length){if(this.pending.get(c.field)==='complete'){this.done.add(c.field);if(this.activeDropdown===c.field)this.resumeQueries();continue;}if(this.openDropdown(c,e)){changed=true;break;}continue;}
        const selected=choices.filter(x=>x.querySelector(s.checkbox_selector)?.checked);
        // Existing selections not in this card belong to the user; never clear them.
        if(selected.some(x=>!wanted.includes(norm(content(x)))))continue;
        const missing=c.value.find(v=>!selected.some(x=>norm(content(x))===norm(v.name)));
        if(missing){const match=choices.filter(x=>norm(content(x))===norm(missing.name));if(match.length===1){const input=match[0].querySelector(s.checkbox_selector);if(input&&enabled(input)&&!this.tried.has(input)){this.tried.add(input);this.click(match[0]);this.dropdownTicks=0;changed=true;break;}}continue;}
        if(selected.length===wanted.length){this.done.add(c.field);this.pending.set(c.field,'complete');const commit=(b.commit?.target?.selectors||[]).flatMap(query).filter(visible);if(commit.length===1){this.click(commit[0]);this.activeDropdown=null;changed=true;break;}}
        continue;
      }
      const isSelect=e.tagName==='SELECT';
      if(c.binding?.searchSelector){const search=query(c.binding.searchSelector).filter(visible);if(search.length===1&&!search[0].value&&!this.protected.has(search[0])){setValue(search[0],c.name);this.dropdownTicks=0;changed=true;break;}}
      let candidates=isSelect?[...e.options]:(c.binding?.suggestions?.within_target?[...e.querySelectorAll(c.binding.suggestions.within_target)]:c.binding?.suggestions?.selector?query(c.binding.suggestions.selector):query('[role=option],.dropdown-list__item,.select__option'));
      if(this.recipe.platform==='kufar'&&c.binding?.suggestions?.selector?.includes('popup-body')&&this.activeDropdown!==c.field)candidates=[];
      candidates=candidates.filter(x=>enabled(x)&&rendered(x)&&(c.binding?.match==='value'?equal(x.value,c.value):norm(content(x))===norm(c.binding?.displayLabels?.[c.value]??c.name)));
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
    if(!this.activeDropdown&&(this.continueAbw(changed)||this.continueOnliner(changed)))changed=true;
    return changed||!!this.activeDropdown;
  }
 }
 root.AutopostCarForm=Object.freeze({Form,visible,norm});
 if(typeof module!=='undefined')module.exports=root.AutopostCarForm;
})(globalThis);
