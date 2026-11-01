// A temporary, authenticated network diagnostic; not a public address API.
const ENDPOINT = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address';
const SAMPLE = 'Минск проспект Независимости 11';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

function json(value, status = 200) {
  return Response.json(value, { status, headers });
}

async function authorized(request, token) {
  if (!token || token.length < 32) return false;
  const supplied = request.headers.get('Authorization') || '';
  if (supplied.length > 256) return false;
  const encode = new TextEncoder();
  const digest = value => crypto.subtle.digest('SHA-256', encode.encode(value));
  const [a, b] = await Promise.all([digest(supplied), digest(`Bearer ${token}`)]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

export function createHandler(fetchUpstream = (url, init) => fetch(url, init)) {
  return async (request, env) => {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      return json({ service: 'autopost-dadata-probe', status: 'running' });
    }
    if (url.pathname !== '/probe') return json({ error: 'not_found' }, 404);
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!await authorized(request, env.PROBE_TOKEN)) return json({ error: 'unauthorized' }, 401);
    const expires = Date.parse(env.PROBE_EXPIRES_AT);
    if (!Number.isFinite(expires) || Date.now() >= expires) return json({ error: 'probe_expired' }, 410);
    if (!env.DADATA_API_KEY) return json({ error: 'not_configured' }, 503);
    // No user-supplied query, URL, headers, or body is forwarded to DaData.
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const result = { checkedAt: new Date().toISOString(), colo: request.cf?.colo || null };
    try {
      const response = await fetchUpstream(ENDPOINT, {
        method: 'POST', redirect: 'manual', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Token ${env.DADATA_API_KEY}` },
        body: JSON.stringify({ query: SAMPLE, count: 3, locations: [{ country: 'Беларусь' }], restrict_value: true }),
      });
      result.upstreamStatus = response.status;
      if (!response.ok) {
        await response.body?.cancel();
        return json({ ...result, ok: false, elapsedMs: Date.now() - started, error: 'upstream_http_error' }, 502);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let size = 0, body = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 262144) { await reader.cancel(); throw new Error('oversized'); }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
      const data = JSON.parse(body);
      if (!Array.isArray(data.suggestions)) throw new Error('unexpected_response');
      const suggestions = data.suggestions.filter(item => item.data?.country_iso_code === 'BY').slice(0, 3);
      return json({
        ...result, ok: true, elapsedMs: Date.now() - started, query: SAMPLE,
        count: suggestions.length,
        suggestions: suggestions.map(item => ({ label: item.value, country: item.data.country_iso_code, house: item.data.house })),
      });
    } catch (error) {
      // Only the authenticated diagnostic receives this network error; provider bodies are never returned.
      const detail = String(error?.message || 'Unknown error').replaceAll(env.DADATA_API_KEY, '[redacted]').replaceAll(env.PROBE_TOKEN, '[redacted]').slice(0, 300);
      return json({ ...result, ok: false, elapsedMs: Date.now() - started, error: controller.signal.aborted ? 'upstream_timeout' : 'upstream_unavailable', detail }, 502);
    } finally { clearTimeout(timeout); }
  };
}

export default { fetch: createHandler() };
