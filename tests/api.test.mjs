import test from 'node:test';
import assert from 'node:assert/strict';
import {POST} from '../app/api/analyze/route.ts';
import {GET} from '../app/api/ai-settings/route.ts';
import {runWithAISettings} from '../lib/ai-context.ts';
const request=(body,origin='http://localhost:5173')=>new Request('http://localhost:5173/api/analyze',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});

test('classification sends only text and returns allowlisted categories',async()=>{
 const real=globalThis.fetch;let captured;
 globalThis.fetch=async(_url,init)=>{captured=JSON.parse(init.body);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({candidates:[{id:'auto.parts.optics',confidence:.9},{id:'invented.category',confidence:1}],question:'Уточните тип товара'})}}]});};
 try{
  const response=await POST(request({task:'classify',text:'Продам фару для Volkswagen Passat',key:'test-not-a-real-key',provider:'openrouter',photos:['DO_NOT_SEND_IMAGE']}));
  assert.equal(response.status,200);const result=await response.json();assert.deepEqual(result.candidates.map(c=>c.id),['auto.parts.optics']);assert.ok(!JSON.stringify(captured).includes('DO_NOT_SEND_IMAGE'));assert.match(captured.messages[0].content,/auto.parts.optics/);
 }finally{globalThis.fetch=real;}
});
test('rejects foreign origin',async()=>assert.equal((await POST(request({},'https://evil.example'))).status,403));
test('requires a real user API key, no silent fake AI',async()=>assert.equal((await POST(request({text:'Продам Volkswagen Passat 2018'}))).status,401));
test('bounds streamed requests',async()=>assert.equal((await POST(request({text:'a'.repeat(23000)}))).status,413));
test('rejects arbitrary provider URLs',async()=>assert.equal((await POST(request({text:'Продам Volkswagen Passat 2018',key:'test-not-a-real-key',provider:'http://localhost'}))).status,400));
test('uses fixed upstream and sanitizes JSON; never returns key',async()=>{const real=globalThis.fetch;let captured;globalThis.fetch=async(url,init)=>{captured={url,body:JSON.parse(init.body)};return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({brand:'VW',year:2018,currency:'XXX',secret:'unexpected'})}}]});};try{const r=await POST(request({text:'Продам Volkswagen Passat 2018',key:'test-not-a-real-key',provider:'deepseek',model:'deepseek-flash'}));assert.equal(r.status,200);const d=await r.json();assert.equal(captured.url,'https://api.deepseek.com/chat/completions');assert.equal(captured.body.response_format.type,'json_object');assert.equal(d.listing.year,'2018');assert.equal(d.listing.currency,'');assert.equal(d.listing.secret,undefined);assert.ok(!JSON.stringify(d).includes('test-not-a-real-key'));}finally{globalThis.fetch=real;}});
test('upstream errors have safe messages',async()=>{const real=globalThis.fetch;globalThis.fetch=async()=>new Response('secret provider error',{status:401});try{const r=await POST(request({text:'Продам Volkswagen Passat 2018',key:'test-not-a-real-key',provider:'deepseek'}));assert.equal(r.status,502);assert.ok(!(await r.text()).includes('secret'));}finally{globalThis.fetch=real;}});
test('server configuration never exposes credentials',async()=>{const r=runWithAISettings({AI_API_KEY:'test-server-secret',AI_PROVIDER:'openrouter',AI_MODEL:'deepseek/test'},()=>GET(new Request('http://localhost:5173/api/ai-settings')));const data=await r.json();assert.equal(data.serverConfigured,true);assert.equal(data.provider,'openrouter');assert.ok(!JSON.stringify(data).includes('secret'));});
test('anonymous remote users cannot spend server credentials',async()=>{const r=await runWithAISettings({AI_API_KEY:'test-server-secret'},()=>POST(new Request('https://example.com/api/analyze',{method:'POST',headers:{origin:'https://example.com','content-type':'application/json'},body:JSON.stringify({text:'Продам Volkswagen Passat 2018'})})));assert.equal(r.status,401);});
test('server key uses configured provider/model, not client-selected expensive model',async()=>{const real=globalThis.fetch;let captured;globalThis.fetch=async(url,init)=>{captured={url,body:JSON.parse(init.body)};return Response.json({choices:[{finish_reason:'stop',message:{content:'{"brand":"Volkswagen"}'}}]});};try{const r=await runWithAISettings({AI_API_KEY:'test-server-secret',AI_PROVIDER:'openrouter',AI_MODEL:'deepseek/deepseek-v4.1-flash-1017'},()=>POST(request({text:'Продам Volkswagen Passat 2018',provider:'deepseek',model:'unrequested-expensive-model'})));assert.equal(r.status,200);assert.equal(captured.url,'https://openrouter.ai/api/v1/chat/completions');assert.equal(captured.body.model,'deepseek/deepseek-v4.1-flash-1017');assert.ok(!(await r.text()).includes('test-server-secret'));}finally{globalThis.fetch=real;}});
