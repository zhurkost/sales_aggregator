'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Classic extension scripts are tested in CommonJS. */
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');

function listing(overrides = {}) {
  return { batchId: 'batch-123', listing: { title: 'Тестовый автомобиль', description: 'Описание автомобиля', price: 10000, currency: 'BYN', ...overrides }, platforms: [{ id: 'av', url: 'https://attacker.invalid/' }], photos: [] };
}

test('canonical platform URL is fixed and caller URL is discarded', () => {
  const valid = core.validateRun(listing());
  assert.deepEqual(valid.platforms, [{ id: 'av', canonicalId: 'av' }]);
  assert.equal(core.PLATFORMS[valid.platforms[0].canonicalId].url, 'https://av.by/');
  assert.equal(valid.listing.price, '10000');
});

test('only the exact application origins are permitted', () => {
  assert.equal(core.isAppOrigin('https://87.199.205.227'), true);
  assert.equal(core.isAppOrigin('http://87.199.205.227'), false);
  assert.equal(core.isAppOrigin('https://87.199.205.227.evil.invalid'), false);
  assert.equal(core.isAppOrigin('http://localhost:5173'), true);
  assert.equal(core.isAppOrigin('http://localhost:5174'), false);
  assert.equal(core.isAppOrigin('https://autopost-belarus-mvp.sunlit-lemur-2753.chatgpt.site.evil.invalid'), false);
  assert.equal(core.isAppOrigin('https://evil.invalid'), false);
  assert.equal(core.platformForOrigin('https://av.by.evil.invalid'), undefined);
  assert.equal(core.platformForOrigin('https://cars.av.by').id, 'av');
  assert.equal(core.platformForOrigin('https://auto.kufar.by').id, 'kufar');
  assert.equal(core.platformForOrigin('https://login.av.by'), undefined);
});

test('parts go only to Kufar and retain exact OEM and pricing unit', () => {
  const payload=listing({category:'parts',partName:'Фара',partNumber:'000123-AB',condition:'Б/у',priceUnit:'За штуку'});
  payload.platforms=[{id:'kufar-parts'}];
  const result=core.validateRun(payload);
  assert.equal(result.listing.partNumber,'000123-AB');
  assert.equal(result.listing.priceUnit,'За штуку');
  assert.equal(result.platforms[0].canonicalId,'kufar');
  payload.platforms=[{id:'avby'}];
  assert.throws(()=>core.validateRun(payload),/только на Kufar/);
  payload.platforms=[{id:'kufar-parts'}];payload.listing.category='unknown';
  assert.throws(()=>core.validateRun(payload),/товарная группа/);
});

test('unsupported platforms, aliases repeated twice and object prototype keys are rejected', () => {
  for (const id of ['abw', 'onliner', '__proto__', 'constructor', 'https://av.by']) {
    const payload = listing();
    payload.platforms = [{ id }];
    assert.throws(() => core.validateRun(payload), /не поддерживается/u);
  }
  const payload = listing();
  payload.platforms = [{ id: 'av' }, { id: 'av.by' }];
  assert.throws(() => core.validateRun(payload), /дважды/u);
});

test('bounded text, numeric values and VIN are checked', () => {
  assert.throws(() => core.validateRun(listing({ title: 'a'.repeat(181) })), /длину/u);
  assert.throws(() => core.validateRun(listing({ description: '\u0000invalid' })), /содержимое/u);
  assert.throws(() => core.validateRun(listing({ price: -10 })), /цену/u);
  assert.throws(() => core.validateRun(listing({ price: Infinity })), /Некорректное поле/u);
  assert.throws(() => core.validateRun(listing({ currency: 'RUB' })), /валюты/u);
  assert.throws(() => core.validateRun(listing({ year: '1000' })), /год/u);
  assert.throws(() => core.validateRun(listing({ vin: '12345' })), /VIN/u);
});

test('photos require an accepted MIME, matching signature and bounded count', () => {
  const payload = listing();
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGB8AAAAASUVORK5CYII=';
  payload.photos = [{ name: 'car.png', type: 'image/png', dataUrl: png }];
  assert.equal(core.validateRun(payload).photos.length, 1);
  payload.photos[0].type = 'image/svg+xml';
  assert.throws(() => core.validateRun(payload), /JPEG/u);
  payload.photos[0] = { name: 'car.jpg', type: 'image/jpeg', dataUrl: png.replace('image/png', 'image/jpeg') };
  assert.throws(() => core.validateRun(payload), /не соответствует/u);
  payload.photos = Array.from({ length: 13 }, () => ({ name: 'car.png', type: 'image/png', dataUrl: png }));
  assert.throws(() => core.validateRun(payload), /12/u);
});

test('job projection never returns the listing, photos or internal job ID', () => {
  const publicJob = core.publicJob({ id: 'secret', platformId: 'av', status: 'manual_required', message: 'Проверьте', listing: { phone: 'private' }, photos: ['private'] });
  assert.equal(publicJob.id, undefined);
  assert.equal(publicJob.listing, undefined);
  assert.equal(publicJob.photos, undefined);
});
