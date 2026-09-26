// Demarrage complet du serveur (mode demonstration) et verification de l'API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let child;
let base;

before(async () => {
  child = spawn(process.execPath, ['server/index.js', '--demo', '--port', '0', '--host', '127.0.0.1', '--no-open'], {
    cwd: root, env: { ...process.env, SNG_CONFIG: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  base = await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`serveur non demarre : ${out}`)), 20000);
    const onData = (d) => {
      out += d;
      const m = out.match(/disponible sur (http:\/\/[^\s/]+:\d+)\//);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => reject(new Error(`serveur arrete (code ${code}) : ${out}`)));
  });
});

after(() => { child?.kill(); });

async function waitFor(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('delai depasse');
    await new Promise((r) => setTimeout(r, 300));
  }
}

test('GET /api/health', async () => {
  const r = await fetch(`${base}/api/health`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test('GET /api/topology : infrastructure de demonstration fusionnee', async () => {
  const topo = await waitFor(async () => {
    const t = await (await fetch(`${base}/api/topology`)).json();
    return t.entities.length > 200 && t.flows.length > 50 ? t : null;
  });
  const types = new Set(topo.entities.map((e) => e.type));
  for (const t of ['site', 'room', 'rack', 'server', 'switch', 'hypervisor', 'vm', 'external']) assert.ok(types.has(t), t);
  const vm = topo.entities.find((e) => e.name === 'web-portail-01');
  const hv = topo.entities.find((e) => e.id === vm.parent);
  const hw = topo.entities.find((e) => e.id === hv.parent);
  assert.equal(hv.type, 'hypervisor');
  assert.equal(hw.id, 'esx-par-01', 'serveur de l\'inventaire fusionne avec celui du vCenter');
  assert.ok(hw.sources.includes('demo:inventaire') && hw.sources.includes('demo:vcenter'));
  assert.ok(topo.links.some((l) => l.metrics?.util > 0));
  assert.equal(topo.collectors.length, 7);
});

test('GET /api/entities/:id et 404', async () => {
  const r = await fetch(`${base}/api/entities/esx-par-01`);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.entity.type, 'server');
  assert.ok(Array.isArray(d.links));
  assert.equal((await fetch(`${base}/api/entities/inexistant`)).status, 404);
});

test('POST /api/ingest/:source (local, sans jeton) puis suppression', async () => {
  const r = await fetch(`${base}/api/ingest/test`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entities: [{ id: 'ingest-srv', type: 'server', name: 'INGEST-SRV', status: 'ok' }] }),
  });
  assert.equal(r.status, 202);
  await waitFor(async () => (await fetch(`${base}/api/entities/ingest-srv`)).status === 200);
  const bad = await fetch(`${base}/api/ingest/test`, { method: 'POST', body: 'pas du json' });
  assert.equal(bad.status, 400);
  assert.equal((await fetch(`${base}/api/ingest/test`, { method: 'DELETE' })).status, 200);
  await waitFor(async () => (await fetch(`${base}/api/entities/ingest-srv`)).status === 404);
});

test('flux SSE : snapshot initial', async () => {
  const ctrl = new AbortController();
  const r = await fetch(`${base}/api/events`, { signal: ctrl.signal });
  assert.equal(r.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const reader = r.body.getReader();
  let text = '';
  while (!text.includes('event: snapshot')) {
    const { value } = await reader.read();
    text += Buffer.from(value).toString('utf8');
  }
  ctrl.abort();
  assert.ok(text.includes('event: snapshot'));
});

test('fichiers statiques et three.js servis localement', async () => {
  const idx = await fetch(`${base}/`);
  assert.equal(idx.status, 200);
  assert.match(await idx.text(), /SupervisionNG/);
  const three = await fetch(`${base}/vendor/three/build/three.module.js`, { method: 'HEAD' });
  assert.equal(three.status, 200);
  const addon = await fetch(`${base}/vendor/three/addons/controls/OrbitControls.js`, { method: 'HEAD' });
  assert.equal(addon.status, 200);
  const shared = await fetch(`${base}/shared/model.js`, { method: 'HEAD' });
  assert.equal(shared.status, 200);
  assert.equal((await fetch(`${base}/../package.json`)).status, 404);
  assert.equal((await fetch(`${base}/%2e%2e/package.json`)).status, 404);
});

test('démo de la refonte servie sur /refonte/ (hors ligne)', async () => {
  const r0 = await fetch(`${base}/refonte`, { redirect: 'manual' });
  assert.equal(r0.status, 301);
  assert.equal(r0.headers.get('location'), '/refonte/');
  const r1 = await fetch(`${base}/refonte/`);
  assert.equal(r1.status, 200);
  const html = await r1.text();
  assert.match(html, /sng:app/);
  assert.match(html, /\/vendor\/three\/build\/three\.module\.js/, 'three.js local, pas de CDN');
  for (const [p, type] of [['/refonte/js/main.js', 'text/javascript'], ['/refonte/js/world.js', 'text/javascript'], ['/refonte/fonts/IBMPlexSans.woff2', 'font/woff2'], ['/refonte/fonts/OFL.txt', 'text/plain']]) {
    const r = await fetch(`${base}${p}`);
    assert.equal(r.status, 200, p);
    assert.ok(r.headers.get('content-type').startsWith(type), p);
    await r.arrayBuffer();
  }
});
