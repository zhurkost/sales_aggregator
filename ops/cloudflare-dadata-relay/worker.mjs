const ENDPOINT = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address';
const DATA_FIELDS = ['country_iso_code', 'fias_id', 'city', 'city_with_type', 'settlement', 'settlement_with_type', 'street', 'street_with_type', 'house', 'block', 'block_type', 'region_with_type', 'area_with_type', 'qc_geo', 'geo_lat', 'geo_lon'];

function json(value, status = 200, extra = {}) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra } });
}

async function equalToken(supplied, token) {
  if (!token || token.length < 32 || supplied.length > 256) return false;
  const encoder = new TextEncoder();
  const digest = value => crypto.subtle.digest('SHA-256', encoder.encode(value));
  const [a, b] = await Promise.all([digest(supplied), digest(`Bearer ${token}`)]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

async function readJson(body, limit) {
  if (!body) throw new Error('missing_body');
  const reader = body.getReader(), decoder = new TextDecoder();
  let size = 0, text = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error('body_limit'); }
    text += decoder.decode(value, { stream: true });
  }
  return JSON.parse(text + decoder.decode());
}

export function createHandler(fetchUpstream = (url, init) => fetch(url, init)) {
  return async (request, env) => {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true });
    if (url.pathname !== '/suggest' || url.search) return json({ error: 'not_found' }, 404);
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!env.ALLOWED_SOURCE_IP || request.headers.get('CF-Connecting-IP') !== env.ALLOWED_SOURCE_IP)
      return json({ error: 'forbidden' }, 403);
    if (!await equalToken(request.headers.get('Authorization') || '', env.RELAY_TOKEN))
      return json({ error: 'unauthorized' }, 401);
    if (!env.DADATA_API_KEY) return json({ error: 'not_configured' }, 503);
    if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json'))
      return json({ error: 'json_required' }, 415);
    let input;
    try { input = await readJson(request.body, 4096); }
    catch { return json({ error: 'invalid_body' }, 400); }
    if (!input || typeof input.query !== 'string' || input.query.trim().length < 3 || input.query.trim().length > 300 || !Number.isInteger(input.count) || input.count < 1 || input.count > 8)
      return json({ error: 'invalid_query' }, 400);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetchUpstream(ENDPOINT, {
        method: 'POST', redirect: 'manual', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Token ${env.DADATA_API_KEY}` },
        body: JSON.stringify({ query: input.query.trim(), count: input.count, locations: [{ country: 'Беларусь' }], restrict_value: true }),
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        if (response.status === 429) {
          const seconds = Number(response.headers.get('Retry-After'));
          return json({ error: 'provider_rate_limit' }, 429, { 'Retry-After': String(Number.isFinite(seconds) ? Math.min(3600, Math.max(60, Math.ceil(seconds))) : 60) });
        }
        return json({ error: 'provider_unavailable' }, 503);
      }
      const data = await readJson(response.body, 256000);
      if (!Array.isArray(data.suggestions)) return json({ error: 'invalid_provider_response' }, 502);
      const suggestions = data.suggestions.filter(item => item && item.data?.country_iso_code === 'BY' && typeof item.value === 'string').slice(0, input.count).map(item => ({
        value: item.value,
        unrestricted_value: typeof item.unrestricted_value === 'string' ? item.unrestricted_value : item.value,
        data: Object.fromEntries(DATA_FIELDS.map(field => [field, item.data[field] ?? null])),
      }));
      return json({ suggestions });
    } catch { return json({ error: controller.signal.aborted ? 'provider_timeout' : 'provider_unavailable' }, 503); }
    finally { clearTimeout(timer); }
  };
}

export default { fetch: createHandler() };
