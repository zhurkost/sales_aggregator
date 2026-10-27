/* AV.by DOM adapter. Selectors verified in user-supplied HAR, 2026-10-27.
 * Uses the site's rendered controls only; no replay of captured requests/tokens. */
(function(root){
  'use strict';
  const dom=root.AutopostDOM, norm=dom.normalize;
  const base={brand:'brand',model:'model',year:'year',body_type:'body',transmission_type:'transmission',engine_type:'fuel',drive_type:'drive',engine_capacity:'engine',vin:'vin',mileage:'mileage',color:'color',description:'description',price_currency:'currency',price_amount:'price',place_city:'city'};
  const labels={condition_promotion:'Состояние',brand:'Марка',model:'Модель',year:'Год',generation:'Поколение',body_type:'Кузов',number_of_seats:'Количество мест',transmission_type:'Коробка передач',engine_type:'Тип двигателя',engine_capacity:'Объем, см³',engine_endurance:'Запас хода, км',drive_type:'Привод',modification:'Модификация',vin:'Код из 17 символов',condition:'Состояние',mileage:'Пробег',mileage_unit:'Единицы измерения пробега',color:'Цвет кузова',interior_material:'Материал салона',interior_color:'Цвет салона',registration_country:'Страна регистрации',registration_status:'Учёт',description:'Описание',price_currency:'Валюта',price_amount:'Цена',exchange_options:'Обмен',exchange_comment:'Комментарий к обмену',video_url:'Видео из YouTube',place_region:'Область',place_city:'Город',name:'Имя продавца',phone_country:'Телефонный код страны',phone_number:'Номер телефона'};
  const order=['condition_promotion','brand','model','year','generation','body_type','number_of_seats','transmission_type','engine_type','drive_type','modification','engine_capacity','engine_endurance','vin','condition','mileage_unit','mileage','color','interior_material','interior_color','registration_country','registration_status','description','price_currency','price_amount','exchange_options','exchange_comment','video_url','place_region','place_city','name','phone_country','phone_number'];
  const required=new Set(['condition_promotion','brand','model','year','body_type','transmission_type','engine_type','drive_type','modification','condition','mileage','color','interior_material','interior_color','registration_country','registration_status','price_currency','price_amount','exchange_options','place_region','place_city','name','phone_country','phone_number']);
  const parents=new Set(['condition_promotion','brand','model','year','generation','body_type','transmission_type','engine_type','drive_type']);
  const active=task=>!task.paused&&!task.complete&&(!task.expiresAt||Date.now()<task.expiresAt);
  function visible(el){return !!el && dom.visible(el) && !el.closest('[hidden],[inert],header,nav,#autopost-helper-panel');}
  function ready(el){return visible(el)&&!el.disabled&&!el.readOnly&&!el.closest('[aria-disabled="true"],.generations__item--disabled');}
  function scope(name){
    if(name==='condition_promotion')return [...document.querySelectorAll('.category__section--cars')].find(visible)||null;
    const catalog=[...document.querySelectorAll('.newad__catalog')].filter(visible).find(el=>
      el.querySelector(`[id^="catalogItem-${name}_"]`) || norm(el.querySelector('.catalog__header')?.textContent)===norm(name==='condition_promotion'?'Подраздел':labels[name]));
    if(catalog)return catalog;
    if(name==='generation')return [...document.querySelectorAll('.generations')].find(visible)||null;
    // Property UID is p[-parent][-row]-id[-type]-name in the captured client.
    const exact=[...document.querySelectorAll(`[id^="p-"][id$="-${name}"],[name^="p-"][name$="-${name}"]`)].filter(visible);
    if(exact.length){const el=exact[0];return el.closest('.form-row__item')||el.closest('.form-phone-row')||el.parentElement;}
    const label=[...document.querySelectorAll('.newad__step .form-label,.newad__step .form-label-alt')].filter(el=>visible(el)&&norm(el.textContent)===norm(labels[name]));
    return label.length===1?label[0].closest('.form-row__item')||label[0].parentElement:null;
  }
  function controlFor(s,name){
    const exact=[...s.querySelectorAll(`[id^="p-"][id$="-${name}"],[name^="p-"][name$="-${name}"]`)].filter(visible);
    return exact.find(el=>el.matches('input,textarea,select,button,.button-group'))||null;
  }
  function group(s,name){const c=controlFor(s,name);return c?.matches('.button-group')?c:c?.closest('.dropdown')||s;}
  function radios(s,name){
    const g=group(s,name);
    return [...g.querySelectorAll('input[type="radio"]')].filter(el=>ready(el.closest('label')||el)&&!el.disabled);
  }
  function textOf(el){const label=el.closest('label');return (label?.querySelector('.catalog__description-text,.generations__title,.button-group__text,.radiobutton__description')||label||el).textContent?.trim()||'';}
  function current(s,name){
    if(name==='condition_promotion')return s.querySelector('.category-item__button--active .category-item__title')?.textContent||'';
    const c=controlFor(s,name);
    if(c?.matches('input:not([type=radio]):not([type=checkbox]),textarea,select'))return c.tagName==='SELECT'?(c.value?c.selectedOptions[0]?.textContent:''):c.value;
    const checked=radios(s,name).find(el=>el.checked);
    if(checked)return textOf(checked);
    const dropdown=c?.matches('.dropdown__control')?c:group(s,name).querySelector('.dropdown__control');
    return dropdown?.classList.contains('dropdown__control--active')?dropdown.querySelector('.dropdown-button__value,.dropdown-link__value,.dropdown-floatlabel__text')?.textContent||dropdown.textContent:'';
  }
  function variants(name,value){
    const list=[String(value||''),...(base[name]?dom.values(base[name],value):[])];
    const aliases={transmission_type:{'Автомат':'автомат','Механика':'механика','Робот':'робот','Вариатор':'вариатор'},drive_type:{'Передний':'передний привод','Задний':'задний привод'},engine_type:{'Электро':'электро','Электрический':'электро'},interior_material:{'Текстиль':'ткань'},interior_color:{'Комбинированный':'комби'}};
    if(aliases[name]?.[value])list.push(aliases[name][value]);
    if(name==='number_of_seats'&&/^\d+$/.test(value))list.push(value+' мест');
    if(name==='price_currency')list.push(...(value==='BYN'?['руб.','р.']:value==='USD'?['$']:[]));
    if(name==='phone_country')list.push('🇧🇾 +375');
    return list.map(norm);
  }
  function desired(task){
    const out={};
    for(const [name,key] of Object.entries(base))if(task.listing[key])out[name]={value:task.listing[key],key};
    const reused={cars_seats:'number_of_seats',cars_interior_material:'interior_material',cars_interior_color:'interior_color',cars_gen_v2:'generation',content_video:'video_url'};
    for(const a of task.attributes||[])if(reused[a.key])out[reused[a.key]]={value:a.text,key:'attribute:'+a.key};
    for(const a of task.attributes||[])if(a.platform==='av'&&Object.hasOwn(labels,a.formName))out[a.formName]={value:a.text,key:'attribute:'+a.key};
    if(out.engine_capacity){const v=Number(out.engine_capacity.value.replace(',','.'));if(v>0&&v<20)out.engine_capacity={...out.engine_capacity,value:String(Math.round(v*1000))};else delete out.engine_capacity;}
    if(!out.condition_promotion){
      const condition=norm(task.listing.condition);
      if(/^нов(ый|ая|ое)$/.test(condition))out.condition_promotion={value:'Новый автомобиль',key:'condition'};
      else if(['б у','с пробегом'].includes(condition)||Number(task.listing.mileage)>1000||Number(task.listing.year)>1885&&Number(task.listing.year)<new Date().getFullYear()-1)
        out.condition_promotion={value:'Автомобиль с пробегом',key:'category'};
    }
    if(!out.condition&&out.condition_promotion?.value==='Новый автомобиль')out.condition={value:'новый',key:out.condition_promotion.key};
    if(out.mileage)out.mileage_unit={value:'км',key:'mileage'};
    if(!out.place_region&&task.listing.city){
      const regions={'минск':'Минская обл.','брест':'Брестская обл.','витебск':'Витебская обл.','гомель':'Гомельская обл.','гродно':'Гродненская обл.','могилев':'Могилевская обл.'};
      if(regions[norm(task.listing.city)])out.place_region={value:regions[norm(task.listing.city)],key:'city'};
    }
    const phone=String(task.listing.phone||'').replace(/\D/g,'');
    if(/^375\d{9}$/.test(phone)){out.phone_country={value:'+375',key:'phone'};out.phone_number={value:phone.slice(3),key:'phone'};}
    return out;
  }
  const wait=dom.pause;
  function matches(name,a,b){return name==='phone_number'?String(a).replace(/\D/g,'')===String(b).replace(/\D/g,''):variants(name,b).includes(norm(a));}
  function crumb(value){return [...document.querySelectorAll('.newad__breadcrumb-button')].some(el=>visible(el)&&norm(el.textContent)===norm(value));}
  function stamp(s){return s.textContent+JSON.stringify([...s.querySelectorAll('input,textarea,select,button')].map(el=>[el.value,el.checked,el.disabled]));}
  async function choose(task,name,wanted){
    let s=scope(name);if(!s)return {absent:true};
    const prior=current(s,name),value=wanted?.value;
    task.avUnits ||= {};
    const unit=['price_currency','mileage_unit','phone_country'].includes(name);
    if(prior&&value&&matches(name,prior,value)){if(unit)task.avUnits[name]=value;return {filled:true};}
    if(!active(task))return {reason:'Очередь приостановлена'};
    // Retain values already on the site, including corrections and saved drafts.
    if(prior&&(!unit||task.avUnits[name]))return value?{reason:'Уже выбрано на площадке: '+prior}:{retained:true};
    if(name==='condition_promotion'){
      if(!value)return {reason:'Укажите: новый автомобиль или с пробегом'};
      const buttons=[...s.querySelectorAll('.category-item__button')].filter(el=>ready(el)&&!el.classList.contains('category-item__button--disabled')&&matches(name,el.querySelector('.category-item__title')?.textContent,value));
      if(buttons.length!==1)return {reason:'Нет точного варианта'};
      buttons[0].click();
      for(let i=0;i<15;i++){await wait(100);const next=scope(name);if(next&&matches(name,current(next,name),value)||!next&&crumb(value))return {filled:true,changed:true};}
      return {reason:'Подтвердите выбор подраздела в окне AV.by'};
    }
    let options=radios(s,name),chosen=value?options.filter(el=>matches(name,textOf(el),value)):[];
    if(!value&&name==='generation'&&options.length===1)chosen=options;
    if(value&&!chosen.length&&s.matches('.newad__catalog')){
      const more=s.querySelector('.catalog__show-all button');
      if(ready(more)){more.click();await wait(150);s=scope(name)||s;options=radios(s,name);chosen=options.filter(el=>matches(name,textOf(el),value));}
    }
    const c=controlFor(s,name);
    if(!options.length&&c?.matches('input:not([type=radio]):not([type=checkbox]),textarea,select')){
      if(!value)return {reason:'Укажите значение в карточке или на площадке'};
      if(!ready(c))return {reason:'Ждём доступности поля'};
      const reason=dom.setNative(c,name,String(value));if(reason)return {reason};
      await wait(180);const next=scope(name),actual=next&&current(next,name);
      return matches(name,actual,value)?{filled:true,changed:true}:{reason:'Площадка ещё не подтвердила значение'};
    }
    if(!options.length){
      const dropdown=c?.matches('.dropdown__control')?c:s.querySelector('.dropdown__control');
      if(!ready(dropdown))return {reason:value?'Ждём вариантов поля':'Укажите значение в карточке или на площадке'};
      // Even a sole modification must match engine volume when it is supplied.
      if(!value&&!['generation','modification'].includes(name))return {reason:'Укажите значение в карточке или на площадке'};
      if(dropdown.getAttribute('aria-pressed')!=='true')dropdown.click();
      for(let i=0;i<20;i++){
        await wait(100);
        if(!active(task))return {reason:'Очередь приостановлена'};
        const popup=dropdown.closest('.dropdown')||s;
        options=[...popup.querySelectorAll('.dropdown__listbutton')].filter(ready);
        if(options.length)break;
      }
      chosen=value?options.filter(el=>matches(name,el.textContent,value)):[];
      if(!value&&name==='modification'){
        const capacity=Number(String(task.listing.engine||'').replace(',','.'));
        chosen=options.filter(el=>{const m=el.textContent.match(/^(\d+[.,]\d+)/);return capacity>0?m&&Math.abs(Number(m[1].replace(',','.'))-capacity)<0.01:options.length===1;});
      }
      if(chosen.length!==1){dropdown.click();return {reason:options.length?'Нет однозначного варианта. Уточните значение':'Ждём загрузки вариантов'};}
    }
    if(chosen.length!==1)return {reason:value?'Нет точного варианта':'Укажите значение в карточке или на площадке'};
    if(!active(task))return {reason:'Очередь приостановлена'};
    const selected=chosen[0],label=options[0]?.tagName==='INPUT'?textOf(selected):selected.textContent.trim();
    selected.click();
    for(let i=0;i<15;i++){
      await wait(100);const next=scope(name);
      if(next&&matches(name,current(next,name),value||label)||!next&&crumb(label)){if(unit)task.avUnits[name]=value;return {filled:true,changed:true};}
    }
    return {reason:'Выбор ещё не подтверждён площадкой'};
  }
  async function fill(task){
    const result={filled:[],skipped:[],details:[],continue:false};
    task.avAttempts ||= new Map();
    const values=desired(task);let blocked=false,recognized=false;
    for(const name of order){
      if(!active(task)){blocked=true;result.details.push('Очередь приостановлена');break;}
      const s=scope(name);if(!s)continue;
      recognized=true;
      const wanted=values[name],key=wanted?.key||'attribute:av_'+name;
      if(!wanted&&!required.has(name)&&!['generation','modification'].includes(name))continue;
      // Price and mileage amounts must never be applied under a different unit.
      const unit=name==='price_amount'?'price_currency':name==='mileage'?'mileage_unit':name==='phone_number'?'phone_country':null;
      if(unit&&values[unit]){const field=scope(unit);if(!field||!matches(unit,current(field,unit),values[unit].value)){blocked=true;result.details.push(labels[name]+': сначала подтвердите '+labels[unit].toLowerCase());continue;}}
      const state=stamp(s),last=task.avAttempts.get(name);
      let r;
      if(last?.state===state&&last.value===wanted?.value&&Date.now()<last.retryAt)r={reason:last.reason};
      else r=await choose(task,name,wanted);
      if(r.filled){result.filled.push(key);task.avAttempts.delete(name);}
      else if(r.reason){
        result.skipped.push(key);result.details.push(labels[name]+': '+r.reason);
        task.avAttempts.set(name,{state:stamp(scope(name)||s),value:wanted?.value,reason:r.reason,retryAt:Date.now()+3000});
        if(required.has(name)||wanted||name==='generation')blocked=true;
        if(parents.has(name))break;
      }
      if(r.changed){result.continue=true;result.message='Заполняем '+labels[name].toLowerCase()+'; ждём следующий шаг AV.by.';return result;}
    }
    const errors=[...document.querySelectorAll('.newad__step .error-message,.newad__step .form-error')].filter(visible);
    if(errors.length){blocked=true;result.details.push(...errors.map(el=>el.textContent.trim()).filter(Boolean).slice(0,4));}
    if([...document.querySelectorAll('#photo-block-id')].some(visible)&&task.photos?.length&&task.photosTransferred!==task.photos.length){blocked=true;result.details.push('Фотографии ещё не переданы. Дождитесь загрузки или добавьте их на площадке.');}
    const next=[...document.querySelectorAll('.newad__step-next button')].filter(el=>ready(el)&&el.type!=='submit'&&norm(el.textContent)==='далее');
    if(!blocked&&active(task)&&next.length===1){
      const step=next[0].closest('.newad__step'),state=stamp(step);
      if(task.avStable?.state!==state){task.avStable={state,at:Date.now()};result.continue=true;result.message='Ждём завершения обновления полей AV.by.';return result;}
      if(Date.now()-task.avStable.at<1000){result.continue=true;result.message='Проверяем заполнение шага AV.by.';return result;}
      if(task.avNext!==state){task.avNext=state;next[0].click();result.continue=true;result.message='Переходим к следующему шагу AV.by.';return result;}
    }
    if(!recognized&&!next.length&&!document.querySelector('.newad__submit')){
      result.waiting=true;result.message='Ждём загрузки полей AV.by. Заполнение продолжится автоматически.';return result;
    }
    result.message=blocked?'Нужны данные для AV.by: '+result.details.slice(0,2).join('; '):'Доступные поля AV.by заполнены. Проверьте данные и завершите подачу на площадке.';
    result.blocked=blocked;return result;
  }
  root.AutopostAV=Object.freeze({fill,scope,desired,variants});
})(globalThis);
