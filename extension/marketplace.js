(async function () {
  'use strict';
  const core = globalThis.AutopostCore;
  if (window !== window.top || !core.platformForOrigin(location.origin)) return;
  const isKufar = core.platformForOrigin(location.origin).id === 'kufar';
  let response;
  try { response = await chrome.runtime.sendMessage({ kind: 'GET_TASK' }); } catch { return; }
  let task = response?.task;
  if (!task || task.expiresAt <= Date.now()) return;
  const isParts = task.listing.category === 'parts';
  let stopped = false;
  let busy = false;
  let autoAttempted = false;
  let lastState = '';
  let scheduled = null;
  const filledKeys = new Set(task.filledKeys || []);
  const fields = {
    partName: { label: 'Название детали', aliases: ['part name', 'название детали', 'наименование детали', 'название запчасти'] },
    partNumber: { label: 'Артикул / OEM', aliases: ['part number', 'oem', 'oem number', 'артикул', 'номер запчасти', 'оригинальный номер', 'номер детали'] },
    manufacturer: { label: 'Производитель детали', aliases: ['manufacturer', 'производитель запчасти', 'производитель детали'] },
    condition: { label: 'Состояние', aliases: ['condition', 'состояние', 'состояние запчасти', 'состояние товара'] },
    compatibility: { label: 'Совместимость', aliases: ['compatibility', 'совместимость', 'применимость'] },
    fitYears: { label: 'Годы применимости', aliases: ['годы применимости', 'совместимые годы'] },
    position: { label: 'Расположение', aliases: ['position', 'расположение', 'сторона установки'] },
    quantity: { label: 'Количество', aliases: ['quantity', 'количество', 'количество штук'] },
    priceUnit: { label: 'Цена указана', aliases: ['price unit', 'цена указана', 'единица продажи'] },
    availability: { label: 'Наличие', aliases: ['availability', 'наличие'] },
    title: { label: 'Заголовок', aliases: ['title', 'subject', 'ad title', 'заголовок', 'название объявления', 'заголовок объявления'] },
    description: { label: 'Описание', aliases: ['description', 'ad description', 'описание', 'описание автомобиля', 'описание объявления', 'дополнительная информация'] },
    brand: { label: 'Марка', aliases: ['brand', 'brand id', 'make', 'make id', 'марка', 'марка автомобиля'] },
    model: { label: 'Модель', aliases: ['model', 'model id', 'модель', 'модель автомобиля'] },
    year: { label: 'Год', aliases: ['year', 'year of manufacture', 'production year', 'год', 'год выпуска', 'год производства'] },
    mileage: { label: 'Пробег', aliases: ['mileage', 'odometer', 'пробег', 'пробег км', 'пробег, км'] },
    engine: { label: 'Двигатель', aliases: ['engine', 'engine capacity', 'engine volume', 'capacity', 'объем двигателя', 'объем двигателя л', 'объем, л', 'объем л'] },
    fuel: { label: 'Топливо', aliases: ['fuel', 'fuel type', 'тип топлива', 'топливо', 'тип двигателя'] },
    transmission: { label: 'Коробка', aliases: ['transmission', 'gearbox', 'коробка передач', 'коробка', 'кпп'] },
    body: { label: 'Кузов', aliases: ['body', 'body type', 'кузов', 'тип кузова'] },
    drive: { label: 'Привод', aliases: ['drive', 'drive type', 'привод', 'тип привода'] },
    color: { label: 'Цвет', aliases: ['color', 'colour', 'цвет', 'цвет кузова'] },
    price: { label: 'Цена', aliases: ['price', 'cost', 'цена', 'стоимость', 'цена byn', 'цена, byn', 'цена руб', 'цена в рублях'] },
    currency: { label: 'Валюта', aliases: ['currency', 'валюта', 'валюта цены'] },
    city: { label: 'Город', aliases: ['city', 'city id', 'город', 'населенный пункт', 'местонахождение автомобиля'] },
    phone: { label: 'Телефон', aliases: ['phone', 'phone number', 'telephone', 'телефон', 'номер телефона', 'контактный телефон'] },
    vin: { label: 'VIN', aliases: ['vin', 'vin number', 'вин', 'vin номер', 'vin код', 'номер кузова vin'] },
  };
  if (isParts) {
    fields.brand.aliases = ['car brand', 'марка автомобиля', 'марка авто'];
    fields.model.aliases = ['car model', 'модель автомобиля', 'модель авто'];
    fields.year.aliases = ['donor year', 'год автомобиля донора', 'год донора'];
  }
  const valueGroups = {
    condition: [['Новая', 'новый', 'новое'], ['Б/у', 'бывший в употреблении', 'бывшая в употреблении'], ['На восстановление', 'под восстановление']],
    fuel: [['бензин', 'petrol', 'gasoline'], ['дизель', 'diesel'], ['электро', 'электричество', 'электромобиль', 'electric'], ['гибрид', 'hybrid'], ['газ бензин', 'газ/бензин', 'lpg']],
    transmission: [['автомат', 'автоматическая', 'акпп', 'automatic'], ['механика', 'механическая', 'мкпп', 'manual'], ['робот', 'роботизированная', 'robot'], ['вариатор', 'cvt']],
    drive: [['передний', 'передний привод', 'fwd'], ['задний', 'задний привод', 'rwd'], ['полный', 'полный привод', 'awd', '4wd']],
    currency: [['BYN', 'белорусский рубль', 'белорусские рубли', 'руб.', 'р.'], ['USD', 'доллар', 'доллары', '$'], ['EUR', 'евро', '€']],
    body: [['седан', 'sedan'], ['универсал', 'wagon'], ['хэтчбек', 'хетчбек', 'hatchback'], ['внедорожник', 'suv'], ['кроссовер', 'crossover'], ['минивэн', 'минивен', 'minivan'], ['купе', 'coupe'], ['кабриолет', 'cabriolet']],
  };
  const host = document.createElement('div');
  host.id = 'autopost-helper-panel';
  host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;max-width:calc(100vw - 24px);';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = ':host{all:initial}*{box-sizing:border-box}.panel{font:13px/1.5 system-ui,sans-serif;color:#ecf2f7;background:#11212b;border:1px solid #3f5b6c;border-radius:16px;width:360px;max-width:calc(100vw - 24px);box-shadow:0 12px 48px #0006;padding:16px}.top{display:flex;align-items:center;justify-content:space-between;gap:10px}h2{font-size:16px;margin:0}p{margin:10px 0}.badge{color:#a6df65;font-size:11px}.muted{color:#b8c8d3}.status{padding:10px;border-radius:9px;background:#1e3542;color:#f0f5fa}button{font:inherit;border:1px solid #526875;background:#233b49;color:#fff;padding:8px 10px;border-radius:8px;cursor:pointer}button.primary{background:#c2ef8a;color:#15270c;border-color:#c2ef8a;font-weight:650}button:disabled{opacity:.5;cursor:wait}button:focus-visible,summary:focus-visible{outline:3px solid #e6b4ff;outline-offset:2px}.actions{display:flex;gap:7px;flex-wrap:wrap}details{margin-top:12px}summary{cursor:pointer}ul{padding-left:18px;margin:8px 0;max-height:150px;overflow:auto;font-size:12px}pre{font:12px/1.5 system-ui;white-space:pre-wrap;overflow-wrap:anywhere;max-height:190px;overflow:auto;user-select:text;background:#091822;padding:10px;border-radius:8px}.tiny{font-size:11px}.body{max-height:70vh;overflow:auto}.hidden{display:none}';
  shadow.append(style);
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  const panel = element('section', undefined, 'panel');
  panel.setAttribute('aria-label', 'Помощник Автопост');
  const top = element('div', undefined, 'top');
  const heading = element('div');
  heading.append(element('h2', 'Автопост'), element('span', `${task.name} · beta`, 'badge'));
  const collapse = element('button', 'Свернуть');
  collapse.type = 'button';
  collapse.setAttribute('aria-expanded', 'true');
  top.append(heading, collapse);
  const body = element('div', undefined, 'body');
  const intro = element('p', 'Экспериментальное заполнение. Проверьте данные и фото перед ручной публикацией.', 'muted');
  const statusNode = element('p', 'Проверяем доступные поля…', 'status');
  statusNode.setAttribute('role', 'status');
  statusNode.setAttribute('aria-live', 'polite');
  const counts = element('p', 'Перенесено полей: 0.');
  const photoNode = element('p', 'Фото: ещё не переданы.', 'muted tiny');
  const actions = element('div', undefined, 'actions');
  const categoryLabel = element('label', undefined, 'muted tiny');
  const categoryConfirmed = document.createElement('input');
  categoryConfirmed.type = 'checkbox';
  categoryLabel.append(categoryConfirmed, document.createTextNode(' На площадке выбрана категория «Запчасти» и нужный подраздел'));
  if (isParts) body.append(categoryLabel);
  const retry = element('button', 'Повторить заполнение', 'primary');
  retry.type = 'button';
  const copy = element('button', 'Скопировать текст');
  copy.type = 'button';
  actions.append(retry, copy);
  const results = element('details');
  results.append(element('summary', 'Что заполнено и что пропущено'));
  const resultList = element('ul');
  results.append(resultList);
  const manual = element('details');
  manual.append(element('summary', 'Текст для ручного заполнения'));
  const manualText = element('pre');
  manual.append(manualText);
  body.append(intro, statusNode, counts, photoNode, actions, results, manual, element('p', 'Расширение не нажимает «Опубликовать» и не подтверждает размещение.', 'muted tiny'));
  panel.append(top, body);
  shadow.append(panel);
  document.documentElement.append(host);
  collapse.addEventListener('click', () => {
    body.classList.toggle('hidden');
    collapse.textContent = body.classList.contains('hidden') ? 'Развернуть' : 'Свернуть';
    collapse.setAttribute('aria-expanded', String(!body.classList.contains('hidden')));
  });
  function listingText() {
    if (!task) return '';
    const lines = [task.listing.title, '', task.listing.description, ''];
    for (const key of ['partName', 'partNumber', 'manufacturer', 'condition', 'compatibility', 'fitYears', 'position', 'quantity', 'priceUnit', 'availability', 'brand', 'model', 'year', 'mileage', 'engine', 'fuel', 'transmission', 'body', 'drive', 'color', 'price', 'currency', 'city', 'phone', 'vin']) {
      if (task.listing[key]) lines.push(`${fields[key].label}: ${task.listing[key]}`);
    }
    return lines.join('\n');
  }
  manualText.textContent = listingText();
  copy.addEventListener('click', async () => {
    if (stopped) return;
    try { await navigator.clipboard.writeText(listingText()); copy.textContent = 'Текст скопирован'; }
    catch { manual.open = true; statusNode.textContent = 'Браузер не разрешил копирование. Выделите текст в раскрытом блоке вручную.'; }
  });
  function visible(node) {
    if (!(node instanceof Element) || !node.isConnected) return false;
    const rect = node.getBoundingClientRect();
    const css = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && css.display !== 'none' && css.visibility !== 'hidden';
  }
  function metadata(control) {
    const technical = ['name', 'id', 'data-testid'].map((attribute) => control.getAttribute(attribute) || '');
    const human = ['aria-label', 'placeholder'].map((attribute) => control.getAttribute(attribute) || '');
    for (const label of control.labels || []) human.push(label.textContent || '');
    for (const id of (control.getAttribute('aria-labelledby') || '').split(/\s/u)) {
      if (id) human.push(document.getElementById(id)?.textContent || '');
    }
    return { technical: technical.map(core.normalize), human: human.map((part) => core.normalize(part.slice(0, 250))) };
  }
  function findField(key) {
    const aliases = fields[key].aliases.map(core.normalize);
    const candidates = [];
    for (const control of document.querySelectorAll('input, textarea, select')) {
      if (!visible(control) || control.disabled || control.readOnly) continue;
      if (control instanceof HTMLInputElement && !['text', 'tel', 'number', 'search', ''].includes(control.type)) continue;
      const info = metadata(control);
      let score = 0;
      for (const alias of aliases) {
        for (const part of info.technical) {
          if (part === alias) score = Math.max(score, 100);
          else if (part.endsWith(` ${alias}`)) score = Math.max(score, 80);
        }
        for (const part of info.human) if (part === alias) score = Math.max(score, 90);
      }
      if (score) candidates.push({ control, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    // Ambiguous controls are safer left for manual entry.
    if (!candidates.length || candidates[1]?.score === candidates[0].score) return null;
    return candidates[0].control;
  }
  function hasAdForm() { return Boolean(findField('description') && (findField('price') || findField('title'))); }
  function pageGate() {
    const hasCaptchaResponse = [...document.querySelectorAll('[name="g-recaptcha-response"], [name="h-captcha-response"], [name="cf-turnstile-response"]')].some((input) => Boolean(input.value?.trim()));
    const captcha = !hasCaptchaResponse && [...document.querySelectorAll('iframe[src*="captcha" i], iframe[title*="captcha" i], .g-recaptcha, .h-captcha, [data-sitekey]')].some(visible);
    if (captcha) return 'captcha_required';
    if ([...document.querySelectorAll('input[type="password"]')].some(visible)) return 'authorization_required';
    if (!hasAdForm()) {
      if (/\/(?:login|signin|auth)(?:\/|$)/iu.test(location.pathname)) return 'authorization_required';
      const loginForm = [...document.querySelectorAll('form, [role="dialog"]')].some((form) => visible(form) && /войти|авторизац|вход в аккаунт/iu.test(form.textContent || '') && form.querySelector('input[type="tel"], input[autocomplete="username"], input[autocomplete="one-time-code"]'));
      if (loginForm) return 'authorization_required';
      return 'manual_required';
    }
    return 'review_required';
  }
  function isEmpty(control) {
    if (control instanceof HTMLSelectElement) {
      const selected = control.options[control.selectedIndex];
      return !control.value || (selected && /^(?:выберите|не выбрано|не указан|select|choose|—|--)/iu.test(selected.textContent.trim()));
    }
    return !String(control.value || '').trim();
  }
  function aliasesForValue(key, value) {
    const variants = new Set([String(value)]);
    for (const group of valueGroups[key] || []) if (group.some((item) => core.normalize(item) === core.normalize(value))) for (const item of group) variants.add(item);
    if (key === 'engine' && /^\d(?:[.,]\d)?$/u.test(value)) {
      const normalized = Number(value.replace(',', '.')).toFixed(1);
      variants.add(normalized); variants.add(`${normalized} л`); variants.add(`${normalized.replace('.', ',')} л`);
    }
    return [...variants].map(core.normalize);
  }
  function setField(control, key, value) {
    let next = String(value);
    if (control instanceof HTMLSelectElement) {
      const aliases = aliasesForValue(key, value);
      const matches = [...control.options].filter((option) => !option.disabled && aliases.includes(core.normalize(option.textContent)));
      if (matches.length !== 1) return 'нет однозначного варианта в списке';
      next = matches[0].value;
    } else {
      if (key === 'currency') return 'валюту нужно выбрать вручную';
      if (control instanceof HTMLInputElement && control.type === 'number') {
        next = next.replace(/\s/gu, '').replace(',', '.');
        if (!/^\d+(?:\.\d+)?$/u.test(next)) return 'числовое поле требует ручной проверки';
        const number = Number(next);
        if ((control.min && number < Number(control.min)) || (control.max && number > Number(control.max))) return 'значение вне границ поля';
      }
      if (control.maxLength > 0 && next.length > control.maxLength) return 'текст длиннее лимита площадки';
    }
    const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter) return 'тип поля не поддерживается';
    setter.call(control, next);
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
    return String(control.value) === next ? null : 'площадка не приняла значение';
  }
  function priceCurrencySafe(priceControl) {
    const requested = task.listing.currency;
    if (!requested) return false;
    if (isKufar) return requested === 'BYN';
    const currency = findField('currency');
    const aliases = aliasesForValue('currency', requested);
    if (currency instanceof HTMLSelectElement) return aliases.includes(core.normalize(currency.options[currency.selectedIndex]?.textContent));
    if (currency) return aliases.includes(core.normalize(currency.value));
    // An explicitly labelled currency is sufficient; an unlabeled price is not.
    const labels = metadata(priceControl).human.join(' ');
    const known = ['BYN', 'USD', 'EUR'].filter((code) => new RegExp(`(?:^|\\s)${code.toLowerCase()}(?:$|\\s)`, 'u').test(labels));
    return known.length === 1 && known[0] === requested;
  }
  function acceptsPhoto(input, photo) {
    if (!input.accept) return true;
    const extension = `.${photo.name.split('.').pop().toLowerCase()}`;
    return input.accept.split(',').some((part) => {
      const accept = part.trim().toLowerCase();
      return accept === 'image/*' || accept === photo.type || accept === extension || (photo.type === 'image/jpeg' && ['.jpg', '.jpeg'].includes(accept));
    });
  }
  async function attachPhotos() {
    if (!task.photos.length) { photoNode.textContent = 'Фото не переданы из приложения. Добавьте их на площадке вручную.'; return; }
    if (task.photosAttempted) { photoNode.textContent = `Фото ранее переданы полю: ${task.photosTransferred || 0}. Проверьте загрузку; повторно файлы не добавляются.`; return; }
    const inputs = [...document.querySelectorAll('input[type="file"]')].filter((input) => !input.disabled && (!input.accept || /image|\.jpg|\.jpeg|\.png|\.webp/iu.test(input.accept)));
    if (inputs.length !== 1) { photoNode.textContent = 'Фото пропущены: не найдено однозначное поле загрузки. Добавьте их вручную.'; return; }
    const input = inputs[0];
    if (input.files?.length) { photoNode.textContent = 'В поле уже есть файлы. Они сохранены; проверьте фото вручную.'; return; }
    const compatible = task.photos.filter((photo) => acceptsPhoto(input, photo));
    const selected = input.multiple ? compatible : compatible.slice(0, 1);
    if (!selected.length) { photoNode.textContent = 'Поле загрузки не принимает выбранные форматы. Добавьте фото вручную.'; return; }
    try {
      const transfer = new DataTransfer();
      for (const photo of selected) {
        const binary = atob(photo.dataUrl.slice(photo.dataUrl.indexOf(',') + 1));
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        transfer.items.add(new File([bytes], photo.name, { type: photo.type }));
      }
      // A transferred FileList is not evidence of a completed remote upload.
      input.files = transfer.files;
      task.photosAttempted = true;
      task.photosTransferred = input.files.length;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      photoNode.textContent = `Фото переданы полю: ${task.photosTransferred} из ${task.photos.length}. Проверьте загрузку и добавьте пропущенные вручную.`;
    } catch { photoNode.textContent = 'Браузер или площадка не приняли фото. Загрузите файлы вручную.'; }
  }
  const statusText = {
    authorization_required: 'Войдите в аккаунт площадки. Затем откройте подачу объявления и повторите заполнение.',
    captcha_required: 'Пройдите капчу самостоятельно. После проверки нажмите «Повторить заполнение».',
    manual_required: isParts ? 'Выберите на Kufar категорию «Запчасти» и нужный подраздел, отметьте это в панели и нажмите «Повторить заполнение».' : 'Откройте «Подать объявление» и выберите категорию «Автомобили». Затем повторите заполнение.',
    review_required: 'Проверьте каждое поле, валюту и фото. Финальную публикацию выполните на площадке вручную.',
    error: 'Не удалось заполнить форму. Скопируйте текст и заполните её вручную.',
  };
  async function report(status, skippedKeys = []) {
    if (stopped || !task) return;
    statusNode.textContent = statusText[status];
    counts.textContent = `Перенесено полей за этот запуск: ${filledKeys.size}.`;
    lastState = status;
    try {
      const result = await chrome.runtime.sendMessage({ kind: 'REPORT_TASK', report: {
        jobId: task.jobId, status, filledKeys: [...filledKeys], skippedFields: skippedKeys,
        photosAttempted: task.photosAttempted === true, photosTransferred: task.photosTransferred || 0,
      } });
      if (result?.task === null) stop('Сеанс завершён. Запустите передачу заново со страницы Автопоста.');
    } catch { statusNode.textContent += ' Статус не передан в Автопост: обновите расширение и страницу.'; }
  }
  async function fill(manualRequest = false) {
    if (busy || stopped || !task) return;
    if (isParts && (!categoryConfirmed.checked || !manualRequest)) { if (lastState !== 'manual_required') await report('manual_required'); return; }
    if (task.expiresAt <= Date.now()) { stop('Истекли 2 часа. Данные сеанса удалены из панели; запустите передачу заново.'); return; }
    const gate = pageGate();
    if (gate !== 'review_required') { if (lastState !== gate || manualRequest) await report(gate); return; }
    if (autoAttempted && !manualRequest) return;
    busy = true;
    retry.disabled = true;
    autoAttempted = true;
    resultList.replaceChildren();
    const skipped = [];
    try {
      const orderedFields = Object.entries(task.listing).sort(([a], [b]) => a === 'currency' ? -1 : b === 'currency' ? 1 : 0);
      for (const [key, value] of orderedFields) {
        if (!value || !fields[key]) continue;
        const control = findField(key);
        let reason = '';
        // Kufar requires BYN. Never put a USD/EUR amount into a BYN price box.
        if (isKufar && (key === 'price' || key === 'currency') && task.listing.currency !== 'BYN') {
          reason = 'Kufar требует BYN: укажите цену в BYN вручную';
        } else if (!control) reason = 'поле не найдено или неоднозначно';
        else if (!isEmpty(control)) reason = 'уже заполнено, текущее значение сохранено';
        else if (key === 'price' && !priceCurrencySafe(control)) reason = 'валюта поля не подтверждена; укажите цену вручную';
        else reason = setField(control, key, value) || '';
        if (reason) { skipped.push(key); resultList.append(element('li', `${fields[key].label}: ${reason}.`)); }
        else { filledKeys.add(key); resultList.append(element('li', `${fields[key].label}: перенесено; проверьте значение.`)); }
      }
      await attachPhotos();
      await report('review_required', skipped);
    } catch { await report('error', skipped); }
    finally { busy = false; retry.disabled = stopped; }
  }
  retry.addEventListener('click', () => { void fill(true); });
  const observer = new MutationObserver(() => {
    if (stopped || scheduled) return;
    scheduled = setTimeout(() => { scheduled = null; void fill(false); }, 1200);
  });
  function stop(message) {
    stopped = true;
    observer.disconnect();
    if (scheduled) clearTimeout(scheduled);
    clearTimeout(expiryTimer);
    task = null;
    manualText.textContent = '';
    resultList.replaceChildren();
    retry.disabled = true;
    copy.disabled = true;
    statusNode.textContent = message;
    photoNode.textContent = '';
  }
  const expiryTimer = setTimeout(() => {
    void chrome.runtime.sendMessage({ kind: 'GET_TASK' }).catch(() => undefined);
    stop('Истекли 2 часа. Запустите передачу объявления заново.');
  }, Math.max(0, task.expiresAt - Date.now()));
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id || message?.kind !== 'TASK_CLEARED') return;
    stop(message.reason === 'expired' ? 'Истекли 2 часа. Данные сеанса больше не доступны.' : 'Сеанс очищен или заменён. Новые поля заполняться не будут.');
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'style', 'class'] });
  await fill(false);
})();
