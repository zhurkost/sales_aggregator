/* Opt-in submission adapters. Only observed forms; no private APIs or remote code. */
(function (root) {
  'use strict';
  const forms = {kufar:'#ai-form',onliner:'#posting'};
  function supported(platform, listing) {
    return platform === 'kufar' || platform === 'onliner' && listing.category !== 'cars';
  }
  function form(document, platform) { return document.querySelector(forms[platform] || ':not(*)'); }
  function fileInput(document, platform) {
    return form(document,platform)?.querySelector(platform === 'kufar' ? '#imageLoaderDropzone' : 'input[type="file"][name="file"]');
  }
  const text = e => (e?.innerText || e?.textContent || '').trim();
  const fail = message => ({ready:false,message});
  function prepareFree(document, platform, task) {
    if (platform!=='kufar') return;
    const f=form(document,platform), free=f?.querySelector('[data-cy="vas-no_vas"]');
    if (free && !task.freeOptionChosen) { task.freeOptionChosen=true; free.click(); }
    if (!f?.querySelector('[name="phone_hidden"]:checked') && !task.contactOptionChosen) {
      const choice=f?.querySelector(task.listing.phone ? '[data-testid="communication_phone"]' : '[data-testid="communication_message"]');
      if(choice && !choice.disabled) {task.contactOptionChosen=true;choice.click();}
    }
  }
  function error(document, visible) {
    return [...document.querySelectorAll('[role="alert"],[aria-invalid="true"],.error-message,.error__text')]
      .filter(visible).some(e=>e.getAttribute('aria-invalid')==='true' || /ошиб|не удалось|обязатель|не заполн|недостаточ|лимит/i.test(text(e)));
  }
  function inspect(document, platform, href, task, result, categoryReady, visible) {
    if (!supported(platform,task.listing) || !root.AutopostPublication.postingUrl(platform,href))
      return fail('Для этой формы автоматическая отправка ещё не проверена. Завершите подачу на площадке.');
    const f=form(document,platform);
    if (!f || !categoryReady) return fail('Ожидаем точную категорию и форму подачи.');
    if (error(document,visible)) return fail('Площадка показывает ошибку. Проверьте поля в её форме.');
    const invalid=[...f.querySelectorAll('input,select,textarea')].find(e=>!e.disabled && e.willValidate && !e.validity.valid);
    if (invalid) return fail('Заполните обязательное поле: '+(invalid.name || invalid.id || 'параметр формы')+'.');
    const critical=['title','description','price'];
    if (platform==='kufar') critical.push(...['brand','model','year','mileage','condition','engine','fuel','transmission','body','drive','color','vin','partName','partNumber'].filter(k=>task.listing[k]));
    const missing=critical.filter(k=>task.listing[k] && !result.filled.includes(k));
    const attrs=(task.attributes||[]).filter(a=>a.platform===platform).filter(a=>!result.filled.includes('attribute:'+a.key));
    if (missing.length || attrs.length) return fail('Не подтверждён перенос данных: '+[...missing,...attrs.map(a=>a.label)].join(', ')+'.');
    // No silent edits to title, description or price between filling and sending.
    for (const [key,name] of Object.entries(platform==='kufar'?{title:'subject',description:'body',price:'price'}:{title:'subject',description:'message',price:'topic_price'})) {
      const field=[...f.querySelectorAll('[name="'+name+'"]')].find(e=>e.type!=='hidden') || f.querySelector('[name="'+name+'"]');
      if (!field || (key==='price' ? Number(String(field.value).replace(',','.'))!==Number(String(task.listing[key]).replace(',','.')) : field.value.trim()!==task.listing[key]?.trim()))
        return fail('Значение поля «'+key+'» отличается от карточки. Проверьте его вручную.');
    }
    if (!task.photos.length || task.photosTransferred!==task.photos.length) return fail('Ожидаем передачу всех фотографий.');
    if (platform==='kufar') {
      for(const scope of f.querySelectorAll('[data-name]')) {
        const label=scope.querySelector('[class*="__label"]');
        if(!label || !text(label).includes('*') || scope.getAttribute('data-name').includes('.'))continue;
        const dropdown=scope.querySelector('[data-testid="base-dropdown-ui"]');
        const controls=[...scope.querySelectorAll('input,select,textarea')];
        const chosen=scope.querySelector('[aria-checked="true"],[aria-pressed="true"],[class*="chip__filled"]');
        const hasValue=dropdown ? !!text(dropdown) && !/выбер|укаж/i.test(text(dropdown))
          : !!chosen || controls.some(e=>['radio','checkbox'].includes(e.type)?e.checked:!!e.value?.trim());
        if(!hasValue)return fail('Заполните обязательное поле: '+text(label)+'.');
      }
      const counter=text(f.querySelector('[data-name="images"]')).match(/Загружено\s+(\d+)\s+из\s+(\d+)/i);
      if (!counter || Number(counter[1])!==task.photos.length) return fail('Ожидаем подтверждение загрузки всех фотографий на Kufar.');
      for (const key of ['region','area']) {
        const value=text(f.querySelector('[data-name="'+key+'"] [data-testid="base-dropdown-ui"]'));
        if (!value || /выбер|укаж/i.test(value)) return fail('Укажите местоположение на Kufar.');
      }
      const normalize=root.AutopostCore.normalize;
      if (task.listing.city && !['region','area'].some(key=>normalize(text(f.querySelector('[data-name="'+key+'"] [data-testid="base-dropdown-ui"]')))===normalize(task.listing.city)))
        return fail('Город в форме Kufar отличается от карточки. Уточните местоположение.');
      if (task.listing.phone && ![...f.querySelectorAll('[data-name="phone"] input')].some(e=>e.value.replace(/\D/g,'')===task.listing.phone.replace(/\D/g,'')))
        return fail('Телефон профиля Kufar отличается от карточки. Проверьте контакты на площадке.');
      if (!f.querySelector('[name="phone_hidden"]:checked')) return fail('Выберите способ связи на Kufar.');
      const due=text(f).match(/К оплате:\s*([\d\s]+(?:[.,]\d+)?)/i);
      const free=f.querySelector('[data-cy="vas-no_vas"]');
      if (!free?.className.includes('card--selected') || due && Number(due[1].replace(/\s/g,'').replace(',','.'))!==0)
        return fail('Подача или продвижение платные либо стоимость не определена. Выберите бесплатный вариант или завершите подачу вручную.');
      if (f.querySelector('#halva:checked')) return fail('Включена рассрочка. Проверьте её условия и отправьте объявление вручную.');
    } else {
      if (!f.querySelector('[name="f"]')?.value || f.querySelector('[name="f"]').value==='0') return fail('Укажите раздел Onlíner.');
      if (!f.querySelector('[name="region"]')?.value || !f.querySelector('[name="city"]')?.value) return fail('Укажите местоположение на Onlíner.');
      // Require server-backed previews, not merely files assigned to an input.
      const wrapper=f.querySelector('.drop-style__wrapper');
      const urls=new Set();
      for(const e of wrapper?.querySelectorAll('img,[style]')||[]) {
        const url=e.tagName==='IMG'?e.currentSrc||e.src:(e.style.backgroundImage.match(/url\(["']?(https:[^"')]+)["']?\)/)||[])[1];
        if(url && /^https:\/\//.test(url) && (e.tagName!=='IMG'||e.complete && e.naturalWidth>0))urls.add(url);
      }
      if(urls.size!==task.photos.length) return fail('Ожидаем подтверждение загрузки всех фотографий на Onlíner.');
    }
    if ([...document.querySelectorAll('[role="dialog"],dialog[open]')].some(visible)) return fail('Закройте или завершите диалог площадки.');
    if ([...f.querySelectorAll('[role="progressbar"],[aria-busy="true"]')].some(visible)) return fail('Площадка ещё обрабатывает данные.');
    const controls=[...f.querySelectorAll('button,input[type="submit"],a')].filter(e=>visible(e) && root.AutopostPublication.isSubmitEvent({type:'click',isTrusted:true,target:e},platform,href));
    if (controls.length!==1) return fail('Финальная кнопка подачи не распознана или ещё недоступна.');
    return {ready:true,control:controls[0],message:'Карточка готова к автоматической отправке.'};
  }
  root.AutopostAutoPublish={supported,form,fileInput,prepareFree,inspect,error};
})(globalThis);
