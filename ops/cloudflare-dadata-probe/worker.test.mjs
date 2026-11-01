import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from './worker.mjs';

const env = { PROBE_TOKEN: 'test-token-'.repeat(4), DADATA_API_KEY: 'test-provider-key', PROBE_EXPIRES_AT: '2099-01-01T00:00:00Z' };
const request = (token = env.PROBE_TOKEN) => new Request('https://test/probe', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });

test('unauthorized and expired requests never reach DaData', async () => {
  const handler = createHandler(() => { throw new Error('must not fetch'); });
  assert.equal((await handler(request('wrong'), env)).status, 401);
  assert.equal((await handler(request(), { ...env, PROBE_TOKEN: undefined })).status, 401);
  assert.equal((await handler(request(), { ...env, PROBE_EXPIRES_AT: '2000-01-01' })).status, 410);
  assert.equal((await handler(request(), { ...env, PROBE_EXPIRES_AT: undefined })).status, 410);
});

test('probe forwards only its fixed public sample and returns a bounded summary', async () => {
  const handler = createHandler(async (url, init) => {
    assert.equal(url, 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.Authorization, 'Token test-provider-key');
    assert.deepEqual(JSON.parse(init.body), { query: 'Минск проспект Независимости 11', count: 3, locations: [{ country: 'Беларусь' }], restrict_value: true });
    return Response.json({ suggestions: [{ value: 'г Минск, пр-кт Независимости, д 11', data: { country_iso_code: 'BY', house: '11', internal: 'not returned' } }] });
  });
  const response = await handler(request(), env);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.deepEqual(result.suggestions[0], { label: 'г Минск, пр-кт Независимости, д 11', country: 'BY', house: '11' });
  assert.equal(JSON.stringify(result).includes(env.DADATA_API_KEY), false);
});

test('provider error bodies and credentials are not exposed', async () => {
  const response = await createHandler(async () => new Response('private error', { status: 403 }))(request(), env);
  assert.equal(response.status, 502);
  assert.equal((await response.text()).includes('private error'), false);
  const failure = await createHandler(async () => { throw new Error(`${env.DADATA_API_KEY} ${env.PROBE_TOKEN}`); })(request(), env);
  const text = await failure.text();
  assert.equal(failure.status, 502);
  assert.equal(text.includes(env.DADATA_API_KEY), false);
  assert.equal(text.includes(env.PROBE_TOKEN), false);
});
