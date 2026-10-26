/* Shared validation. No network requests or page-provided code. */
(function (root) {
  'use strict';
  const VERSION = '0.1.0';
  const TTL_MS = 2 * 60 * 60 * 1000;
  const MAX_PHOTO_BYTES = 1024 * 1024;
  const MAX_TOTAL_PHOTO_BYTES = 3.25 * 1024 * 1024;
  const APP_ORIGINS = Object.freeze([
    'https://autopost-belarus-mvp.sunlit-lemur-2753.chatgpt.site',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]);
  // These are deliberate, canonical starting pages. Never use a supplied URL.
  const PLATFORMS = Object.freeze({
    av: Object.freeze({ id: 'av', name: 'av.by', origins: Object.freeze(['https://av.by', 'https://cars.av.by']), url: 'https://av.by/' }),
    kufar: Object.freeze({ id: 'kufar', name: 'Kufar', origins: Object.freeze(['https://www.kufar.by', 'https://auto.kufar.by']), url: 'https://www.kufar.by/' }),
  });
  const FIELD_LIMITS = Object.freeze({
    title: 180, description: 12000, brand: 80, model: 100, year: 4,
    mileage: 12, engine: 40, fuel: 60, transmission: 60, body: 80,
    drive: 60, color: 60, price: 16, currency: 6, city: 100, phone: 40, vin: 17,
  });
  const STATUSES = Object.freeze(['authorization_required', 'captcha_required', 'review_required', 'manual_required', 'error']);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function originOf(url) { try { return new URL(url).origin; } catch { return ''; } }
  function isAppOrigin(origin) { return APP_ORIGINS.includes(origin); }
  function platformForOrigin(origin) { return Object.values(PLATFORMS).find((item) => item.origins.includes(origin)); }
  function platformId(value) {
    const aliases = { av: 'av', 'av.by': 'av', avby: 'av', kufar: 'kufar', 'kufar.by': 'kufar' };
    return typeof value === 'string' && own(aliases, value) ? aliases[value] : null;
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
    const batchId = text(payload.batchId, 120, 'пакет');
    if (!batchId || !/^[a-zA-Z0-9_.:-]+$/u.test(batchId)) throw new Error('Неверный идентификатор пакета.');
    const listing = {};
    for (const [key, limit] of Object.entries(FIELD_LIMITS)) listing[key] = text(payload.listing[key], limit, key);
    if (!listing.title || !listing.description) throw new Error('Заполните заголовок и описание объявления.');
    if (listing.year && (!/^\d{4}$/u.test(listing.year) || Number(listing.year) < 1886 || Number(listing.year) > new Date().getFullYear() + 1)) throw new Error('Проверьте год автомобиля.');
    if (listing.price && (!/^\d+(?:[.,]\d{1,2})?$/u.test(listing.price) || Number(listing.price.replace(',', '.')) <= 0)) throw new Error('Проверьте цену автомобиля.');
    if (listing.currency && !['BYN', 'USD', 'EUR'].includes(listing.currency.toUpperCase())) throw new Error('Поддерживаются валюты BYN, USD и EUR.');
    listing.currency = listing.currency.toUpperCase();
    if (listing.vin && !/^[A-HJ-NPR-Z0-9]{17}$/iu.test(listing.vin)) throw new Error('VIN должен содержать 17 допустимых символов.');
    if (!Array.isArray(payload.platforms) || payload.platforms.length < 1 || payload.platforms.length > 2) throw new Error('Выберите av.by и/или Kufar для экспериментального заполнения.');
    const platforms = [];
    const seen = new Set();
    for (const item of payload.platforms) {
      const canonicalId = object(item) ? platformId(item.id) : null;
      if (!canonicalId || seen.has(canonicalId)) throw new Error('Площадка не поддерживается или указана дважды.');
      seen.add(canonicalId);
      platforms.push({ id: item.id, canonicalId });
    }
    if (!Array.isArray(payload.photos) || payload.photos.length > 12) throw new Error('Можно передать до 12 фотографий.');
    const photos = payload.photos.map(validatePhoto);
    if (photos.reduce((sum, photo) => sum + photoBytes(photo.dataUrl), 0) > MAX_TOTAL_PHOTO_BYTES) throw new Error('Уменьшите общий размер фото до 3,25 МиБ для временного хранения в расширении.');
    return { batchId, listing, photos, platforms };
  }
  function publicJob(job) {
    return {
      platformId: job.platformId, status: job.status, message: job.message,
      tabId: job.tabId ?? null, filledFields: job.filledFields || 0,
      skippedFields: job.skippedFields || [], photosTransferred: job.photosTransferred || 0,
    };
  }
  function normalize(value) {
    return String(value ?? '').toLowerCase().replace(/ё/gu, 'е').replace(/[_\-.[\]/():*]/gu, ' ').replace(/\s+/gu, ' ').trim();
  }
  const core = { VERSION, TTL_MS, MAX_TOTAL_PHOTO_BYTES, APP_ORIGINS, PLATFORMS, FIELD_LIMITS, STATUSES, object, originOf, isAppOrigin, platformForOrigin, platformId, validateRun, publicJob, normalize };
  root.AutopostCore = Object.freeze(core);
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
})(globalThis);
