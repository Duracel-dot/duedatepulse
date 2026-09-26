import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonc } from '../server/util/jsonc.js';
import { inventoryToSnapshot } from '../server/model/inventory.js';
import { buildIndex, flowPath, physicalAnchor } from '../shared/graph.js';
import { buildKeys, hostKey, serialKey, macKey, parseCidr, cidrContains, parseSpeed, flowCategory, worstStatus } from '../shared/model.js';
import { buildDemoWorld } from '../server/collectors/demo-world.js';
import { parsePowerShellJson, asArray, psDate, powershellEnv } from '../server/util/powershell.js';

test('JSONC : commentaires et virgules finales, sans toucher aux chaines', () => {
  const o = parseJsonc(`{
    // commentaire
    "url": "https://x/y", /* bloc */
    "s": "a // pas un commentaire, ni /* ceci */",
    "list": [1, 2, ],
  }`);
  assert.equal(o.url, 'https://x/y');
  assert.equal(o.s, 'a // pas un commentaire, ni /* ceci */');
  assert.deepEqual(o.list, [1, 2]);
  assert.throws(() => parseJsonc('{ "a": }', 'x.json'), /x\.json/);
});

test('cles de correlation normalisees', () => {
  assert.equal(hostKey('HV01.corp.local'), 'host:hv01');
  assert.equal(hostKey('10.0.0.1'), null);
  assert.equal(serialKey('To be filled by O.E.M.'), null);
  assert.equal(serialKey(' cz123 '), 'serial:CZ123');
  assert.equal(macKey('00-15-5D-01-02-03'), 'mac:00:15:5d:01:02:03');
  assert.equal(macKey('00:00:00:00:00:00'), null);
  const keys = buildKeys({ hostname: 'srv.corp.local', ip: ['127.0.0.1', '10.1.1.1'] });
  assert.deepEqual(keys.sort(), ['fqdn:srv.corp.local', 'host:srv', 'ip:10.1.1.1']);
});

test('CIDR, debits, categories, statuts', () => {
  const c = parseCidr('10.20.0.0/16');
  assert.ok(cidrContains(c, '10.20.5.1'));
  assert.ok(!cidrContains(c, '10.21.0.1'));
  assert.equal(parseSpeed('10G'), 1e10);
  assert.equal(parseSpeed('100M'), 1e8);
  assert.equal(flowCategory(null, 1433), 'database');
  assert.equal(flowCategory('vmotion'), 'replication');
  assert.equal(worstStatus('ok', 'critical'), 'critical');
  assert.equal(worstStatus('warning', 'off'), 'warning');
});

test('inventaire : hierarchie, positions U, avertissements', () => {
  const { snapshot, warnings, networks } = inventoryToSnapshot({
    sites: [{ id: 's', name: 'S', rooms: [{ id: 'r', name: 'R', rows: [{ name: 'A', racks: [{ id: 'A01', devices: [
      { id: 'sw', type: 'switch', u: 42, hostname: 'sw1', ip: '10.0.0.1' },
      { id: 'srv', type: 'server', u: 41, height: 2, serial: 'X1' },
      { id: 'srv2', type: 'server', u: 10 },
    ] }] }] }] }],
    externals: [{ id: 'inet', name: 'Internet', kind: 'internet', default: 'internet' }],
    links: [{ a: 'sw', aPort: 'Gi1', b: 'srv', speed: '10G' }],
    networks: [{ cidr: '10.9.0.0/16', name: 'Agence' }],
  });
  const byId = Object.fromEntries(snapshot.entities.map((e) => [e.id, e]));
  assert.equal(byId.A01.parent, 'r');
  assert.equal(byId.sw.parent, 'A01');
  assert.ok(byId.sw.keys.includes('host:sw1'));
  assert.equal(byId.srv2.attrs.height, 2);
  assert.equal(snapshot.links[0].speedBps, 1e10);
  assert.equal(networks.length, 1);
  assert.ok(warnings.some((w) => /srv chevauche sw/.test(w)), 'srv en U41-42 chevauche le switch en U42');
});

test('graphe : ancre physique et chemin de bout en bout d\'un flux', () => {
  const entities = [
    { id: 'srvA', type: 'server', cls: 'physical' }, { id: 'srvB', type: 'server', cls: 'physical' },
    { id: 'tor1', type: 'switch', cls: 'physical' }, { id: 'tor2', type: 'switch', cls: 'physical' }, { id: 'core', type: 'switch', cls: 'physical' },
    { id: 'hvA', type: 'hypervisor', cls: 'hypervisor', parent: 'srvA' }, { id: 'hvB', type: 'hypervisor', cls: 'hypervisor', parent: 'srvB' },
    { id: 'vmA', type: 'vm', cls: 'vm', parent: 'hvA' }, { id: 'vmB', type: 'vm', cls: 'vm', parent: 'hvB' },
  ];
  const links = [
    { id: 'l1', a: 'tor1', b: 'srvA', status: 'ok' }, { id: 'l2', a: 'tor2', b: 'srvB', status: 'ok' },
    { id: 'l3', a: 'tor1', b: 'core', status: 'ok' }, { id: 'l4', a: 'tor2', b: 'core', status: 'ok' },
    { id: 'l5', a: 'tor1', b: 'srvB', status: 'critical' },
  ];
  const idx = buildIndex(entities, links);
  assert.equal(physicalAnchor('vmA', idx.byId), 'srvA');
  const p = flowPath({ src: 'vmA', dst: 'vmB' }, idx);
  assert.ok(p.complete);
  assert.deepEqual(p.entities, ['vmA', 'hvA', 'srvA', 'tor1', 'core', 'tor2', 'srvB', 'hvB', 'vmB']);
  assert.deepEqual(p.links.map((l) => l.id), ['l1', 'l3', 'l4', 'l2'], 'le lien coupe l5 est evite');
});

test('demo : monde coherent (liens, positions U sans chevauchement, VM placees)', () => {
  const w = buildDemoWorld();
  const { snapshot, warnings } = inventoryToSnapshot(w.inventory);
  assert.deepEqual(warnings, []);
  const ids = new Set(snapshot.entities.map((e) => e.id));
  for (const l of snapshot.links) {
    assert.ok(ids.has(l.a), `extremite inconnue ${l.a}`);
    assert.ok(ids.has(l.b), `extremite inconnue ${l.b}`);
  }
  assert.ok(w.vms.length > 100);
  for (const vm of w.vms) assert.ok(w.hosts.find((h) => h.id === vm.host));
});

test('PowerShell : extraction du JSON et normalisations 5.1', () => {
  assert.deepEqual(parsePowerShellJson('﻿{"a":1}'), { a: 1 });
  assert.deepEqual(parsePowerShellJson('AVERTISSEMENT : module\r\n[{"a":1}]\r\n'), [{ a: 1 }]);
  assert.deepEqual(asArray({ a: 1 }), [{ a: 1 }]);
  assert.deepEqual(asArray(null), []);
  assert.equal(psDate('/Date(1700000000000)/').getTime(), 1700000000000);
});

test('PowerShell 5.1 : chemins de modules de PowerShell 7 retires de PSModulePath', () => {
  const base = { PSModulePath: 'C:\\Users\\x\\Documents\\PowerShell\\Modules;C:\\Program Files\\PowerShell\\Modules;c:\\program files\\powershell\\7\\Modules;C:\\Program Files\\WindowsPowerShell\\Modules;C:\\Windows\\system32\\WindowsPowerShell\\v1.0\\Modules;D:\\Modules' };
  assert.equal(powershellEnv('powershell.exe', base).PSModulePath,
    'C:\\Program Files\\WindowsPowerShell\\Modules;C:\\Windows\\system32\\WindowsPowerShell\\v1.0\\Modules;D:\\Modules');
  assert.equal(powershellEnv('pwsh.exe', base).PSModulePath, base.PSModulePath, 'PowerShell 7 : inchange');
  assert.equal(powershellEnv('powershell.exe', { PSModulePath: 'C:\\Program Files\\PowerShell\\7\\Modules' }).PSModulePath, undefined);
});
