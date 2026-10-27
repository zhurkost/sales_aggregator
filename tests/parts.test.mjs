import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLocally,partsSample,sanitizeListing,validateListing,listingText} from '../lib/listing.ts';
import {getPlatforms,platformValidation} from '../lib/platforms.ts';
import {systemPrompt} from '../lib/ai-prompt.ts';
import {POST} from '../app/api/analyze/route.ts';

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
test('AI receives part schema and cannot change selected product group',async()=>{
  const real=globalThis.fetch;let prompt;
  globalThis.fetch=async(_url,init)=>{prompt=JSON.parse(init.body).messages[0].content;return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({category:'cars',partName:'Фара',partNumber:'000123-AB',description:'Царапина на стекле.',condition:'Б/у',priceUnit:'За штуку'})}}]});};
  try{
    const r=await POST(new Request('http://localhost:5173/api/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({category:'parts',text:'Продам фару. Артикул 000123-AB. Царапина на стекле.',provider:'openrouter',key:'test-api-key-not-real'})}));
    assert.equal(r.status,200);const data=await r.json();assert.equal(data.listing.category,'parts');assert.equal(data.listing.partNumber,'000123-AB');
    assert.match(prompt,/не расширяй список/);assert.match(prompt,/не выбирай год из диапазона/);
    assert.notEqual(systemPrompt('cars'),systemPrompt('parts'));
  }finally{globalThis.fetch=real;}
});
test('unknown product categories and null JSON are rejected before calling AI',async()=>{
  for(const body of [null,[],{category:'unsafe-other',text:'Продам деталь для автомобиля'}]){
    const r=await POST(new Request('http://localhost:5173/api/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
    assert.equal(r.status,400);
  }
});
test('a part number invented by the model is not accepted as a structured OEM',async()=>{
  const real=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({choices:[{finish_reason:'stop',message:{content:'{"partName":"Фара","partNumber":"INVENTED-123"}'}}]});
  try{
    const r=await POST(new Request('http://localhost:5173/api/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({category:'parts',text:'Продам фару, артикул неизвестен.',provider:'openrouter',key:'test-api-key-not-real'})}));
    assert.equal((await r.json()).listing.partNumber,'');
  }finally{globalThis.fetch=real;}
});
test('AI cannot invent contact or stock and an explicit single price wins over model output',async()=>{
 const real=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({partName:'Фара',price:'999',currency:'USD',phone:'+375291234567',quantity:'1',availability:'В наличии',priceUnit:'За штуку',manufacturer:'Invented Brand'})}}]});
 try{
  const r=await POST(new Request('http://localhost:5173/api/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({category:'parts',text:'Продам фару. Цена 450 BYN. Производитель и количество неизвестны.',provider:'openrouter',key:'test-api-key-not-real'})}));
  const {listing}=await r.json();assert.equal(listing.price,'450');assert.equal(listing.currency,'BYN');
  for(const key of ['phone','quantity','availability','priceUnit','manufacturer'])assert.equal(listing[key],'',key);
 }finally{globalThis.fetch=real;}
});
