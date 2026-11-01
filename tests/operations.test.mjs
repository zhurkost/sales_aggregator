import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {emptyListing} from '../lib/listing.ts';
import {readiness,availablePlatforms,queueGroup} from '../lib/readiness.ts';
import {editListing,emptyBatchEdit} from '../lib/batch-edit.ts';
import {readYml} from '../lib/catalog-import.ts';
const card=()=>({id:crypto.randomUUID(),revision:0,listing:{...emptyListing,category:'general',taxonomyId:'computers.gpu',title:'RX 570',description:'Проверенная карта',price:'150',currency:'BYN',city:'Минск',phone:'+375291234567'},photos:[{id:'p1',name:'gpu.jpg',dataUrl:'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2Q=='}],selected:['kufar-general','onliner-general'],prepared:true,categoryConfirmed:true,archived:false,jobs:[],events:[]});

test('readiness is per platform, does not invent account access and excludes already launched jobs',()=>{
 const r=card();r.jobs=[{platformId:'kufar-general',status:'review_required',message:'Проверка'}];
 const rows=readiness(r,true);assert.equal(rows.length,2);assert.equal(rows[0].existing,true);assert.deepEqual(availablePlatforms(r),['onliner-general']);
 assert.ok(rows.every(p=>p.notes.some(n=>n.includes('Вход в аккаунт'))));assert.ok(readiness(r,false).every(p=>p.blockers.includes('Подключите расширение')));
 assert.equal(queueGroup({url:'https://www.kufar.by/item/1',status:'link_recorded',remoteStatus:{state:'rejected'}}),'attention');
});
test('YML preserves leading zeros, text and photo references; rejects entities, malformed and foreign XML',async()=>{
 const win=new Window();const previous=globalThis.DOMParser;globalThis.DOMParser=win.DOMParser;
 try{const table=readYml('<yml_catalog><shop><offers><offer id="00001"><name>RX 570</name><price>150,50</price><currencyId>BYN</currencyId><vendorCode>0002</vendorCode><picture>https://example.com/gpu.jpg</picture><param name="Память">4 GB</param></offer></offers></shop></yml_catalog>');assert.equal(table.rows[0].externalId,'00001');assert.equal(table.rows[0].price,'150.50');assert.equal(table.rows[0].partNumber,'0002');assert.match(table.rows[0].description,/4 GB/);assert.throws(()=>readYml('<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><yml_catalog/>'));assert.throws(()=>readYml('<html/>'));}finally{globalThis.DOMParser=previous;win.happyDOM.abort();}
});

test('batch edits preserve untouched fields and reject invalid price adjustments',()=>{
 const listing=card().listing;
 const edit={...emptyBatchEdit,priceMode:'percent',priceValue:'-10',city:'Брест'};
 const result=editListing(listing,edit);
 assert.equal(result.price,'135');assert.equal(result.city,'Брест');assert.equal(result.title,listing.title);
 assert.throws(()=>editListing(listing,{...edit,priceValue:'-100'}));
});
