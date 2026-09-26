// Tests du collecteur ping (analyse de sortie multilingue, choix des cibles, snapshot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import create, {
  parsePingOutput, pingArgs, selectTargets, normalizeExplicitTargets, pingSnapshot, PingCollector,
} from '../server/collectors/ping.js';

const silent = { debug() {}, info() {}, warn() {}, error() {}, child() { return silent; } };

const WIN_FR_OK = [
  '',
  'Envoi d\'une requête \'Ping\'  10.0.0.1 avec 32 octets de données :',
  'Réponse de 10.0.0.1 : octets=32 temps=3 ms TTL=64',
  '',
  'Statistiques Ping pour 10.0.0.1:',
  '    Paquets : envoyés = 1, reçus = 1, perdus = 0 (perte 0%),',
  'Durée approximative des boucles en millisecondes :',
  '    Minimum = 3ms, Maximum = 3ms, Moyenne = 3ms',
].join('\r\n');

const WIN_FR_FAST = 'Réponse de 10.0.0.2 : octets=32 temps<1ms TTL=128\r\n';
const WIN_EN_OK = 'Pinging 10.0.0.3 with 32 bytes of data:\r\nReply from 10.0.0.3: bytes=32 time=12ms TTL=127\r\n' +
  '\r\nPing statistics for 10.0.0.3:\r\n    Packets: Sent = 1, Received = 1, Lost = 0 (0% loss),\r\n' +
  'Approximate round trip times in milli-seconds:\r\n    Minimum = 12ms, Maximum = 12ms, Average = 12ms\r\n';
const WIN_DE_OK = 'Antwort von 10.0.0.4: Bytes=32 Zeit=5ms TTL=64\r\n';
// Windows peut sortir en code 0 sur "hote injoignable" (reponse ICMP d'un routeur)
const WIN_FR_UNREACHABLE = 'Réponse de 10.0.0.254 : Impossible de joindre l\'hôte de destination.\r\n' +
  '    Paquets : envoyés = 1, reçus = 1, perdus = 0 (perte 0%),\r\n';
const WIN_EN_UNREACHABLE = 'Reply from 10.0.0.254: Destination host unreachable.\r\n' +
  '    Packets: Sent = 1, Received = 1, Lost = 0 (0% loss),\r\n';
const WIN_FR_TIMEOUT = 'Délai d\'attente de la demande dépassé.\r\n    Paquets : envoyés = 1, reçus = 0, perdus = 1 (perte 100%),\r\n';
const LINUX_OK = 'PING 10.0.0.5 (10.0.0.5) 56(84) bytes of data.\n64 bytes from 10.0.0.5: icmp_seq=1 ttl=64 time=0.412 ms\n\n' +
  '--- 10.0.0.5 ping statistics ---\n1 packets transmitted, 1 received, 0% packet loss, time 0ms\n' +
  'rtt min/avg/max/mdev = 0.412/0.412/0.412/0.000 ms\n';
const LINUX_KO = 'PING 10.0.0.6 (10.0.0.6) 56(84) bytes of data.\n\n--- 10.0.0.6 ping statistics ---\n' +
  '1 packets transmitted, 0 received, 100% packet loss, time 0ms\n';

test('ping : analyse de sortie Windows (FR / EN / DE)', () => {
  assert.deepEqual(parsePingOutput(WIN_FR_OK, 0, 'win32'), { reachable: true, latencyMs: 3 });
  assert.deepEqual(parsePingOutput(WIN_FR_FAST, 0, 'win32'), { reachable: true, latencyMs: 1 });
  assert.deepEqual(parsePingOutput(WIN_EN_OK, 0, 'win32'), { reachable: true, latencyMs: 12 });
  assert.deepEqual(parsePingOutput(WIN_DE_OK, 0, 'win32'), { reachable: true, latencyMs: 5 });
});

test('ping : Windows "hote injoignable" avec code 0 = injoignable', () => {
  assert.deepEqual(parsePingOutput(WIN_FR_UNREACHABLE, 0, 'win32'), { reachable: false, latencyMs: null });
  assert.deepEqual(parsePingOutput(WIN_EN_UNREACHABLE, 0, 'win32'), { reachable: false, latencyMs: null });
  assert.deepEqual(parsePingOutput(WIN_FR_TIMEOUT, 1, 'win32'), { reachable: false, latencyMs: null });
  assert.deepEqual(parsePingOutput(WIN_FR_OK, 1, 'win32'), { reachable: false, latencyMs: null });
  assert.deepEqual(parsePingOutput('', 0, 'win32'), { reachable: false, latencyMs: null });
});

test('ping : analyse de sortie Linux', () => {
  assert.deepEqual(parsePingOutput(LINUX_OK, 0, 'linux'), { reachable: true, latencyMs: 0.412 });
  assert.deepEqual(parsePingOutput(LINUX_KO, 1, 'linux'), { reachable: false, latencyMs: null });
  assert.deepEqual(parsePingOutput(null, 2, 'linux'), { reachable: false, latencyMs: null });
});

test('ping : arguments selon la plateforme', () => {
  assert.deepEqual(pingArgs('10.0.0.1', 1000, 'win32'), ['-n', '1', '-w', '1000', '10.0.0.1']);
  assert.deepEqual(pingArgs('10.0.0.1', 1500, 'linux'), ['-c', '1', '-W', '2', '10.0.0.1']);
  assert.deepEqual(pingArgs('10.0.0.1', 300, 'linux'), ['-c', '1', '-W', '1', '10.0.0.1']);
  assert.deepEqual(pingArgs('10.0.0.1', 800, 'darwin'), ['-c', '1', '-W', '800', '10.0.0.1']);
});

const ENTITIES = [
  { id: 'srv-a', type: 'server', cls: 'physical', name: 'SRV-A', keys: ['host:srv-a', 'ip:10.0.0.10'], status: 'ok', sources: ['windows'] },
  { id: 'vm-b', type: 'vm', cls: 'vm', name: 'VM-B', keys: ['uuid:x', 'ip:10.0.0.11', 'ip:10.0.0.12'], status: 'warning', sources: ['hyperv', 'ping'] },
  { id: 'vm-off', type: 'vm', cls: 'vm', name: 'VM-OFF', keys: ['ip:10.0.0.13'], status: 'off', sources: ['hyperv'] },
  { id: 'self', type: 'external', cls: 'external', name: '10.0.0.99', keys: ['ip:10.0.0.99'], status: 'critical', sources: ['ping'] },
  { id: 'only-ping', type: 'server', cls: 'physical', name: 'X', keys: ['ip:10.0.0.98'], status: 'ok', sources: [{ id: 'ping' }] },
  { id: 'inet', type: 'external', cls: 'external', name: 'Internet', keys: ['ip:8.8.8.8'], status: 'ok', sources: ['netflow'] },
  { id: 'noip', type: 'rack', cls: 'physical', name: 'R1', keys: [], status: 'ok', sources: ['inventory'] },
  { id: 'v6', type: 'server', cls: 'physical', name: 'V6', keys: ['ip:2001:db8::1'], status: 'ok', sources: ['snmp'] },
];

test('ping : choix des cibles automatiques (jamais une entite entretenue par le ping seul)', () => {
  const targets = selectTargets(ENTITIES, { sourceId: 'ping' });
  assert.deepEqual(targets, [
    { ip: '10.0.0.10', entities: [{ id: 'srv-a', type: 'server', name: 'SRV-A' }], name: null },
    { ip: '10.0.0.11', entities: [{ id: 'vm-b', type: 'vm', name: 'VM-B' }], name: null },
  ]);
  assert.equal(selectTargets(ENTITIES, { sourceId: 'ping', auto: false }).length, 0);
  assert.equal(selectTargets(ENTITIES, { sourceId: 'ping', maxTargets: 1 }).length, 1);
});

test('ping : cibles explicites', () => {
  assert.deepEqual(normalizeExplicitTargets(['10.0.0.1', { ip: '10.0.0.2', name: 'Routeur' }, 'pas-une-ip', '10.0.0.1', null]),
    [{ ip: '10.0.0.1', name: '10.0.0.1' }, { ip: '10.0.0.2', name: 'Routeur' }]);
  const explicit = normalizeExplicitTargets([{ ip: '10.0.0.13', name: 'VM eteinte' }, { ip: '10.0.0.99', name: 'Passerelle' }]);
  const targets = selectTargets(ENTITIES, { sourceId: 'ping', explicit, auto: false });
  // entite existante (meme arretee) : ping explicite demande ; sinon entite synthetique
  assert.deepEqual(targets, [
    { ip: '10.0.0.13', entities: [{ id: 'vm-off', type: 'vm', name: 'VM-OFF' }], name: 'VM eteinte' },
    { ip: '10.0.0.99', entities: [], name: 'Passerelle' },
  ]);
});

test('ping : snapshot publie', () => {
  const targets = [
    { ip: '10.0.0.10', entities: [{ id: 'srv-a', type: 'server', name: 'SRV-A' }], name: null },
    { ip: '10.0.0.99', entities: [], name: 'Passerelle' },
  ];
  const snap = pingSnapshot(targets, [{ reachable: true, latencyMs: 2 }, { reachable: false, latencyMs: null }]);
  assert.deepEqual(snap, {
    entities: [
      { id: 'srv-a', type: 'server', name: 'SRV-A', keys: ['ip:10.0.0.10'], status: 'ok', metrics: { latencyMs: 2, reachable: 1 } },
      {
        id: 'ping:10.0.0.99', type: 'external', name: 'Passerelle', attrs: { ip: ['10.0.0.99'] }, keys: ['ip:10.0.0.99'],
        status: 'critical', statusText: 'Injoignable (ping)', metrics: { latencyMs: null, reachable: 0 },
      },
    ],
    links: [],
    flows: [],
  });
});

test('ping : collecteur (ping simule, concurrence respectee)', async () => {
  const ctx = { logger: silent, publish() {}, store: { getEntities: () => ENTITIES } };
  const col = create({ type: 'ping', name: 'ping', targets: [{ ip: '10.0.0.1', name: 'Coeur' }], concurrency: 2 }, ctx);
  assert.ok(col instanceof PingCollector);
  assert.equal(col.intervalMs, 30000);
  let active = 0;
  let maxActive = 0;
  const pinged = [];
  col.pingOne = async (ip) => {
    active++;
    maxActive = Math.max(maxActive, active);
    pinged.push(ip);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return ip === '10.0.0.11' ? { reachable: false, latencyMs: null } : { reachable: true, latencyMs: 4 };
  };
  const snap = await col.poll();
  assert.deepEqual(pinged.sort(), ['10.0.0.1', '10.0.0.10', '10.0.0.11']);
  assert.ok(maxActive <= 2);
  assert.deepEqual(snap.entities.map((e) => [e.id, e.status]), [
    ['ping:10.0.0.1', 'ok'],
    ['srv-a', 'ok'],
    ['vm-b', 'critical'],
  ]);
  assert.equal(snap.entities[2].statusText, 'Injoignable (ping)');
});

test('ping : sans magasin ni cible -> snapshot vide ; commande ping absente -> erreur', async () => {
  const col = create({ type: 'ping' }, { logger: silent, publish() {} });
  assert.deepEqual(await col.poll(), { entities: [], links: [], flows: [] });
  const col2 = create({ type: 'ping', targets: ['10.0.0.1'] }, { logger: silent, publish() {} });
  col2.pingOne = async () => { throw new Error('commande ping indisponible (ENOENT)'); };
  await assert.rejects(() => col2.poll(), /ENOENT/);
});

test('ping : contrat avec le magasin (fusion par id, pas d\'auto-entretien)', async () => {
  const { TopologyStore } = await import('../server/model/store.js');
  const store = new TopologyStore({ rebuildDelayMs: 1e9 });
  try {
    store.publish('win', {
      entities: [{ id: 'windows:srv-a', type: 'server', name: 'SRV-A', keys: ['host:srv-a', 'ip:10.0.0.10'], status: 'ok' }],
    });
    store.rebuild();
    const col = create({ type: 'ping', name: 'ping', targets: ['10.0.0.200'] }, { logger: silent, publish() {}, store });
    col.pingOne = async (ip) => (ip === '10.0.0.10' ? { reachable: false, latencyMs: null } : { reachable: true, latencyMs: 1 });
    store.publish('ping', await col.poll());
    store.rebuild();
    const merged = store.getEntities().filter((e) => e.type !== 'external' || e.id.startsWith('ping:'));
    assert.deepEqual(merged.map((e) => [e.id, e.status, e.sources.slice().sort()]).sort(), [
      ['ping:10.0.0.200', 'ok', ['ping']],
      ['windows:srv-a', 'critical', ['ping', 'win']],
    ]);
    assert.equal(store.getEntity('windows:srv-a').statusText, 'Injoignable (ping)');
    // l'entite synthetique (connue du seul ping) n'est pas reprise comme cible automatique
    const again = await col.poll();
    assert.deepEqual(again.entities.map((e) => e.id).sort(), ['ping:10.0.0.200', 'windows:srv-a']);
  } finally {
    clearTimeout(store.rebuildTimer);
  }
});
