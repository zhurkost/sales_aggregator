import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {build, validate, OUTPUT} from './seed.mjs';

const read = name => JSON.parse(fs.readFileSync(path.join(OUTPUT, 'evidence', name), 'utf8'));
const history = read('av-historical-recovery.json');
const video = read('av-video-observations.json');
const fresh = () => build(history, video);
const field = (result, name) => result.schema[0].options.find(f => f.id === `av.${name}`);

test('seed preserves only the two requested trees and every observed Kia model', () => {
  const r = fresh();
  const kia = field(r, 'brand').options[0];
  assert.equal(kia.value, null);
  assert.deepEqual(kia.childOptions.map(c => c.name), video.catalog.models);
  assert.equal(new Set(video.catalog.models).size, video.catalog.models.length);
  const rio = kia.childOptions.find(m => m.name === 'Rio');
  assert.deepEqual(rio.childOptions.map(g => g.name), ['IV · Рестайлинг', 'IV']);
  assert.equal(rio.options_complete, false);
  assert.equal(field(r, 'model').options.length, 0);
  assert.equal(field(r, 'generation').options.length, 0);
  const gomel = field(r, 'place_region').options.find(x => x.value === '1003');
  assert.equal(gomel.childOptions[0].name, 'Брагин');
  assert.equal(gomel.childOptions[0].value, null);
  assert.equal(field(r, 'place_city').options.length, 0);
  assert(field(r, 'options').options.every(x => !Object.hasOwn(x, 'childOptions')));
  assert.equal(field(r, 'options').options.length, Object.values(video.equipment_sections).flat().length);
});

test('unknown codes remain null, native string codes remain strings, no guessed generations or years', () => {
  const r = fresh();
  const currencies = field(r, 'price_currency').options;
  assert.equal(currencies.find(c => c.name === 'BYN').value, '1');
  assert.equal(currencies.find(c => c.name === 'USD').value, null);
  assert.equal(field(r, 'year').type, 'integer');
  assert.deepEqual(field(r, 'year').options, []);
  assert(!Object.hasOwn(field(r, 'year'), 'validation'));
  assert.equal(field(r, 'photo').validation.max_file_size_bytes, null);
  assert.equal(field(r, 'phone_number').type, 'text');
  assert.equal(field(r, 'vin').type, 'text');
});

test('video cannot promote untested recipes to ready; all fields have a status', () => {
  const r = fresh();
  assert.deepEqual(validate(r), {fields: 37, choices: 237, needs_review: 35, unsupported: 2});
  assert(r.schema[0].options.every(f => f.required === null));
  r.binding.fields[0].status = 'ready';
  assert.throws(() => validate(r), /Unverified/);
});

test('validator rejects malformed hierarchy, duplicate IDs and dangling dependencies', () => {
  let r = fresh();
  field(r, 'brand').options[0].childOptions[0].level = 'av.year';
  assert.throws(() => validate(r), /Tree level/);
  r = fresh();
  field(r, 'model').options.push(structuredClone(field(r, 'brand').options[0].childOptions[0]));
  assert.throws(() => validate(r), /Duplicate ID/);
  r = fresh();
  r.binding.fields[0].depends_on = ['av.absent'];
  assert.throws(() => validate(r), /Missing dependency/);
});

test('generation is deterministic and does not mutate source evidence', () => {
  const before = JSON.stringify({history, video});
  assert.deepEqual(fresh(), fresh());
  assert.equal(JSON.stringify({history, video}), before);
  // The delivered files may have been enriched from HAR after this bootstrap.
  assert.deepEqual(Object.keys(fresh()).sort(), ['binding','provenance','schema']);
});
