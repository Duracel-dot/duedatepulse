// Tests du collecteur Windows (conversion JSON PowerShell -> snapshot, sans PowerShell).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import create, {
  windowsToSnapshot, aggregateConnections, isVirtualMachine, serialForKey, targetSlug, isLocalTarget,
  normalizeTargets, runTargetsInParallel, tcpProbe, precheckTargets, WindowsCollector,
} from '../server/collectors/windows.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = () => JSON.parse(fs.readFileSync(path.join(here, 'fixtures/windows-sample.json'), 'utf8'));
const silent = { debug() {}, info() {}, warn() {}, error() {}, child() { return silent; } };
const makeCtx = () => ({ logger: silent, publish() {}, store: { getEntities: () => [] } });
const byId = (snap, id) => snap.entities.find((e) => e.id === id);

test('windows : serveur physique (sortie PS 5.1, singletons deballes, /Date()/)', () => {
  const snap = windowsToSnapshot(fixture(), { localName: 'SUPERV01', diskWarnPct: 90 });
  const e = byId(snap, 'windows:srv-sql01');
  assert.ok(e, 'entite srv-sql01 absente');
  assert.equal(e.type, 'server');
  assert.equal(e.name, 'SRV-SQL01');
  assert.deepEqual([...e.keys].sort(), [
    'fqdn:srv-sql01.corp.local',
    'host:srv-sql01',
    'ip:10.10.20.15',
    'mac:24:6e:96:12:34:56',
    'serial:7XK2Q53',
    'uuid:4c4c4544-0058-4b10-8032-b7c04f513533',
  ]);
  assert.equal(e.attrs.os, 'Microsoft Windows Server 2019 Standard');
  assert.equal(e.attrs.vendor, 'Dell Inc.');
  assert.equal(e.attrs.model, 'PowerEdge R740');
  assert.equal(e.attrs.serial, '7XK2Q53');
  assert.equal(e.attrs.cpuCores, 32);
  assert.equal(e.attrs.memGB, 255.9);
  assert.equal(e.attrs.domain, 'corp.local');
  assert.deepEqual(e.attrs.ip, ['10.10.20.15']);
  assert.deepEqual(e.attrs.mac, ['24:6e:96:12:34:56']);
  assert.equal(e.attrs.lastBoot, new Date(1757000000000).toISOString());
  assert.deepEqual(e.attrs.stoppedServices, ['SQLSERVERAGENT']);
  assert.deepEqual(e.attrs.disks.map((d) => d.id), ['C:', 'D:']);
  assert.deepEqual(e.attrs.disks[0], { id: 'C:', label: 'Système', sizeGB: 199.5, freeGB: 90, usedPct: 54.9 });
  assert.deepEqual(e.metrics, { cpu: 37, mem: 80, disk: 95, uptimeS: 1234567 });
  assert.equal(e.status, 'warning');
  assert.match(e.statusText, /SQL Server Agent \(MSSQLSERVER\)/);
  assert.match(e.statusText, /D: 95 %/);
  // par defaut, l'alerte disque est laissee aux seuils du magasin (pas de doublon)
  const def = byId(windowsToSnapshot(fixture(), { localName: 'SUPERV01' }), 'windows:srv-sql01');
  assert.doesNotMatch(def.statusText, /Disque presque plein/);
});

test('windows : VM Hyper-V (serie Hyper-V conservee, dates ISO PS 7)', () => {
  const snap = windowsToSnapshot(fixture(), { localName: 'SUPERV01' });
  const e = byId(snap, 'windows:srv-web01');
  assert.ok(e);
  assert.equal(e.type, 'vm');
  assert.equal(e.status, 'ok');
  assert.equal(e.statusText, undefined);
  assert.ok(e.keys.includes('uuid:d5b6f8e2-1c3a-4e5b-9a7d-2f4e6c8a0b1d'));
  assert.ok(e.keys.includes('serial:5175-2891-3316-8812-9460-3517-24'));
  assert.ok(e.keys.includes('mac:00:15:5d:0a:1b:01'));
  assert.ok(e.keys.includes('fqdn:srv-web01.corp.local'));
  assert.equal(e.attrs.lastBoot, '2025-09-20T04:12:45.500Z');
  assert.equal(e.metrics.mem, 75);
  assert.equal(e.metrics.cpu, 12.5);
  assert.equal(e.metrics.disk, 40);
});

test('windows : cible injoignable -> entite critique minimale', () => {
  const snap = windowsToSnapshot(fixture(), { localName: 'SUPERV01' });
  const e = byId(snap, 'windows:srv-old01');
  assert.deepEqual(e.keys, ['host:srv-old01']);
  assert.equal(e.type, 'server');
  assert.equal(e.status, 'critical');
  assert.match(e.statusText, /^Injoignable : WinRM ne peut pas terminer l'opération/);
  assert.equal(e.metrics, undefined);
  assert.equal(snap.entities.length, 3);
  assert.deepEqual(snap.links, []);
});

test('windows : cache des cibles connues (type et cles conserves si injoignable)', () => {
  const known = new Map();
  windowsToSnapshot(fixture(), { known, localName: 'SUPERV01' });
  const down = windowsToSnapshot({ targets: [{ name: 'srv-web01.corp.local', ok: false, error: 'delai depasse' }] },
    { known, localName: 'SUPERV01' });
  const e = down.entities[0];
  assert.equal(e.id, 'windows:srv-web01');
  assert.equal(e.type, 'vm');
  assert.equal(e.name, 'SRV-WEB01');
  assert.ok(e.keys.includes('uuid:d5b6f8e2-1c3a-4e5b-9a7d-2f4e6c8a0b1d'));
  assert.equal(e.status, 'critical');
});

test('windows : cible locale -> identifiant = nom de la machine', () => {
  assert.equal(isLocalTarget('localhost', 'SUPERV01'), true);
  assert.equal(isLocalTarget('.', 'SUPERV01'), true);
  assert.equal(isLocalTarget('superv01.corp.local', 'SUPERV01'), true);
  assert.equal(isLocalTarget('srv-ad01', 'SUPERV01'), false);
  assert.equal(targetSlug('localhost', 'SUPERV01'), 'superv01');
  assert.equal(targetSlug('SRV-AD01.corp.local', 'SUPERV01'), 'srv-ad01');
  assert.equal(targetSlug('10.0.0.5', 'SUPERV01'), '10.0.0.5');
  assert.deepEqual(normalizeTargets(['localhost', 'SUPERV01', ' srv-ad01 ', '', null, 'SRV-AD01.corp.local'], 'SUPERV01'),
    ['localhost', 'srv-ad01']);
  const snap = windowsToSnapshot({ targets: [{ name: 'localhost', ok: false, error: 'x' }] }, { localName: 'SUPERV01' });
  assert.equal(snap.entities[0].id, 'windows:superv01');
  assert.equal(snap.entities[0].name, 'SUPERV01');
  assert.deepEqual(snap.entities[0].keys, ['host:superv01']);
  const ipSnap = windowsToSnapshot({ targets: [{ name: '10.0.0.9', ok: false, error: 'x' }] }, { localName: 'SUPERV01' });
  assert.deepEqual(ipSnap.entities[0].keys, ['ip:10.0.0.9']);
});

test('windows : flux agreges par (client, serveur, port) et fusionnes entre machines', () => {
  const snap = windowsToSnapshot(fixture(), { localName: 'SUPERV01' });
  const find = (src, dst, port) => snap.flows.find((f) => f.src.ip === src && f.dst.ip === dst && f.port === port);
  assert.equal(snap.flows.length, 6);

  const sql = find('10.10.30.21', '10.10.20.15', 1433);
  assert.deepEqual(sql, {
    src: { ip: '10.10.30.21' }, dst: { ip: '10.10.20.15' }, proto: 'tcp', port: 1433, app: 'mssql',
    bps: null, conns: 3, process: 'sqlservr', clientProcess: 'w3wp',
  });
  assert.equal(snap.flows[0], sql, 'tri par nombre de connexions');

  assert.equal(find('10.10.99.5', '10.10.20.15', 3389).process, 'svchost');
  const ldap = find('10.10.20.15', '10.10.10.10', 389);
  assert.equal(ldap.app, 'ldap');
  assert.equal(ldap.process, null);
  assert.equal(ldap.clientProcess, 'lsass');
  assert.equal(find('10.10.20.15', '10.10.40.5', 445).app, 'smb');
  assert.equal(find('203.0.113.50', '10.10.30.21', 443).conns, 2);
  // client Linux (port source < 49152) : entrant grace a la liste des ports en ecoute
  assert.equal(find('198.51.100.7', '10.10.30.21', 443).conns, 1);
});

test('windows : sens des connexions sans liste d\'ecoute, bouclage exclu', () => {
  const flows = aggregateConnections([
    { LocalAddress: '10.0.0.1', LocalPort: 8080, RemoteAddress: '10.0.0.2', RemotePort: 50123, Process: 'java.exe' },
    { LocalAddress: '10.0.0.1', LocalPort: 50999, RemoteAddress: '10.0.0.3', RemotePort: 5432, Process: 'java.exe' },
    { LocalAddress: '127.0.0.1', LocalPort: 5000, RemoteAddress: '127.0.0.1', RemotePort: 50001 },
    { LocalAddress: '::1', LocalPort: 5000, RemoteAddress: '::1', RemotePort: 50002 },
    { LocalAddress: '10.0.0.1', LocalPort: 445, RemoteAddress: '10.0.0.1', RemotePort: 50003 },
    null,
  ], null);
  assert.equal(flows.length, 2);
  const inbound = flows.find((f) => f.port === 8080);
  assert.deepEqual(inbound.src, { ip: '10.0.0.2' });
  assert.deepEqual(inbound.dst, { ip: '10.0.0.1' });
  assert.equal(inbound.app, 'http-alt');
  assert.equal(inbound.process, 'java');
  const outbound = flows.find((f) => f.port === 5432);
  assert.deepEqual(outbound.src, { ip: '10.0.0.1' });
  assert.equal(outbound.app, 'postgresql');
  assert.equal(outbound.clientProcess, 'java');
  // port de service inconnu : app = processus serveur
  const custom = aggregateConnections([
    { LocalAddress: '10.0.0.1', LocalPort: 7777, RemoteAddress: '10.0.0.2', RemotePort: 50000, Process: 'monappli.exe' },
  ], [7777]);
  assert.equal(custom[0].app, 'monappli');
});

test('windows : detection des machines virtuelles', () => {
  assert.equal(isVirtualMachine('Microsoft Corporation', 'Virtual Machine'), true);
  assert.equal(isVirtualMachine('Microsoft Corporation', 'Surface Pro 7'), false);
  assert.equal(isVirtualMachine('VMware, Inc.', 'VMware7,1'), true);
  assert.equal(isVirtualMachine('innotek GmbH', 'VirtualBox'), true);
  assert.equal(isVirtualMachine('QEMU', 'Standard PC (Q35 + ICH9, 2009)'), true);
  assert.equal(isVirtualMachine('Red Hat', 'KVM'), true);
  assert.equal(isVirtualMachine('Xen', 'HVM domU'), true);
  assert.equal(isVirtualMachine('Proxmox', 'VM'), true);
  assert.equal(isVirtualMachine('Dell Inc.', 'PowerEdge R740'), false);
  assert.equal(isVirtualMachine('HPE', 'ProLiant DL380 Gen10'), false);
  assert.equal(isVirtualMachine(null, undefined), false);
});

test('windows : numero de serie utilise comme cle', () => {
  assert.equal(serialForKey('VMware-42 1a 2b 3c 4d 5e 6f 70-81 92 a3 b4 c5 d6 e7 f8', true),
    'VMware-42 1a 2b 3c 4d 5e 6f 70-81 92 a3 b4 c5 d6 e7 f8');
  assert.equal(serialForKey('5175-2891-3316-8812-9460-3517-24', true), '5175-2891-3316-8812-9460-3517-24');
  assert.equal(serialForKey('0', true), null);
  assert.equal(serialForKey('Not Specified', true), null);
  assert.equal(serialForKey('7XK2Q53', false), '7XK2Q53');
  assert.equal(serialForKey('  ', false), null);
});

test('windows : repartition des cibles sur plusieurs processus PowerShell', async () => {
  const calls = [];
  const runner = async (script, params, opts) => {
    calls.push({ script, targets: params.targets, opts });
    return { targets: params.targets.filter((t) => t !== 'srv-c').map((name) => ({ name, ok: true })) };
  };
  const data = await runTargetsInParallel({
    script: 'windows.ps1', targets: ['srv-a', 'srv-b', 'srv-c'], concurrency: 2, timeoutMs: 1000, runner,
    credential: { username: 'u', password: 'p' },
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.targets), [['srv-a', 'srv-c'], ['srv-b']]);
  assert.deepEqual(calls[0].opts, { timeoutMs: 1000, credential: { username: 'u', password: 'p' } });
  assert.equal(data.targets.length, 3);
  const c = data.targets.find((t) => t.name === 'srv-c');
  assert.equal(c.ok, false);
  assert.equal(c.procError, true);
});

test('windows : collecteur (PowerShell simule)', async () => {
  const col = create({ type: 'windows', name: 'win', targets: ['srv-sql01', 'srv-web01.corp.local', 'srv-old01'], flows: true }, makeCtx());
  assert.ok(col instanceof WindowsCollector);
  assert.equal(col.intervalMs, 60000);
  let params;
  col.probe = async () => ({ ok: true });
  col.runner = async (script, p) => {
    assert.equal(script, 'windows.ps1');
    params = p;
    const all = fixture().targets;
    return { targets: all.filter((t) => p.targets.includes(t.name)) };
  };
  const snap = await col.poll();
  assert.equal(params.flows, true);
  assert.equal(snap.entities.length, 3);
  assert.equal(snap.flows.length, 6);
  assert.equal(col.known.size, 2);
});

test('windows : PowerShell indisponible -> erreur de collecte (pas 100 % de cibles critiques)', async () => {
  const col = create({ type: 'windows', targets: ['a', 'b'], precheck: false }, makeCtx());
  col.runner = async () => { throw new Error('PowerShell introuvable (powershell.exe ou pwsh requis)'); };
  await assert.rejects(() => col.poll(), /PowerShell introuvable/);

  // delai depasse : imputable aux cibles -> publiees critiques
  col.runner = async () => { throw new Error('windows.ps1 : delai depasse (115000 ms)'); };
  const snap = await col.poll();
  assert.equal(snap.entities.length, 2);
  assert.ok(snap.entities.every((e) => e.status === 'critical'));
});

test('windows : aucune cible -> snapshot vide', async () => {
  const col = create({ type: 'windows', targets: [] }, makeCtx());
  col.runner = async () => { throw new Error('ne doit pas etre appele'); };
  assert.deepEqual(await col.poll(), { entities: [], links: [], flows: [] });
});

test('windows : pre-test TCP du port WinRM', async () => {
  const server = net.createServer((sock) => sock.destroy());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    assert.deepEqual(await tcpProbe('127.0.0.1', port, 2000), { ok: true });
  } finally {
    await new Promise((r) => server.close(r));
  }
  const closed = await tcpProbe('127.0.0.1', port, 2000);
  assert.equal(closed.ok, false);
  assert.equal(closed.error, 'ECONNREFUSED');

  const probed = [];
  const { alive, down } = await precheckTargets(['localhost', 'srv-a', 'srv-b'], {
    localName: 'SUPERV01', port: 5985,
    probe: async (host, p) => { probed.push(`${host}:${p}`); return host === 'srv-b' ? { ok: false, error: 'ETIMEDOUT' } : { ok: true }; },
  });
  assert.deepEqual(probed, ['srv-a:5985', 'srv-b:5985'], 'la cible locale n\'est pas testee');
  assert.deepEqual(alive, ['localhost', 'srv-a']);
  assert.deepEqual(down, [{ name: 'srv-b', ok: false, error: 'WinRM (port 5985) : pas de reponse' }]);
});

test('windows : cible eteinte ecartee avant PowerShell, ordre des cibles conserve', async () => {
  const col = create({ type: 'windows', targets: ['srv-old01', 'srv-sql01'], winrmPort: 5986 }, makeCtx());
  col.probe = async (host, port) => {
    assert.equal(port, 5986);
    return host === 'srv-old01' ? { ok: false, error: 'EHOSTUNREACH' } : { ok: true };
  };
  const sent = [];
  col.runner = async (script, p) => {
    assert.equal(p.port, 5986);
    sent.push(...p.targets);
    return { targets: fixture().targets.filter((t) => p.targets.includes(t.name)) };
  };
  const snap = await col.poll();
  assert.deepEqual(sent, ['srv-sql01']);
  assert.deepEqual(snap.entities.map((e) => [e.id, e.status]), [
    ['windows:srv-old01', 'critical'],
    ['windows:srv-sql01', 'warning'],
  ]);
  assert.equal(snap.entities[0].statusText, 'Injoignable : WinRM (port 5986) : hote inaccessible');

  // toutes les cibles eteintes : publiees critiques, PowerShell non lance
  col.probe = async () => ({ ok: false, error: 'ETIMEDOUT' });
  col.runner = async () => { throw new Error('ne doit pas etre appele'); };
  const all = await col.poll();
  assert.ok(all.entities.every((e) => e.status === 'critical'));

  // HTTPS : port 5986 par defaut pour le pre-test, options transmises au script
  const ssl = create({ type: 'windows', targets: ['srv-sql01'], useSsl: true }, makeCtx());
  ssl.probe = async (host, port) => { assert.equal(port, 5986); return { ok: true }; };
  ssl.runner = async (script, p) => {
    assert.equal(p.useSsl, true);
    assert.equal(p.port, undefined);
    return { targets: fixture().targets.filter((t) => p.targets.includes(t.name)) };
  };
  assert.equal((await ssl.poll()).entities.length, 1);

  // protocole DCOM : pas de pre-test WinRM
  const dcom = create({ type: 'windows', targets: ['srv-sql01'], protocol: 'dcom' }, makeCtx());
  dcom.probe = async () => { throw new Error('ne doit pas etre appele'); };
  dcom.runner = async (script, p) => {
    assert.equal(p.protocol, 'dcom');
    return { targets: fixture().targets.filter((t) => p.targets.includes(t.name)) };
  };
  assert.equal((await dcom.poll()).entities.length, 1);
});
