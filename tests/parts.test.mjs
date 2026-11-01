import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLocally,partsSample,sanitizeListing,validateListing,listingText} from '../lib/listing.ts';
import {getPlatforms,platformValidation} from '../lib/platforms.ts';
import {systemPrompt} from '../lib/ai-prompt.ts';

test('parts parsing preserves OEM, explicit fitment, defects and per-item price',()=>{
  const d=parseLocally(partsSample,'parts');
  assert.equal(d.category,'parts');assert.equal(d.partNumber,'3G1941035D');
  assert.equal(d.brand,'Volkswagen');assert.equal(d.model,'Passat B8');assert.equal(d.year,'2018');
  assert.equal(d.fitYears,'2015–2019');assert.equal(d.condition,'Б/у');
  assert.equal(d.price,'450');assert.equal(d.priceUnit,'За штуку');assert.equal(d.quantity,'1');
  assert.equal(d.manufacturer,'');assert.equal(d.phone,'');assert.equal(d.engine,'');
  assert.match(d.description,/царапина/);assert.match(d.description,/крепление восстановлено/);
  assert.deepEqual(validateListing({...d,phone:'+375291234567'}),[]);
});
test('parts do not infer OEM, donor year, stock or unit; keep leading zeroes',()=>{
  const unknown=parseLocally('Продам фару для Audi A4. Совместимость: 2010–2015. Цена 200 BYN.','parts');
  for(const key of ['partNumber','year','quantity','priceUnit','condition','availability','manufacturer'])assert.equal(unknown[key],'');
  const d=parseLocally('Продам деталь. Артикул 000123-AB. Не новая, не в наличии.','parts');
  assert.equal(d.partNumber,'000123-AB');assert.equal(d.condition,'');assert.equal(d.availability,'');
  assert.ok(validateListing(unknown).includes('Цена указана'));
});
test('parts sanitization, text export and channel selection remain separate from cars',()=>{
  const d=sanitizeListing({...parseLocally(partsSample,'parts'),partNumber:'000123-AB',mileage:'100',engine:'3.0',quantity:'0'});
  assert.equal(d.engine,'');assert.equal(d.mileage,'');assert.equal(d.partNumber,'000123-AB');
  assert.equal(validateListing(d).some(x=>x.includes('Количество')),false,'Zero stock is stored; publishing preflight blocks it separately');
  assert.ok(validateListing({...d,quantity:'-1'}).some(x=>x.includes('Количество')));
  const text=listingText(d);assert.match(text,/000123-AB/);assert.match(text,/за штуку/);assert.match(text,/царапина/);
  assert.equal(getPlatforms('parts').length,5);assert.ok(!getPlatforms('parts').some(p=>p.id==='avby'));
  assert.ok(platformValidation(d,['avby']).length);
  assert.equal(platformValidation({...d,year:''},['bamper']).length,1);
  assert.deepEqual(platformValidation({...d,year:''},['kufar-parts']),[]);
});

test('parts prompt keeps explicit fitment and differs from the car schema',()=>{
 assert.match(systemPrompt('parts'),/не расширяй список/);
 assert.match(systemPrompt('parts'),/не выбирай год из диапазона/);
 assert.notEqual(systemPrompt('cars'),systemPrompt('parts'));
});
