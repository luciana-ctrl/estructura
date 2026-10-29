import { timingSafeEqual } from 'node:crypto';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, readJson, sendJson, serveStatic } from './http.js';
import { HttpError } from './util.js';
import * as svc from './services.js';
import { getConversation, handleChat } from './chat/service.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Crea el manejador HTTP.
 * @param {object} opts
 * @param {import('node:sqlite').DatabaseSync} opts.db
 * @param {object} [opts.notifier]
 * @param {string} [opts.panelToken]  si se define, la API del panel exige "Authorization: Bearer <token>"
 */
export function createApp({ db, notifier, panelToken, webDist = join(ROOT, 'web', 'dist'), widgetDir = join(ROOT, 'widget') }) {
  const ctx = { notifier };
  const api = new Router();

  // ---------- público: lo usa el widget desde la web del hotel
  api.get('/api/health', () => ({ ok: true }));
  api.get('/api/public/hotels/:id', ({ params }) => svc.publicHotelConfig(db, params.id));
  api.post('/api/chat', ({ body }) => handleChat(db, body, ctx));
  api.get('/api/public/hotels/:id/conversations/:cid', ({ params }) => getConversation(db, params.id, params.cid));

  // ---------- panel del hotel
  api.get('/api/meta', () => ({ rejectionReasons: svc.REJECTION_REASONS, statuses: svc.STATUSES, pending: svc.pendingCounts(db) }));

  api.get('/api/hotels', () => svc.listHotels(db));
  api.post('/api/hotels', ({ body }) => [201, svc.createHotel(db, body)]);
  api.get('/api/hotels/:id', ({ params }) => svc.getHotel(db, params.id));
  api.put('/api/hotels/:id', ({ params, body }) => svc.updateHotel(db, params.id, body));

  api.get('/api/hotels/:id/extras', ({ params }) => svc.listExtras(db, params.id));
  api.post('/api/hotels/:id/extras', ({ params, body }) => [201, svc.createExtra(db, params.id, body)]);
  api.put('/api/hotels/:id/extras/:extraId', ({ params, body }) => svc.updateExtra(db, params.id, Number(params.extraId), body));
  api.delete('/api/hotels/:id/extras/:extraId', ({ params }) => (svc.deleteExtra(db, params.id, Number(params.extraId)), [204]));

  api.get('/api/hotels/:id/staff', ({ params }) => svc.listStaff(db, params.id));
  api.post('/api/hotels/:id/staff', ({ params, body }) => [201, svc.createStaff(db, params.id, body)]);
  api.put('/api/hotels/:id/staff/:staffId', ({ params, body }) => svc.updateStaff(db, params.id, Number(params.staffId), body));
  api.delete('/api/hotels/:id/staff/:staffId', ({ params }) => (svc.deleteStaff(db, params.id, Number(params.staffId)), [204]));

  api.get('/api/requests', ({ query }) => svc.listRequests(db, query));
  api.post('/api/requests', ({ body }) => [201, svc.createRequest(db, { source: 'manual', ...body }, ctx)]);
  api.get('/api/requests/:id', ({ params }) => svc.getRequestDetail(db, Number(params.id)));
  api.post('/api/requests/:id/confirm', ({ params, body }) => svc.confirmRequest(db, Number(params.id), body, ctx));
  api.post('/api/requests/:id/reject', ({ params, body }) => svc.rejectRequest(db, Number(params.id), body, ctx));
  api.post('/api/requests/:id/reopen', ({ params }) => svc.reopenRequest(db, Number(params.id)));
  api.post('/api/requests/:id/cancel', ({ params, body }) => svc.cancelRequest(db, Number(params.id), body));

  api.get('/api/analytics', ({ query }) => svc.analytics(db, query));

  const isPublic = (path) => path === '/api/health' || path === '/api/chat' || path.startsWith('/api/public/');

  function authorized(req) {
    if (!panelToken) return true;
    const header = req.headers.authorization ?? '';
    const given = Buffer.from(header.replace(/^Bearer\s+/i, ''));
    const expected = Buffer.from(panelToken);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;

    if (path.startsWith('/api/')) {
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-headers', 'content-type, authorization');
      res.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
      if (req.method === 'OPTIONS') return void res.writeHead(204).end();
      try {
        if (!isPublic(path) && !authorized(req)) throw new HttpError(401, 'Token del panel inválido o ausente');
        const found = api.match(req.method, path);
        if (!found) throw new HttpError(404, 'Ruta no encontrada');
        if (found.methodNotAllowed) throw new HttpError(405, 'Método no permitido');
        const body = await readJson(req);
        const query = Object.fromEntries(url.searchParams);
        const out = await found.handler({ params: found.params, query, body, req });
        if (Array.isArray(out) && typeof out[0] === 'number') return sendJson(res, out[0], out[1]);
        return sendJson(res, 200, out);
      } catch (err) {
        if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message, details: err.details });
        console.error(err);
        return sendJson(res, 500, { error: 'Error interno del servidor' });
      }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405).end();

    // Widget embebible: se cachea poco para que los cambios lleguen rápido a las webs de los hoteles
    if (path === '/widget.js') {
      res.setHeader('access-control-allow-origin', '*');
      if (serveStatic(res, widgetDir, 'widget.js', { cache: 'public, max-age=300' })) return;
    }
    if (path === '/demo' || path === '/demo.html') {
      if (serveStatic(res, widgetDir, 'demo.html')) return;
    }

    // Panel (React compilado). Cualquier ruta desconocida devuelve index.html (SPA).
    if (serveStatic(res, webDist, path === '/' ? 'index.html' : path, { fallback: extname(path) ? undefined : 'index.html' })) return;

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Panel no compilado todavía. Ejecuta: npm run build');
  };
}
