import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiServer} from '../vps/server.mjs';

const secret='test-proxy-secret-that-is-more-than-32-characters';
const config={DATA_DIR:':memory:',PUBLIC_ORIGIN:'https://87.199.205.227',VPS_PROXY_SECRET:secret,AI_API_KEY:'server-test-secret',AI_MODEL:'deepseek/test',AI_PROVIDER:'openrouter'};
test('VPS configuration requires HTTPS and a strong proxy credential',()=>{
  assert.throws(()=>createApiServer({...config,PUBLIC_ORIGIN:'http://example.com'}),/HTTPS/);
  assert.throws(()=>createApiServer({...config,VPS_PROXY_SECRET:'short'}),/strong/);
});
test('VPS gateway rejects spoofed identity and exposes only safe settings through trusted proxy',async()=>{
  const server=createApiServer(config);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  try {
    const spoof=await fetch(url+'/api/ai-settings',{headers:{'oai-authenticated-user-id':'attacker'}});
    assert.equal(spoof.status,401);
    const valid=await fetch(url+'/api/ai-settings',{headers:{'x-autopost-proxy-secret':secret}});
    assert.equal(valid.status,200);
    const output=await valid.text();
    assert.equal(JSON.parse(output).serverConfigured,true);
    assert.ok(!output.includes(config.AI_API_KEY));
    assert.ok(!output.includes(secret));
    const foreign=await fetch(url+'/api/analyze',{method:'POST',headers:{'x-autopost-proxy-secret':secret,origin:'https://attacker.invalid','content-type':'application/json'},body:JSON.stringify({text:'Продам Volkswagen Passat 2018'})});
    assert.equal(foreign.status,403);
    const oversized=await fetch(url+'/api/analyze',{method:'POST',headers:{'x-autopost-proxy-secret':secret,origin:config.PUBLIC_ORIGIN,'content-type':'application/json'},body:JSON.stringify({text:'a'.repeat(23000)})});
    assert.equal(oversized.status,413);
    const health=await fetch(url+'/healthz');
    assert.deepEqual(await health.json(),{ok:true});
  } finally {await new Promise(resolve=>server.close(resolve));}
});
