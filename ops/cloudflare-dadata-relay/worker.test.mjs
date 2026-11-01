import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from './worker.mjs';

const env = { ALLOWED_SOURCE_IP: '192.0.2.10', RELAY_TOKEN: 'relay-test-'.repeat(5), DADATA_API_KEY: 'provider-test-key' };
function request(input = { query: 'Минск Независимости 11', count: 8 }, headers = {}) {
  return new Request('https://relay.example/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': env.ALLOWED_SOURCE_IP, Authorization: `Bearer ${env.RELAY_TOKEN}`, ...headers }, body: JSON.stringify(input) });
}

test('IP and credential checks fail closed without reaching provider', async () => {
  let calls = 0;
  const handler = createHandler(async () => { calls++; throw new Error(); });
  assert.equal((await handler(request({}, { 'CF-Connecting-IP': '192.0.2.20' }), env)).status, 403);
  assert.equal((await handler(request({}, { Authorization: 'Bearer wrong' }), env)).status, 401);
  assert.equal((await handler(request(), { ...env, RELAY_TOKEN: undefined })).status, 401);
  assert.equal((await handler(request(), { ...env, ALLOWED_SOURCE_IP: undefined })).status, 403);
  assert.equal(calls, 0);
});

test('invalid or oversized requests cannot consume provider quota', async () => {
  let calls = 0;
  const handler = createHandler(async () => { calls++; throw new Error(); });
  for (const input of [null, {}, { query: 'a', count: 1 }, { query: 'Минск', count: 9 }, { query: 'Минск', count: 1.5 }, { query: 'Минск', count: '1' }, { query: 'x'.repeat(5000), count: 1 }])
    assert.equal((await handler(request(input), env)).status, 400);
  assert.equal((await handler(request({}, { 'Content-Type': 'text/plain' }), env)).status, 415);
  assert.equal(calls, 0);
});

test('only Belarus address lookup is forwarded, with provider credentials', async () => {
  const handler = createHandler(async (url, init) => {
    assert.equal(url, 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.Authorization, `Token ${env.DADATA_API_KEY}`);
    assert.deepEqual(JSON.parse(init.body), { query: 'Минск', count: 1, locations: [{ country: 'Беларусь' }], restrict_value: true });
    return Response.json({ suggestions: [
      { value: 'Москва', data: { country_iso_code: 'RU' } },
      { value: 'г Минск', unrestricted_value: 'Беларусь, г Минск', data: { country_iso_code: 'BY', fias_id: 'relation:test', city: 'Минск', unknown: 'not exposed' } },
      { value: 'Брест', data: { country_iso_code: 'BY' } },
    ] });
  });
  const response = await handler(request({ query: ' Минск ', count: 1, url: 'https://untrusted.invalid', locations: [{ country: 'Россия' }], token: 'untrusted' }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.has('Access-Control-Allow-Origin'), false);
  const body = await response.json();
  assert.equal(body.suggestions.length, 1);
  assert.equal(body.suggestions[0].data.fias_id, 'relation:test');
  assert.equal(body.suggestions[0].data.unknown, undefined);
});

test('rate limits and upstream failures are safe and never retried', async () => {
  for (const status of [301, 401, 403, 429, 503]) {
    let calls = 0;
    const response = await createHandler(async () => { calls++; return new Response('sensitive provider error', { status, headers: { 'Retry-After': '99999', Location: 'https://untrusted.invalid' } }); })(request(), env);
    assert.equal(response.status, status === 429 ? 429 : 503);
    assert.equal(calls, 1);
    if (status === 429) assert.equal(response.headers.get('Retry-After'), '3600');
    assert.equal((await response.text()).includes('sensitive'), false);
  }
});

test('malformed, oversized and failed upstream responses do not leak data', async () => {
  for (const upstream of [async () => new Response('x'.repeat(256001)), async () => Response.json({ wrong: [] }), async () => { throw new Error(env.DADATA_API_KEY); }]) {
    const response = await createHandler(upstream)(request(), env);
    assert.ok(response.status >= 500);
    assert.equal((await response.text()).includes(env.DADATA_API_KEY), false);
  }
});
