import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {Readable} from 'node:stream';
import {pathToFileURL} from 'node:url';
import {POST} from '../app/api/analyze/route.ts';
import {GET} from '../app/api/ai-settings/route.ts';
import {runWithAISettings} from '../lib/ai-context.ts';
import {createWorkspace} from './workspace.mjs';

export function createApiServer(config) {
  const origin = new URL(config.PUBLIC_ORIGIN).origin;
  if (!origin.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin)) {
    throw new Error('PUBLIC_ORIGIN must use HTTPS.');
  }
  if (typeof config.VPS_PROXY_SECRET !== 'string' || config.VPS_PROXY_SECRET.length < 32) {
    throw new Error('A strong VPS_PROXY_SECRET is required.');
  }
  const expected = Buffer.from(config.VPS_PROXY_SECRET);
  const workspace=createWorkspace(config);
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const fail = (status, error) => {res.statusCode = status; res.end(JSON.stringify({error}));};
    if (req.url === '/healthz' && req.method === 'GET') {res.end('{"ok":true}'); return;}
    const provided = Buffer.from(String(req.headers['x-autopost-proxy-secret'] || ''));
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      fail(401, 'Войдите на сайт.'); return;
    }
    try {
      const url = new URL(req.url, origin);
      if (url.origin !== origin) {fail(400, 'Некорректный адрес.'); return;}
      const handler = url.pathname.startsWith('/api/workspace/') ? workspace.handle : url.pathname === '/api/analyze' && req.method === 'POST' ? POST
        : url.pathname === '/api/ai-settings' && req.method === 'GET' ? GET : null;
      if (!handler) {fail(404, 'Страница не найдена.'); return;}
      const headers = new Headers();
      for (const name of ['content-type', 'content-length', 'origin','cookie']) {
        if (typeof req.headers[name] === 'string') headers.set(name, req.headers[name]);
      }
      // Only the authenticated reverse proxy can reach this branch. Ignore all client identity headers.
      headers.set('oai-authenticated-user-id', 'vps-owner');
      const request = new Request(url, {
        method: req.method, headers,
        ...(req.method === 'POST' ? {body: Readable.toWeb(req), duplex: 'half'} : {}),
      });
      const profile=workspace.user(request);
      if(profile)request.headers.set('oai-authenticated-user-id',profile.id);
      const response = await runWithAISettings(config, () => handler(request));
      res.statusCode = response.status;
      response.headers.forEach((value, name) => res.setHeader(name, value));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!res.headersSent) fail(500, 'Не удалось обработать запрос. Попробуйте ещё раз.');
      else res.destroy();
    }
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.on('close',()=>workspace.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createApiServer(process.env);
  const port = Number(process.env.PORT || 3000);
  server.listen(port, '127.0.0.1', () => console.log(`Autopost API listening on loopback:${port}`));
  const shutdown = () => {server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10000).unref();};
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
