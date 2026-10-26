import test from 'node:test';
import assert from 'node:assert/strict';
import {categories} from '../lib/taxonomy.ts';
import {emptyListing} from '../lib/listing.ts';
import {categoryFields,cleanAttributes,describeAttributes,fieldCatalog,fieldVerification} from '../lib/attributes.ts';
import {withSellerContacts,newRecord} from '../lib/workspace.ts';
import {normalizeImport,csvExport,flagmaRows} from '../lib/bulk.ts';
import {sanitizeIdentity} from '../lib/price-identification.ts';

const gpu={...emptyListing,category:'general',taxonomyId:'computers.gpu',description:'Рабочая видеокарта'};
test('every mapped Kufar category has sourced rules; form coverage remains explicit',()=>{
 const mapped=categories.filter(c=>c.mappings.kufar);assert.equal(mapped.length,312);
 for(const c of mapped){assert.ok(fieldCatalog.kufar[c.mappings.kufar.id]?.length,c.id);assert.equal(Object.keys(fieldCatalog.coverage[c.id]).length,7);}
 assert.equal(fieldVerification('computers.gpu','kufar').status,'documentation_and_sample');
 assert.equal(fieldVerification('computers.gpu','onliner').status,'form_inspected');
 assert.equal(fieldVerification('auto.cars','onliner').status,'form_not_verified');
 assert.equal(fieldVerification('auto.cars','av').status,'blocked_vpn');
 assert.equal(fieldVerification('auto.parts','bamper').status,'form_inspected');
});
test('dependent GPU characteristics use fixed type, sanitize codes, and drop when category changes',()=>{
 const fields=categoryFields(gpu);const ram=fields.find(f=>f.key==='computers_desktop_ram');assert.ok(ram);
 assert.equal(fields.some(f=>f.key==='computers_component_type'),false);
 const value=ram.options[0][0];
 const clean=cleanAttributes(gpu,{computers_desktop_ram:value,computers_component_type:'1',unknown:'x',onliner_short_description:'Коротко'});
 assert.deepEqual(clean,{computers_desktop_ram:value,onliner_short_description:'Коротко'});
 assert.match(describeAttributes(gpu,clean),/Видеопамять/);assert.doesNotMatch(describeAttributes(gpu,clean),/Коротко/);
 assert.equal(cleanAttributes(gpu,{computers_desktop_ram:'invalid'}).computers_desktop_ram,undefined);
 assert.equal(cleanAttributes({...gpu,taxonomyId:'auto.cars'},clean).computers_desktop_ram,undefined);
 assert.deepEqual(cleanAttributes(gpu,JSON.parse('{"__proto__":"bad","constructor":"bad"}')),{});
 const record={...newRecord(gpu),attributes:clean};assert.match(csvExport([record]),/Видеопамять/);assert.match(flagmaRows([record],{}).rows[0]['Описание'],/Видеопамять/);
});
test('profile contacts fill blanks only, including bulk imports',()=>{
 const contacts={phone:'+375291112233',city:'Брест'};
 assert.equal(withSellerContacts({...gpu,city:'Минск'},contacts).city,'Минск');
 assert.equal(withSellerContacts(gpu,contacts).phone,contacts.phone);
 assert.equal(gpu.phone,'');
 const [preview]=normalizeImport({headers:['title'],rows:[{title:'RX 570'}]},{title:'title'},'computers.gpu',contacts);
 assert.equal(preview.record.listing.city,'Брест');assert.equal(preview.record.listing.phone,contacts.phone);
});
test('ambiguous, malformed and contact-bearing identities cannot start search',()=>{
 for(const value of [{status:'not_product'},{status:'needs_details',query:'RX 570',terms:['570']},{status:'identified',query:'https://evil.invalid',terms:['x']},{status:'identified',query:'+375291112233',terms:['x']},{status:'identified',query:'RX 570',terms:[]}]){
  const result=sanitizeIdentity(value);assert.notEqual(result.status,'identified');assert.equal(result.query,'');assert.deepEqual(result.terms,[]);
 }
 assert.equal(sanitizeIdentity({status:'identified',kind:'service',query:'Укладка ламината',terms:['ламинат']}).kind,'service');
});
