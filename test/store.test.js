import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TopologyStore, normalizeSnapshot, evaluateMetric, DEFAULT_THRESHOLDS } from '../server/model/store.js';
import { buildKeys } from '../shared/model.js';

function store(opts = {}) {
  return new TopologyStore({ rebuildDelayMs: 0, ...opts });
}

function publish(s, src, snap, opts) {
  s.publish(src, snap, opts);
  clearTimeout(s.rebuildTimer);
  s.rebuildTimer = null;
  s.rebuild();
}

test('fusion inventaire + hyperviseur : le serveur physique est unique et garde l\'id d\'inventaire', () => {
  const s = store();
  publish(s, 'inventory', {
    entities: [
      { id: 'site', type: 'site', name: 'Site' },
      { id: 'rack1', type: 'rack', name: 'R1', parent: 'site' },
      { id: 'srv-hv01', type: 'server', name: 'SRV-HV01', parent: 'rack1', keys: buildKeys({ hostname: 'HV01', serial: 'CZ123' }), attrs: { u: 10 } },
    ],
  }, { priority: 100 });
  publish(s, 'hyperv', {
    entities: [
      { id: 'hv01/hw', type: 'server', name: 'HV01', keys: buildKeys({ hostname: 'hv01.corp.local', serial: 'cz123' }), attrs: { vendor: 'HPE', u: 99 }, metrics: { temp: 40 }, status: 'ok' },
      { id: 'hv01', type: 'hypervisor', name: 'HV01', parent: 'hv01/hw', keys: buildKeys({ hostname: 'HV01' }), status: 'ok' },
      { id: 'vm1', type: 'vm', name: 'web01', parent: 'hv01', keys: buildKeys({ uuid: 'AAAA-1', ip: '10.0.0.5' }), status: 'ok', metrics: { cpu: 20 } },
    ],
  });
  const servers = s.getEntities().filter((e) => e.type === 'server');
  assert.equal(servers.length, 1);
  const srv = servers[0];
  assert.equal(srv.id, 'srv-hv01');
  assert.equal(srv.parent, 'rack1');
  assert.equal(srv.attrs.vendor, 'HPE');
  assert.equal(srv.attrs.u, 10, 'l\'inventaire (priorite haute) l\'emporte');
  assert.deepEqual(srv.sources.sort(), ['hyperv', 'inventory']);
  // l'hyperviseur (classe differente) n'est PAS fusionne avec le serveur mais rattache a lui
  const hv = s.getEntity('hv01');
  assert.equal(hv.type, 'hypervisor');
  assert.equal(hv.parent, 'srv-hv01');
  assert.equal(s.getEntity('vm1').parent, 'hv01');
});

test('une VM vue par deux sources (uuid) ne fait qu\'une entite, statut = pire des deux', () => {
  const s = store();
  publish(s, 'vcenter', { entities: [{ id: 'vm-1', type: 'vm', name: 'SQL01', keys: ['uuid:1234'], status: 'ok', metrics: { cpu: 10 } }] });
  publish(s, 'windows', { entities: [{ id: 'windows:sql01', type: 'vm', name: 'SQL01', keys: ['uuid:1234', 'host:sql01'], status: 'warning', statusText: 'Service arrete', metrics: { disk: 50 } }] });
  const vms = s.getEntities();
  assert.equal(vms.length, 1);
  assert.equal(vms[0].status, 'warning');
  assert.equal(vms[0].statusText, 'Service arrete');
  assert.equal(vms[0].metrics.cpu, 10);
  assert.equal(vms[0].metrics.disk, 50);
});

test('seuils : une metrique au-dessus du seuil degrade le statut et cree une alarme', () => {
  const s = store();
  publish(s, 'x', { entities: [{ id: 'a', type: 'vm', name: 'A', status: 'ok', metrics: { cpu: 97.3 } }] });
  const a = s.getEntity('a');
  assert.equal(a.status, 'critical');
  assert.match(a.statusText, /CPU 97,3 %/);
  assert.equal(s.alarms.length, 1);
  assert.equal(s.alarms[0].entity, 'a');
  // pas d'alarme de seuil sur une VM arretee
  publish(s, 'x', { entities: [{ id: 'a', type: 'vm', name: 'A', status: 'off', metrics: { cpu: 99 } }] });
  assert.equal(s.getEntity('a').status, 'off');
  assert.equal(s.alarms.length, 0);
});

test('seuils par type : latence d\'une baie de stockage', () => {
  const r = evaluateMetric('latencyMs', 12, { ...DEFAULT_THRESHOLDS, byType: { storage: { latencyMs: { warning: 5, critical: 20 } } } }, 'storage');
  assert.equal(r.status, 'warning');
  assert.equal(evaluateMetric('latencyMs', 12, DEFAULT_THRESHOLDS, 'server'), null);
});

test('flux par IP : resolution vers la VM, sinon vers un reseau nomme, un externe ou Internet', () => {
  const s = store({ networks: [{ cidr: '10.50.0.0/16', name: 'Agence Lyon' }] });
  publish(s, 'inv', {
    entities: [{ id: 'ext-m365', type: 'external', name: 'Microsoft 365', attrs: { cidrs: ['52.96.0.0/14'] } }],
  }, { priority: 100 });
  publish(s, 'vc', { entities: [{ id: 'web', type: 'vm', name: 'web', keys: ['ip:10.0.0.5'] }] });
  publish(s, 'nf', {
    flows: [
      { src: { ip: '10.50.3.4' }, dst: { ip: '10.0.0.5' }, proto: 'tcp', port: 443, bps: 1000 },
      { src: { ip: '10.50.3.9' }, dst: { ip: '10.0.0.5' }, proto: 'tcp', port: 443, bps: 500 },
      { src: { ip: '10.0.0.5' }, dst: { ip: '52.97.1.1' }, proto: 'tcp', port: 443, bps: 10 },
      { src: { ip: '10.0.0.5' }, dst: { ip: '8.8.8.8' }, proto: 'udp', port: 53, bps: 5 },
      { src: { ip: '10.9.9.9' }, dst: { ip: '10.0.0.5' }, proto: 'tcp', port: 22 },
    ],
  });
  const flows = s.getTopology().flows;
  const agence = flows.find((f) => f.src === 'ext:net:agence-lyon');
  assert.ok(agence, 'flux agrege depuis le reseau nomme');
  assert.equal(agence.dst, 'web');
  assert.equal(agence.bps, 1500, 'les deux flux sont agreges');
  assert.equal(agence.app, 'https');
  assert.equal(agence.category, 'web');
  assert.ok(flows.find((f) => f.dst === 'ext-m365'));
  assert.ok(flows.find((f) => f.dst === 'ext:internet' && f.port === 53));
  assert.ok(flows.find((f) => f.src === 'ext:lan'));
  assert.ok(s.getEntity('ext:internet'));
});

test('liens : un meme cable vu des deux cotes (LLDP) est dedoublonne', () => {
  const s = store();
  publish(s, 'inv', {
    entities: [{ id: 'sw1', type: 'switch', name: 'SW1' }, { id: 'srv1', type: 'server', name: 'SRV1' }],
    links: [{ a: 'sw1', aPort: 'Gi1/0/1', b: 'srv1', bPort: 'eth0', speedBps: 1e9 }],
  }, { priority: 100 });
  publish(s, 'snmp', {
    links: [{ a: 'srv1', aPort: 'eth0', b: 'sw1', bPort: 'Gi1/0/1', status: 'ok', metrics: { util: 80 } }],
  });
  const links = s.getTopology().links;
  assert.equal(links.length, 1);
  assert.equal(links[0].metrics.util, 80);
  assert.equal(links[0].status, 'warning', 'utilisation > seuil');
  assert.equal(s.alarms.length, 1);
});

test('donnees obsoletes : statut inconnu quand la source ne publie plus', () => {
  const s = store();
  s.publish('vc', { entities: [{ id: 'vm', type: 'vm', name: 'vm', status: 'ok', metrics: { cpu: 5 } }] }, { staleAfterMs: 1000 });
  clearTimeout(s.rebuildTimer);
  s.rebuildTimer = null;
  s.rebuild(Date.now() + 5000);
  const vm = s.getEntity('vm');
  assert.equal(vm.status, 'unknown');
  assert.ok(vm.stale);
  assert.deepEqual(vm.metrics, {});
});

test('deltas : seules les entites modifiees sont emises, suppression signalee', () => {
  const s = store();
  const deltas = [];
  s.on('delta', (d) => deltas.push(d));
  publish(s, 'a', { entities: [{ id: 'x', type: 'vm', name: 'x' }, { id: 'y', type: 'vm', name: 'y' }] });
  publish(s, 'a', { entities: [{ id: 'x', type: 'vm', name: 'x' }, { id: 'y', type: 'vm', name: 'y2' }] });
  publish(s, 'a', { entities: [{ id: 'x', type: 'vm', name: 'x' }] });
  assert.equal(deltas.length, 3);
  assert.equal(deltas[1].entities.set.length, 1);
  assert.equal(deltas[1].entities.set[0].name, 'y2');
  assert.deepEqual(deltas[2].entities.del, ['y']);
  assert.equal(deltas[2].version, 3);
});

test('acquittement d\'alarme', () => {
  const s = store();
  publish(s, 'a', { entities: [{ id: 'x', type: 'vm', name: 'x', status: 'critical', statusText: 'panne' }] });
  const id = s.alarms[0].id;
  s.acknowledge(id);
  clearTimeout(s.rebuildTimer);
  s.rebuildTimer = null;
  s.rebuild();
  assert.equal(s.alarms[0].acked, true);
});

test('protection contre les cycles de parents', () => {
  const s = store();
  publish(s, 'a', { entities: [{ id: 'p', type: 'server', name: 'p', parent: 'q' }, { id: 'q', type: 'server', name: 'q', parent: 'p' }] });
  const p = s.getEntity('p');
  const q = s.getEntity('q');
  assert.ok(!(p.parent === 'q' && q.parent === 'p'));
});

test('normalizeSnapshot : types inconnus, ip en cle de recherche, metriques numeriques', () => {
  const n = normalizeSnapshot({ entities: [{ id: 1, type: 'toaster', attrs: { ip: ['10.1.1.1'] }, metrics: { cpu: '12.345', bad: 'x' } }] });
  assert.equal(n.entities[0].id, '1');
  assert.equal(n.entities[0].type, 'appliance');
  assert.deepEqual(n.entities[0].keys, ['ip:10.1.1.1']);
  assert.deepEqual(n.entities[0].metrics, { cpu: 12.35 });
});
