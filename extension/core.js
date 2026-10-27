/* Shared validation. No network requests or page-provided code. */
(function (root) {
  'use strict';
  const VERSION = '0.8.4';
  const TTL_MS = 2 * 60 * 60 * 1000;
  const MAX_PHOTO_BYTES = 1024 * 1024;
  const MAX_TOTAL_PHOTO_BYTES = 3.25 * 1024 * 1024;
  const APP_ORIGINS = Object.freeze([
    'https://autopost-belarus-mvp.sunlit-lemur-2753.chatgpt.site',
    'https://87.199.205.227',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]);
  // These are deliberate, canonical starting pages. Never use a supplied URL.
  const PLATFORMS = Object.freeze({
    av: Object.freeze({ id: 'av', name: 'av.by', origins: Object.freeze(['https://av.by', 'https://cars.av.by']), url: 'https://av.by/' }),
    kufar: Object.freeze({ id: 'kufar', name: 'Kufar', origins: Object.freeze(['https://www.kufar.by', 'https://auto.kufar.by','https://kufar.by']), url: 'https://www.kufar.by/ain/create' }),
    bamper: {id:'bamper',name:'Bamper.by',origins:['https://bamper.by','https://www.bamper.by'],url:'https://bamper.by/personal/add.php?action=add'},
    onliner: {id:'onliner',name:'Onlíner',origins:['https://ab.onliner.by','https://baraholka.onliner.by','https://profile.onliner.by'],url:'https://baraholka.onliner.by/fleamarketposting.php'},
    abw: {id:'abw',name:'ABW',origins:['https://abw.by','https://www.abw.by'],url:'https://abw.by/',manual:true},
    flagma: {id:'flagma',name:'Flagma',origins:['https://flagma.by'],url:'https://flagma.by/podat-obyavlenie.html'},
    drom: {id:'drom',name:'Дром',origins:['https://auto.drom.ru'],url:'https://auto.drom.ru/minsk/addbull/'},
  });
  const FIELD_LIMITS = Object.freeze({
    category: 12, taxonomyId:100, partName: 100, partNumber: 100, manufacturer: 100, condition: 40,
    compatibility: 500, fitYears: 100, position: 100, quantity: 12, priceUnit: 40, availability: 40,
    title: 180, description: 12000, brand: 80, model: 100, year: 4,
    mileage: 12, engine: 40, fuel: 60, transmission: 60, body: 80,
    drive: 60, color: 60, price: 16, currency: 6, city: 100, phone: 40, vin: 17,
  });
  const STATUSES = Object.freeze(['auto_checking', 'submitting', 'authorization_required', 'captcha_required', 'review_required', 'manual_required', 'error','category_required','link_recorded','submitted','cancelled']);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function originOf(url) { try { return new URL(url).origin; } catch { return ''; } }
  function isAppOrigin(origin) { return APP_ORIGINS.includes(origin); }
  function platformForOrigin(origin) { return Object.values(PLATFORMS).find((item) => item.origins.includes(origin)); }
  function platformId(value) {
    const aliases = { av: 'av', 'av.by': 'av', avby: 'av', kufar: 'kufar', 'kufar.by': 'kufar', bamper:'bamper',onliner:'onliner',abw:'abw',flagma:'flagma',drom:'drom' };
    const key=typeof value==='string'?value.replace(/-(parts|general)$/,''):'';
    return own(aliases,key)?aliases[key]:null;
  }
  function text(value, limit, name) {
    if (value == null) return '';
    if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) throw new Error(`Некорректное поле: ${name}.`);
    const result = String(value).trim();
    if (result.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(result)) throw new Error(`Проверьте длину и содержимое поля: ${name}.`);
    return result;
  }
  function photoBytes(dataUrl) {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    return base64.length * 3 / 4 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  }
  function validatePhoto(photo, index) {
    if (!object(photo)) throw new Error('Неверный формат фотографии.');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.type)) throw new Error('Фото должны быть JPEG, PNG или WebP.');
    if (typeof photo.dataUrl !== 'string' || photo.dataUrl.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4 + 64) throw new Error('Уменьшите каждое фото до 1 МБ.');
    const prefix = `data:${photo.type};base64,`;
    if (!photo.dataUrl.startsWith(prefix)) throw new Error('Неверный формат данных фотографии.');
    const encoded = photo.dataUrl.slice(prefix.length);
    if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) throw new Error('Повреждённые данные фотографии.');
    const bytes = photoBytes(photo.dataUrl);
    if (bytes > MAX_PHOTO_BYTES || bytes < 12) throw new Error('Уменьшите каждое фото до 1 МБ; пустые файлы не принимаются.');
    const head = atob(encoded.slice(0, 32));
    const signatureOK = photo.type === 'image/jpeg' ? head.charCodeAt(0) === 255 && head.charCodeAt(1) === 216 && head.charCodeAt(2) === 255
      : photo.type === 'image/png' ? head.startsWith('\x89PNG\r\n\x1a\n')
      : head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP';
    if (!signatureOK) throw new Error('Содержимое фото не соответствует типу файла.');
    const extension = photo.type === 'image/jpeg' ? 'jpg' : photo.type.split('/')[1];
    const name = text(photo.name || `photo-${index + 1}.${extension}`, 160, 'имя фото').replace(/[\\/:*?"<>|]/gu, '_');
    return { name, type: photo.type, dataUrl: photo.dataUrl };
  }
  function validateRun(payload) {
    if (!object(payload) || !object(payload.listing)) throw new Error('Не переданы данные объявления.');
    const publishMode = payload.publishMode ?? 'manual';
    if (!['manual','automatic'].includes(publishMode)) throw new Error('Неизвестный режим подачи.');
    const batchId = text(payload.batchId, 120, 'пакет');
    if (!batchId || !/^[a-zA-Z0-9_.:-]+$/u.test(batchId)) throw new Error('Неверный идентификатор пакета.');
    const listing = {};
    for (const [key, limit] of Object.entries(FIELD_LIMITS)) listing[key] = text(payload.listing[key], limit, key);
    listing.category = listing.category || 'cars';
    if (!['cars', 'parts','general'].includes(listing.category)) throw new Error('Неизвестная товарная группа.');
    if (listing.category === 'parts') {
      if (!listing.partName || !['Новая', 'Б/у', 'На восстановление'].includes(listing.condition)) throw new Error('Укажите название и состояние запчасти.');
      if (!['За штуку', 'За комплект', 'За пару'].includes(listing.priceUnit)) throw new Error('Укажите, за что назначена цена запчасти.');
    }
    if (!listing.title || !listing.description) throw new Error('Заполните заголовок и описание объявления.');
    if (listing.year && (!/^\d{4}$/u.test(listing.year) || Number(listing.year) < 1886 || Number(listing.year) > new Date().getFullYear() + 1)) throw new Error('Проверьте год автомобиля.');
    if (listing.price && (!/^\d+(?:[.,]\d{1,2})?$/u.test(listing.price) || Number(listing.price.replace(',', '.')) <= 0)) throw new Error('Проверьте цену автомобиля.');
    if (listing.currency && !['BYN', 'USD', 'EUR'].includes(listing.currency.toUpperCase())) throw new Error('Поддерживаются валюты BYN, USD и EUR.');
    listing.currency = listing.currency.toUpperCase();
    if (listing.vin && !/^[A-HJ-NPR-Z0-9]{17}$/iu.test(listing.vin)) throw new Error('VIN должен содержать 17 допустимых символов.');
    if (!Array.isArray(payload.platforms) || payload.platforms.length < 1 || payload.platforms.length > 7) throw new Error('Выберите от 1 до 7 площадок.');
    const platforms = [];
    const seen = new Set();
    for (const item of payload.platforms) {
      const canonicalId = object(item) ? platformId(item.id) : null;
      if (!canonicalId || seen.has(canonicalId)) throw new Error('Площадка не поддерживается или указана дважды.');
      if (listing.category === 'parts' && ['av','drom'].includes(canonicalId)) throw new Error('Эта площадка подключена только для автомобилей.');
      seen.add(canonicalId);
      platforms.push({ id: item.id, canonicalId });
    }
    if (!Array.isArray(payload.photos) || payload.photos.length > 12) throw new Error('Можно передать до 12 фотографий.');
    const photos = payload.photos.map(validatePhoto);
    if (photos.reduce((sum, photo) => sum + photoBytes(photo.dataUrl), 0) > MAX_TOTAL_PHOTO_BYTES) throw new Error('Уменьшите общий размер фото до 3,25 МиБ для временного хранения в расширении.');
    const categoryOverrides = {};
    if(payload.categoryOverrides!==undefined&&!object(payload.categoryOverrides))throw new Error('Некорректные категории площадок.');
    for(const [platform,id] of Object.entries(payload.categoryOverrides||{})) {
      if(!own(PLATFORMS,platform)||typeof id!=='string'||!/^[-a-zA-Z0-9_.:]{1,100}$/.test(id)||(id.includes(':')&&platform!=='kufar'))throw new Error('Категория площадки отсутствует в справочнике.');
      categoryOverrides[platform]=id;
    }
    const recipe = payload.recipe ? validateRecipe(payload.recipe) : null;
    if (listing.taxonomyId && !recipe) throw new Error('Не загружены категории с сервера. Обновите страницу Автопоста.');
    if (recipe) { listing.taxonomyId = recipe.taxonomyId; listing.category = recipe.category; }
    const attributes = Object.fromEntries((recipe?.entries||[]).map(e=>[e.key,e.value]));
    const platformText={};
    for(const id of Object.keys(PLATFORMS))if(payload.platformText?.[id])platformText[id]=text(payload.platformText[id],1000,'текст площадки');
    const photoIds=Array.isArray(payload.photoIds)?payload.photoIds.slice(0,12).map(id=>text(id,80,'фото')):[];
    return { batchId, listing, photos, photoIds, platforms, categoryOverrides, attributes, recipe, publishMode, platformText, profileId:text(payload.profileId||'legacy',80,'профиль'), recordId:text(payload.recordId||batchId,80,'карточка') };
  }
  function validateRecipe(value) {
    if (!object(value) || value.protocol !== 1 || !['cars','parts','general'].includes(value.category) ||
        !/^[a-z0-9_.-]{1,100}$/.test(value.taxonomyId) || !object(value.mappings) || !Array.isArray(value.entries) || value.entries.length > 80)
      throw new Error('Формат справочника изменился. Обновите расширение.');
    const parameter = key => typeof key === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(key) && !['constructor','prototype'].includes(key);
    const mappings = {};
    for (const [platform,m] of Object.entries(value.mappings)) {
      if (!own(PLATFORMS,platform) || !object(m) || typeof m.id !== 'string' || !m.id || m.id.length > 200 || /[\u0000-\u001f]/.test(m.id) ||
          !Array.isArray(m.path) || m.path.length > 12 || m.path.some(s=>typeof s !== 'string' || s.length > 200) ||
          (m.attributes && (!Array.isArray(m.attributes) || m.attributes.length > 20))) throw new Error('Некорректное соответствие категории.');
      const attributes = (m.attributes || []).map(a=>{
        if (!object(a) || !parameter(a.key)) throw new Error('Некорректный параметр категории.');
        return {key:a.key,value:text(a.value,100,'значение'),label:text(a.label,200,'название')};
      });
      mappings[platform] = {id:m.id,path:[...m.path],attributes};
    }
    const entries = value.entries.map(e=>{
      if (!object(e) || !parameter(e.key) || !own(PLATFORMS,e.platform) || e.formName && !/^[a-zA-Z][a-zA-Z0-9_\[\]]{0,79}$/.test(e.formName))
        throw new Error('Некорректная характеристика.');
      return {key:e.key,platform:e.platform,label:text(e.label,200,'название'),value:text(e.value,300,'значение'),text:text(e.text,300,'характеристика'),...(e.formName?{formName:e.formName}:{})};
    });
    return {protocol:1,version:text(value.version,100,'версия справочника'),taxonomyId:value.taxonomyId,category:value.category,mappings,entries};
  }
  function publicJob(job) {
    return {
      platformId: job.platformId, status: job.status, message: job.message,
      tabId: job.tabId ?? null, filledFields: job.filledFields || 0,
      skippedFields: job.skippedFields || [], photosTransferred: job.photosTransferred || 0,
      ...(job.url?{url:job.url}:{}),
    };
  }
  function normalize(value) {
    return String(value ?? '').toLowerCase().replace(/ё/gu, 'е').replace(/[_\-.[\]/():*]/gu, ' ').replace(/\s+/gu, ' ').trim();
  }
  function startUrl(id,listing){if(id==='av'&&listing.category==='cars')return 'https://av.by/offer/draft/cars';if(id==='onliner'&&listing.category==='cars')return 'https://ab.onliner.by/';if(id==='abw'&&listing.category==='parts')return 'https://abw.by/carparts';return PLATFORMS[id].url;}
  function safeLink(id,value){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!PLATFORMS[id]?.origins.includes(u.origin)||u.hostname==='profile.onliner.by')return '';u.hash='';return u.href;}catch{return '';}}
  const core = { VERSION, TTL_MS, MAX_TOTAL_PHOTO_BYTES, APP_ORIGINS, PLATFORMS, FIELD_LIMITS, STATUSES, object, originOf, isAppOrigin, platformForOrigin, platformId, validateRun, validateRecipe, publicJob, normalize,startUrl,safeLink };
  root.AutopostCore = Object.freeze(core);
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
})(globalThis);
