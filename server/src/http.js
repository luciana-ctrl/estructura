import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { HttpError } from './util.js';

/** Router mínimo: rutas con parámetros tipo /api/hotels/:id */
export class Router {
  routes = [];

  add(method, path, handler) {
    const keys = [];
    const re = new RegExp(
      `^${path.replace(/\//g, '\\/').replace(/:([a-zA-Z]+)/g, (_, k) => {
        keys.push(k);
        return '([^/]+)';
      })}\\/?$`
    );
    this.routes.push({ method, re, keys, handler });
    return this;
  }

  get = (p, h) => this.add('GET', p, h);
  post = (p, h) => this.add('POST', p, h);
  put = (p, h) => this.add('PUT', p, h);
  delete = (p, h) => this.add('DELETE', p, h);

  match(method, pathname) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = pathname.match(r.re);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      return { handler: r.handler, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

export async function readJson(req, limit = 256 * 1024) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Cuerpo demasiado grande');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
}

export function sendJson(res, status, data) {
  const body = data === undefined ? '' : JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.map': 'application/json',
};

/** Sirve un archivo de `root` si existe; devuelve false si no. */
export function serveStatic(res, root, urlPath, { cache = 'no-cache', fallback } = {}) {
  const safe = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  let file = join(root, safe);
  if (!file.startsWith(root + sep) && file !== root) return false;
  let st;
  try {
    st = statSync(file);
    if (st.isDirectory()) {
      file = join(file, 'index.html');
      st = statSync(file);
    }
  } catch {
    if (!fallback) return false;
    file = join(root, fallback);
    try {
      st = statSync(file);
    } catch {
      return false;
    }
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'content-length': st.size,
    'cache-control': cache,
  });
  createReadStream(file).pipe(res);
  return true;
}
