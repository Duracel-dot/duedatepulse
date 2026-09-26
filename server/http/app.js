// Serveur HTTP : fichiers statiques de la vue 3D, API REST et flux temps reel (SSE).
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { ROOT_DIR } from '../config.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const STATIC_ROOTS = [
  { prefix: '/shared/', dir: path.join(ROOT_DIR, 'shared') },
  { prefix: '/vendor/three/build/', dir: path.join(ROOT_DIR, 'node_modules', 'three', 'build') },
  { prefix: '/vendor/three/addons/', dir: path.join(ROOT_DIR, 'node_modules', 'three', 'examples', 'jsm') },
  { prefix: '/', dir: path.join(ROOT_DIR, 'public') },
];

const MAX_BODY = 20 * 1024 * 1024;

/**
 * @param {{config:object, store:import('../model/store.js').TopologyStore, collectors:()=>object[],
 *          logger:object, info:object}} deps
 */
export function createHttpServer({ config, store, collectors, logger, info }) {
  const log = logger.child('http');
  const sse = new Set();
  const srvCfg = config.server;

  // Diffusion des deltas de topologie
  store.on('delta', (delta) => broadcast('delta', delta));
  let lastCollectorsJson = '';
  const collectorsTimer = setInterval(() => {
    const json = JSON.stringify(collectors());
    if (json !== lastCollectorsJson) {
      lastCollectorsJson = json;
      broadcastRaw('collectors', json);
    }
  }, 3000);
  collectorsTimer.unref();
  const pingTimer = setInterval(() => {
    for (const res of sse) res.write(': ping\n\n');
  }, 20000);
  pingTimer.unref();

  function broadcast(event, data) {
    if (!sse.size) return;
    broadcastRaw(event, JSON.stringify(data));
  }

  function broadcastRaw(event, json) {
    const msg = `event: ${event}\ndata: ${json}\n\n`;
    for (const res of sse) res.write(msg);
  }

  const routes = [
    ['GET', /^\/api\/health$/, (req, res) => sendJson(req, res, 200, { ok: true, uptimeS: Math.round(process.uptime()), version: info.version })],
    ['GET', /^\/api\/config$/, (req, res) => sendJson(req, res, 200, {
      title: config.ui?.title || 'SupervisionNG', demo: info.demo, version: info.version,
      thresholds: store.thresholds, ui: config.ui || {},
    })],
    ['GET', /^\/api\/topology$/, (req, res) => sendJson(req, res, 200, { ...store.getTopology(), collectors: collectors() })],
    ['GET', /^\/api\/collectors$/, (req, res) => sendJson(req, res, 200, collectors())],
    ['GET', /^\/api\/alarms$/, (req, res) => sendJson(req, res, 200, store.alarms)],
    ['GET', /^\/api\/entities\/(.+)$/, (req, res, m) => {
      const id = decodeURIComponent(m[1]);
      const entity = store.getEntity(id);
      if (!entity) return sendJson(req, res, 404, { error: 'entite inconnue' });
      const topo = store.getTopology();
      sendJson(req, res, 200, {
        entity,
        history: store.getHistory(id),
        children: topo.entities.filter((e) => e.parent === id).map((e) => e.id),
        links: topo.links.filter((l) => l.a === id || l.b === id),
        flows: topo.flows.filter((f) => f.src === id || f.dst === id),
      });
    }],
    ['POST', /^\/api\/alarms\/(.+)\/ack$/, (req, res, m) => {
      store.acknowledge(decodeURIComponent(m[1]), true);
      sendJson(req, res, 200, { ok: true });
    }],
    ['DELETE', /^\/api\/alarms\/(.+)\/ack$/, (req, res, m) => {
      store.acknowledge(decodeURIComponent(m[1]), false);
      sendJson(req, res, 200, { ok: true });
    }],
    ['POST', /^\/api\/ingest\/([\w.:-]{1,64})$/, async (req, res, m) => {
      if (!checkIngestToken(req, srvCfg.ingestToken)) return sendJson(req, res, 401, { error: 'jeton d\'ingestion invalide' });
      const body = await readJsonBody(req);
      const sourceId = `ingest:${m[1]}`;
      store.publish(sourceId, body, { priority: Number(body.priority) || 50, staleAfterMs: body.staleAfterSeconds ? body.staleAfterSeconds * 1000 : null });
      info.ingestSources.set(sourceId, { name: sourceId, type: 'ingest', state: 'ok', lastRun: new Date().toISOString(), counts: { entities: body.entities?.length || 0, links: body.links?.length || 0, flows: body.flows?.length || 0 } });
      sendJson(req, res, 202, { ok: true, source: sourceId });
    }],
    ['DELETE', /^\/api\/ingest\/([\w.:-]{1,64})$/, (req, res, m) => {
      if (!checkIngestToken(req, srvCfg.ingestToken)) return sendJson(req, res, 401, { error: 'jeton d\'ingestion invalide' });
      store.removeSource(`ingest:${m[1]}`);
      info.ingestSources.delete(`ingest:${m[1]}`);
      sendJson(req, res, 200, { ok: true });
    }],
    ['GET', /^\/api\/events$/, (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 3000\n\n');
      res.write(`event: snapshot\ndata: ${JSON.stringify({ ...store.getTopology(), collectors: collectors() })}\n\n`);
      sse.add(res);
      req.on('close', () => sse.delete(res));
    }],
  ];

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (srvCfg.auth?.username && pathname !== '/api/health' && !pathname.startsWith('/api/ingest/') && !checkBasicAuth(req, srvCfg.auth)) {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="SupervisionNG", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Authentification requise');
        return;
      }
      if (pathname.startsWith('/api/')) {
        for (const [method, re, fn] of routes) {
          const m = pathname.match(re);
          if (m && req.method === method) return await fn(req, res, m, url);
        }
        const allowed = routes.filter(([, re]) => re.test(pathname)).map(([mth]) => mth);
        if (allowed.length) {
          res.setHeader('Allow', allowed.join(', '));
          return sendJson(req, res, 405, { error: 'methode non autorisee' });
        }
        return sendJson(req, res, 404, { error: 'route inconnue' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(req, res, 405, { error: 'methode non autorisee' });
      return serveStatic(req, res, pathname);
    } catch (err) {
      if (err.statusCode) return sendJson(req, res, err.statusCode, { error: err.message });
      log.error(`${req.method} ${pathname}`, err);
      if (!res.headersSent) sendJson(req, res, 500, { error: 'erreur interne' });
      else res.end();
    }
  }

  let server;
  if (srvCfg.https) {
    const opts = {};
    if (srvCfg.https.pfx) {
      opts.pfx = fs.readFileSync(path.resolve(ROOT_DIR, srvCfg.https.pfx));
      if (srvCfg.https.passphrase) opts.passphrase = srvCfg.https.passphrase;
    } else {
      opts.cert = fs.readFileSync(path.resolve(ROOT_DIR, srvCfg.https.cert));
      opts.key = fs.readFileSync(path.resolve(ROOT_DIR, srvCfg.https.key));
    }
    server = https.createServer(opts, handler);
  } else {
    server = http.createServer(handler);
  }
  server.keepAliveTimeout = 65000;
  server.on('close', () => {
    clearInterval(collectorsTimer);
    clearInterval(pingTimer);
    for (const res of sse) res.end();
    sse.clear();
  });
  server.closeSse = () => { for (const res of sse) res.end(); sse.clear(); };
  return server;
}

// ---------------------------------------------------------------------------

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  for (const { prefix, dir } of STATIC_ROOTS) {
    if (!rel.startsWith(prefix)) continue;
    const file = path.resolve(dir, '.' + rel.slice(prefix.length - 1));
    if (!file.startsWith(dir + path.sep)) break;
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    if (!st.isFile()) continue;
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const headers = {
      'Content-Type': type,
      ETag: etag,
      'Cache-Control': prefix.startsWith('/vendor/') ? 'public, max-age=86400' : 'no-cache',
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      return res.end();
    }
    const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && /text|json|svg/.test(type) && st.size > 1024;
    if (gzip) {
      headers['Content-Encoding'] = 'gzip';
      headers.Vary = 'Accept-Encoding';
      res.writeHead(200, headers);
      fs.createReadStream(file).pipe(zlib.createGzip()).pipe(res);
    } else {
      headers['Content-Length'] = st.size;
      res.writeHead(200, headers);
      fs.createReadStream(file).pipe(res);
    }
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Introuvable');
}

function sendJson(req, res, status, obj) {
  const body = JSON.stringify(obj);
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (body.length > 2048 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    const gz = zlib.gzipSync(body);
    res.writeHead(status, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', 'Content-Length': gz.length });
    res.end(gz);
    return;
  }
  res.writeHead(status, { ...headers, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('corps de requete trop volumineux'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const obj = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('objet JSON attendu');
        resolve(obj);
      } catch (err) {
        reject(Object.assign(new Error(`JSON invalide : ${err.message}`), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function checkBasicAuth(req, auth) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const decoded = Buffer.from(h.slice(6), 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  if (i < 0) return false;
  return safeEqual(decoded.slice(0, i), auth.username) & safeEqual(decoded.slice(i + 1), auth.password ?? '');
}

// Sans jeton configure, l'ingestion n'est acceptee que depuis la machine locale.
function checkIngestToken(req, token) {
  if (!token) {
    const addr = req.socket.remoteAddress || '';
    return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  }
  const h = req.headers.authorization || '';
  const given = h.startsWith('Bearer ') ? h.slice(7) : req.headers['x-sng-token'];
  return given ? safeEqual(given, token) : false;
}
