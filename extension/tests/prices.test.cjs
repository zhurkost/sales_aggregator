'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
require('../taxonomy.js');
const prices=require('../prices.js');
const criteria={query:'RX 570',terms:['RX 570'],taxonomyId:'computers.gpu',kind:'product',condition:'Б/у'};
// Minimal observed public-page structure, with synthetic offers and no seller data.
const kufar=(ads,total='42')=>'<script id="__NEXT_DATA__" type="application/json">'+JSON.stringify({props:{initialState:{listing:{ads,total,error:''},recommendations:{ads:[{subject:'must not appear'}]}}}})+'</script>';
const offer=(id,subject,price,currency='BYR')=>({ad_id:id,subject,type:'sell',category:'16010',currency,price_byn:String(price),price_usd:String(price),ad_parameters:[{p:'condition',vl:'Б/у'}]});
test('Kufar parses actual cents/string-total format, excludes near models and separates currencies',()=>{
 const parsed=prices.parseKufar(kufar([offer(1,'RX570 4GB',10000),offer(2,'RX 570',20000),offer(3,'RX 5700',50000),offer(4,'RX 570 неисправная',5000),offer(5,'RX 570',0),offer(6,'RX 570',7000,'USD'),offer(7,'Кулер RX 570',1000)]));
 const result=prices.summarize(parsed,criteria);assert.equal(result.total,42);assert.equal(result.scanned,7);assert.equal(result.matched,4);assert.equal(result.unpriced,1);
 assert.deepEqual(result.groups,[{currency:'BYN',count:2,min:100,max:200,median:150},{currency:'USD',count:1,min:70,max:70,median:70}]);
 assert.equal(prices.summarize(prices.parseKufar(kufar([offer(1,'Радиатор Passat',10000)])),{...criteria,taxonomyId:'auto.parts.cooling',terms:['радиатор']}).matched,1);
 assert.throws(()=>prices.parseKufar('<h1>CAPTCHA</h1>'));assert.throws(()=>prices.parseKufar(kufar([],undefined).replace('"total":"42"','"total":null')));
});
test('Onliner uses explicit BYN symbol and never invents overall count',()=>{
 const html='<form class="b-searchsubj-form"></form><h2 class="wraptxt"><a href="/viewtopic.php?t=123">RX 570 б/у</a></h2><div class="price-primary">350,00 ƃ</div>';
 const result=prices.summarize(prices.parseOnliner(html),criteria);assert.equal(result.total,null);assert.equal(result.groups[0].median,350);
 assert.equal(prices.parseOnliner('<form class="b-searchsubj-form"></form>Ничего не найдено').offers.length,0);
 assert.throws(()=>prices.parseOnliner('<form class="b-searchsubj-form"></form>Login required'));
});
test('search uses fixed public hosts and category filters, omits cookies, and reports partial failures',async()=>{
 const real=global.fetch;const requests=[];
 global.fetch=async(url,options)=>{requests.push({url:new URL(url),options});return String(url).includes('kufar')?new Response(kufar([offer(1,'RX 570',12000),{...offer(2,'PC RX 570',90000),category:'16020'}])):new Response('blocked',{status:403});};
 try{const result=await prices.search(criteria);assert.equal(requests.length,2);for(const r of requests){assert.equal(r.options.credentials,'omit');assert.equal(r.options.redirect,'error');assert.equal(r.url.protocol,'https:');}
 assert.equal(requests[0].url.searchParams.get('cat'),'16010');assert.equal(requests[0].url.searchParams.get('cct'),'11');assert.equal(requests[1].url.searchParams.get('cat'),'1');assert.equal(requests[1].url.searchParams.get('f'),'286');
 assert.equal(result.results[0].matched,1);assert.equal(result.results[1].status,'unavailable');
 await assert.rejects(prices.search({...criteria,query:'https://attacker.invalid'}));assert.equal(requests.length,2);
 }finally{global.fetch=real;}
});
