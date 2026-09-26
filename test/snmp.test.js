import { test } from 'node:test';
import assert from 'node:assert/strict';
import createSnmp, {
  buildSnmpSnapshot, parseTargetData, decodeLldpCapabilities, guessVendor, guessDeviceType, computeRates,
  counterDelta, interfaceCounters, neighborType, formatLldpId, collectTarget, normalizeTargets,
  SYSTEM_OIDS, ENTITY_COLS, IF_NAME_COLS, IF_COLS, LLDP_LOC_COLS, LLDP_REM_COLS, LLDP_MAN_ADDR,
} from '../server/collectors/snmp.js';

const mac = (s) => Buffer.from(s.replace(/:/g, ''), 'hex');
const b = (s) => Buffer.from(s);

// --- donnees brutes (telles que renvoyees par net-snmp) ------------------------

function sw1Raw({ hcIn1 = 1_000_000n, hcOut1 = 2_000_000n } = {}) {
  return {
    system: {
      sysDescr: b('Cisco IOS Software, C2960X Software (C2960X-UNIVERSALK9-M), Version 15.2(7)E4'),
      sysObjectID: '1.3.6.1.4.1.9.1.1208',
      sysUpTime: 123456789,
      sysName: b('sw1.corp.local'),
      sysLocation: b('DC1 salle A'),
      sysServices: 2,
    },
    entity: {
      class: { 1: 3, 1001: 10 },
      serial: { 1: b('FOC1234X0YZ'), 1001: b('') },
      model: { 1: b('WS-C2960X-48TS-L'), 1001: b('') },
    },
    ifaces: {
      descr: { 1: b('GigabitEthernet1/0/1'), 2: b('GigabitEthernet1/0/2'), 3: b('GigabitEthernet1/0/3'), 49: b('TenGigabitEthernet1/0/1'), 100: b('Vlan10'), 200: b('Port-channel1') },
      name: { 1: b('Gi1/0/1'), 2: b('Gi1/0/2'), 3: b('Gi1/0/3'), 49: b('Te1/0/1'), 100: b('Vl10'), 200: b('Po1') },
      type: { 1: 6, 2: 6, 3: 6, 49: 6, 100: 53, 200: 161 },
      mac: { 1: mac('00:11:22:33:44:01'), 2: mac('00:11:22:33:44:02'), 3: mac('00:11:22:33:44:03'), 49: mac('00:11:22:33:44:49'), 100: mac('00:11:22:33:44:ff'), 200: mac('00:11:22:33:44:c8') },
      admin: { 1: 1, 2: 1, 3: 2, 49: 1, 100: 1, 200: 1 },
      oper: { 1: 1, 2: 2, 3: 2, 49: 1, 100: 1, 200: 1 },
      inErrors: { 1: 0, 2: 0, 3: 0, 49: 5, 100: 0, 200: 0 },
      hcIn: { 1: u64(hcIn1), 2: u64(0n), 3: u64(0n), 49: u64(10_000_000n), 100: u64(0n), 200: u64(0n) },
      hcOut: { 1: u64(hcOut1), 2: u64(0n), 3: u64(0n), 49: u64(20_000_000n), 100: u64(0n), 200: u64(0n) },
      highSpeed: { 1: 1000, 2: 1000, 3: 1000, 49: 40000, 100: 1000, 200: 2000 },
      alias: { 1: b('esx01 vmnic0'), 2: b('srv-backup'), 3: b(''), 49: b('uplink sw2'), 100: b(''), 200: b('') },
    },
    lldpLoc: {
      portIdSubtype: { 1: 5, 3: 5, 5: 5, 7: 5 },
      portId: { 1: b('Gi1/0/1'), 3: b('Gi1/0/3'), 5: b('Gi1/0/5'), 7: b('Te1/0/1') },
      portDesc: { 1: b('GigabitEthernet1/0/1'), 3: b('GigabitEthernet1/0/3'), 5: b(''), 7: b('TenGigabitEthernet1/0/1') },
    },
    lldpRem: {
      chassisIdSubtype: { '0.1.1': 4, '0.7.2': 4, '0.3.3': 4, '0.5.4': 4 },
      chassisId: { '0.1.1': mac('00:50:56:aa:bb:cc'), '0.7.2': mac('00:22:22:22:22:00'), '0.3.3': mac('00:04:f2:00:00:01'), '0.5.4': mac('f0:9f:c2:00:00:01') },
      portIdSubtype: { '0.1.1': 3, '0.7.2': 5, '0.3.3': 3, '0.5.4': 5 },
      portId: { '0.1.1': mac('00:50:56:aa:bb:01'), '0.7.2': b('Gi1/0/48'), '0.3.3': mac('00:04:f2:00:00:01'), '0.5.4': b('eth0') },
      portDesc: { '0.1.1': b('vmnic0'), '0.7.2': b('GigabitEthernet1/0/48'), '0.3.3': b('WAN'), '0.5.4': b('') },
      sysName: { '0.1.1': b('esx01.corp.local'), '0.7.2': b('SW2'), '0.3.3': b('SEP0004F2000001'), '0.5.4': b('ap-01') },
      sysDesc: { '0.1.1': b('VMware ESXi 8.0.1 build-21495797'), '0.7.2': b('Cisco IOS Software'), '0.3.3': b('Polycom'), '0.5.4': b('UniFi AP') },
      capEnabled: { '0.1.1': Buffer.from([0x20, 0x00]), '0.7.2': Buffer.from([0x28, 0x00]), '0.3.3': Buffer.from([0x24, 0x00]), '0.5.4': Buffer.from([0x10, 0x00]) },
    },
    lldpMan: { '0.1.1.1.4.10.0.0.50': 2 },
    t: 1000,
  };
}

function u64(n) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(n);
  return buf;
}

function sw2Raw() {
  return {
    system: { sysDescr: b('Cisco IOS Software'), sysObjectID: '1.3.6.1.4.1.9.1.2000', sysUpTime: 500, sysName: b('sw2'), sysLocation: b(''), sysServices: 6 },
    entity: {},
    ifaces: {
      descr: { 48: b('GigabitEthernet1/0/48') },
      name: { 48: b('Gi1/0/48') },
      type: { 48: 6 },
      admin: { 48: 1 },
      oper: { 48: 1 },
      highSpeed: { 48: 40000 },
    },
    lldpLoc: { portIdSubtype: { 48: 5 }, portId: { 48: b('Gi1/0/48') } },
    lldpRem: {
      chassisIdSubtype: { '0.48.1': 4 },
      chassisId: { '0.48.1': mac('00:11:22:33:44:00') },
      portIdSubtype: { '0.48.1': 5 },
      portId: { '0.48.1': b('Te1/0/1') },
      sysName: { '0.48.1': b('sw1.corp.local') },
      capEnabled: { '0.48.1': Buffer.from([0x20]) },
    },
    lldpMan: {},
  };
}

// --- fonctions pures -----------------------------------------------------------

test('decodeLldpCapabilities : BITS, bit 0 = poids fort du 1er octet', () => {
  assert.deepEqual(decodeLldpCapabilities(Buffer.from([0x28, 0x00])), ['bridge', 'router']);
  assert.deepEqual(decodeLldpCapabilities(Buffer.from([0x10])), ['wlanAccessPoint']);
  assert.deepEqual(decodeLldpCapabilities(Buffer.from([0x04])), ['telephone']);
  assert.deepEqual(decodeLldpCapabilities(Buffer.from([0x01])), ['stationOnly']);
  assert.deepEqual(decodeLldpCapabilities(Buffer.from([0x80, 0x80])), ['other', 'bit8']);
  assert.deepEqual(decodeLldpCapabilities(null), []);
});

test('neighborType', () => {
  assert.equal(neighborType(['bridge', 'telephone']), null);
  assert.equal(neighborType(['bridge']), 'switch');
  assert.equal(neighborType(['router']), 'router');
  assert.equal(neighborType(['bridge', 'wlanAccessPoint']), 'accesspoint');
  assert.equal(neighborType(['stationOnly']), 'server');
  assert.equal(neighborType(['bridge'], 'Linux pve1 6.8.12-4-pve Proxmox'), 'server');
  assert.equal(neighborType([], 'Cisco IOS Software'), 'switch');
});

test('guessVendor / guessDeviceType', () => {
  assert.equal(guessVendor('1.3.6.1.4.1.9.1.1208'), 'Cisco');
  assert.equal(guessVendor('.1.3.6.1.4.1.2636.1.1.1.2.29'), 'Juniper');
  assert.equal(guessVendor('1.3.6.1.4.1.30065.1.3011'), 'Arista');
  assert.equal(guessVendor('1.3.6.1.4.1.8072.3.2.10'), 'net-snmp (Linux)');
  assert.equal(guessVendor('1.3.6.1.4.1.99999.1'), 'enterprise 99999');
  assert.equal(guessVendor(''), null);
  assert.equal(guessDeviceType({ sysObjectID: '1.3.6.1.4.1.12356.101.1.1', sysDescr: '' }), 'firewall');
  assert.equal(guessDeviceType({ sysObjectID: '1.3.6.1.4.1.3375.2.1.3.4.43', sysDescr: 'BIG-IP' }), 'loadbalancer');
  assert.equal(guessDeviceType({ sysDescr: 'APC Web/SNMP Management Card (MB:v4.1.0) Smart-UPS 3000' }), 'ups');
  assert.equal(guessDeviceType({ sysDescr: 'NetApp Release 9.12.1: ONTAP' }), 'storage');
  assert.equal(guessDeviceType({ sysDescr: 'Hardware: Intel64 - Software: Windows Version 6.3', sysObjectID: '1.3.6.1.4.1.311.1.1.3.1.3' }), 'server');
  assert.equal(guessDeviceType({ sysDescr: 'Cisco IOS Software, ISR4300', services: 78 }), 'router');
  assert.equal(guessDeviceType({ sysDescr: 'Juniper Networks EX4300', services: 4 }), 'router');
  assert.equal(guessDeviceType({ sysDescr: 'something', services: 2 }), 'switch');
  assert.equal(guessDeviceType({}), 'switch');
});

test('formatLldpId', () => {
  assert.equal(formatLldpId(mac('00:50:56:AA:BB:CC'), 4, 'chassis'), '00:50:56:aa:bb:cc');
  assert.equal(formatLldpId(Buffer.from([1, 10, 0, 0, 1]), 5, 'chassis'), '10.0.0.1');
  assert.equal(formatLldpId(b('Gi1/0/1'), 5, 'port'), 'Gi1/0/1');
  assert.equal(formatLldpId(Buffer.from([0x01, 0xff]), 7, 'port'), '01:ff');
});

test('computeRates : debit, rebouclage 32 bits, remise a zero, premier releve', () => {
  assert.deepEqual(computeRates(null, { 1: { in: 5, out: 5, bits: 64 } }, 60), {});
  const prev = { 1: { in: 1000, out: 2000, err: 1, bits: 64 }, 2: { in: 2 ** 32 - 1000, out: 500, bits: 32 }, 3: { in: 5000, out: 5000, bits: 64 } };
  const cur = { 1: { in: 61000, out: 2000 + 750_000, err: 4, bits: 64 }, 2: { in: 1000, out: 400, bits: 32 }, 3: { in: 100, out: 6000, bits: 64 }, 4: { in: 1, out: 1, bits: 64 } };
  const r = computeRates(prev, cur, 60);
  assert.deepEqual(r[1], { rxBps: 8000, txBps: 100000, errors: 3 });
  assert.equal(r[2].rxBps, Math.round((2000 * 8) / 60)); // rebouclage
  assert.equal(r[2].txBps, null);                          // 32 bits, recul important : remise a zero
  assert.equal(r[3].rxBps, null);                          // 64 bits : remise a zero
  assert.equal(r[3].txBps, Math.round((1000 * 8) / 60));
  assert.equal(r[4], undefined);                           // nouvelle interface
  assert.equal(counterDelta(10, 5, 64), null);
  assert.equal(counterDelta(2 ** 32 - 1, 0, 32), 1);
});

test('parseTargetData : systeme, chassis, interfaces et voisins LLDP', () => {
  const d = parseTargetData(sw1Raw());
  assert.equal(d.sysName, 'sw1.corp.local');
  assert.equal(d.uptimeS, 1234567);
  assert.equal(d.vendor, 'Cisco');
  assert.equal(d.serial, 'FOC1234X0YZ');
  assert.equal(d.model, 'WS-C2960X-48TS-L');
  assert.equal(d.interfaces.length, 6);
  const gi1 = d.interfaces.find((i) => i.index === 1);
  assert.equal(gi1.name, 'Gi1/0/1');
  assert.equal(gi1.speedBps, 1e9);
  assert.equal(gi1.inOctets, 1_000_000);
  assert.equal(gi1.bits, 64);
  assert.equal(gi1.mac, '00:11:22:33:44:01');
  assert.equal(d.neighbors.length, 4);
  const esx = d.neighbors.find((n) => n.sysName === 'esx01.corp.local');
  assert.equal(esx.ifIndex, 1);
  assert.equal(esx.chassisId, '00:50:56:aa:bb:cc');
  assert.equal(esx.portId, '00:50:56:aa:bb:01');
  assert.deepEqual(esx.mgmtIp, ['10.0.0.50']);
  // numero de port LLDP 7 -> ifIndex 49 par le nom du port
  const sw2 = d.neighbors.find((n) => n.sysName === 'SW2');
  assert.equal(sw2.localPortNum, 7);
  assert.equal(sw2.ifIndex, 49);
  assert.deepEqual(sw2.caps, ['bridge', 'router']);
  // port 5 inconnu dans ifTable : pas d'interface, nom LLDP conserve
  const ap = d.neighbors.find((n) => n.sysName === 'ap-01');
  assert.equal(ap.ifIndex, null);
  assert.equal(ap.localPort, 'Gi1/0/5');
});

function snapshotFixture() {
  const d1a = parseTargetData(sw1Raw());
  const d1 = parseTargetData(sw1Raw({ hcIn1: 1_000_000n + 7_500_000n, hcOut1: 2_000_000n + 75_000_000n }));
  const rates = computeRates(interfaceCounters(d1a.interfaces), interfaceCounters(d1.interfaces), 60);
  return buildSnmpSnapshot([
    { target: { host: '10.0.0.1', lldp: true }, ok: true, data: d1, rates },
    { target: { host: '10.0.0.2' }, ok: true, data: parseTargetData(sw2Raw()), rates: {} },
    { target: { host: '10.0.0.3', name: 'fw1', type: 'firewall' }, ok: false, error: 'Request timed out', last: { sysName: 'fw1.corp.local', serial: 'FGT60F000001' } },
    { target: { host: '10.0.0.4', name: 'core-rtr' }, ok: false, error: 'Request timed out' },
  ]);
}

test('buildSnmpSnapshot : equipement, statut, interfaces et metriques', () => {
  const snap = snapshotFixture();
  assert.deepEqual(snap.flows, []);
  const sw1 = snap.entities.find((e) => e.id === 'snmp:10.0.0.1');
  assert.equal(sw1.type, 'switch');
  assert.equal(sw1.name, 'sw1.corp.local');
  assert.deepEqual(sw1.keys.sort(), ['fqdn:sw1.corp.local', 'host:sw1', 'ip:10.0.0.1', 'serial:FOC1234X0YZ']);
  assert.equal(sw1.attrs.vendor, 'Cisco');
  assert.equal(sw1.attrs.model, 'WS-C2960X-48TS-L');
  assert.equal(sw1.attrs.serial, 'FOC1234X0YZ');
  assert.equal(sw1.attrs.location, 'DC1 salle A');
  assert.deepEqual(sw1.attrs.ip, ['10.0.0.1']);
  // Vlan10 exclu, Po1 (LAG) liste mais pas compte comme port
  assert.deepEqual(sw1.attrs.interfaces.map((i) => i.name), ['Gi1/0/1', 'Gi1/0/2', 'Gi1/0/3', 'Te1/0/1', 'Po1']);
  assert.equal(sw1.attrs.portsTotal, 4);
  assert.equal(sw1.attrs.portsUp, 2);
  const gi1 = sw1.attrs.interfaces[0];
  assert.deepEqual(gi1, { index: 1, name: 'Gi1/0/1', alias: 'esx01 vmnic0', speedBps: 1e9, oper: 'up', admin: 'up', rxBps: 1_000_000, txBps: 10_000_000, util: 1 });
  assert.equal(sw1.metrics.uptimeS, 1234567);
  assert.equal(sw1.metrics.rxBps, 1_000_000);
  assert.equal(sw1.metrics.txBps, 10_000_000);
  assert.equal(sw1.metrics.portsUp, 2);
  // Gi1/0/2 documente, actif, mais tombe
  assert.equal(sw1.status, 'warning');
  assert.match(sw1.statusText, /Gi1\/0\/2 \(srv-backup\)/);

  const sw2 = snap.entities.find((e) => e.id === 'snmp:10.0.0.2');
  assert.equal(sw2.status, 'ok');
  assert.equal(sw2.metrics.rxBps, undefined); // premier releve : pas de debit
});

test('buildSnmpSnapshot : cible injoignable', () => {
  const snap = snapshotFixture();
  const fw = snap.entities.find((e) => e.id === 'snmp:10.0.0.3');
  assert.equal(fw.status, 'critical');
  assert.equal(fw.type, 'firewall');
  assert.equal(fw.name, 'fw1');
  assert.match(fw.statusText, /timed out/);
  // derniere identite connue conservee pour la correlation
  assert.deepEqual(fw.keys.sort(), ['fqdn:fw1.corp.local', 'host:fw1', 'ip:10.0.0.3', 'serial:FGT60F000001']);
  const rtr = snap.entities.find((e) => e.id === 'snmp:10.0.0.4');
  assert.equal(rtr.type, 'switch');
  assert.deepEqual(rtr.keys.sort(), ['host:core-rtr', 'ip:10.0.0.4']);
});

test('buildSnmpSnapshot : voisins LLDP et liens', () => {
  const snap = snapshotFixture();
  const ids = snap.entities.map((e) => e.id);
  // telephone ignore ; sw2 est une cible : pas d'entite voisine
  assert.ok(!ids.some((id) => id.includes('sep0004f2000001')));
  assert.ok(!ids.includes('snmp:nbr:sw2'));
  const esx = snap.entities.find((e) => e.id === 'snmp:nbr:esx01.corp.local');
  assert.equal(esx.type, 'server');
  assert.equal(esx.name, 'esx01.corp.local');
  assert.deepEqual(esx.keys.sort(), ['fqdn:esx01.corp.local', 'host:esx01', 'ip:10.0.0.50', 'mac:00:50:56:aa:bb:cc']);
  const ap = snap.entities.find((e) => e.id === 'snmp:nbr:ap-01');
  assert.equal(ap.type, 'accesspoint');

  assert.equal(snap.links.length, 3);
  const lEsx = snap.links.find((l) => l.b === 'snmp:nbr:esx01.corp.local');
  assert.deepEqual(lEsx, {
    a: 'snmp:10.0.0.1', aPort: 'Gi1/0/1', b: 'snmp:nbr:esx01.corp.local', bPort: 'vmnic0',
    kind: 'ethernet', speedBps: 1e9, status: 'ok',
    metrics: { rxBps: 1_000_000, txBps: 10_000_000, util: 1, errors: 0 },
  });
  // lien sw1 <-> sw2 publie une seule fois (vu des deux cotes)
  const inter = snap.links.filter((l) => [l.a, l.b].sort().join() === 'snmp:10.0.0.1,snmp:10.0.0.2');
  assert.equal(inter.length, 1);
  assert.equal(inter[0].a, 'snmp:10.0.0.1');
  assert.equal(inter[0].aPort, 'Te1/0/1');
  assert.equal(inter[0].bPort, 'Gi1/0/48');
  assert.equal(inter[0].kind, 'fiber'); // 40G
  assert.equal(inter[0].metrics.errors, 0);
  const lAp = snap.links.find((l) => l.b === 'snmp:nbr:ap-01');
  assert.equal(lAp.aPort, 'Gi1/0/5');
  assert.equal(lAp.status, 'unknown');
  assert.equal(lAp.bPort, 'eth0');
});

test('normalizeTargets : valeurs par defaut', () => {
  const t = normalizeTargets({ defaults: { community: 'c0mm', version: 2 }, targets: ['10.0.0.1', { host: '10.0.0.2', version: 'v3', user: 'u' }, {}] });
  assert.equal(t.length, 2);
  assert.equal(t[0].community, 'c0mm');
  assert.equal(t[0].version, '2c');
  assert.equal(t[0].port, 161);
  assert.equal(t[1].version, '3');
  assert.equal(t[1].lldp, true);
});

// --- E/S avec une session simulee -------------------------------------------------

class FakeTimeout extends Error { constructor(m) { super(m); this.name = 'RequestTimedOutError'; } }
const fakeSnmp = { isVarbindError: (vb) => vb.type === 128, RequestTimedOutError: FakeTimeout };

function flatten(raw) {
  const flat = new Map();
  const put = (cols, values) => {
    for (const [k, oid] of Object.entries(cols)) for (const [idx, v] of Object.entries(values[k] || {})) flat.set(`${oid}.${idx}`, v);
  };
  for (const [k, oid] of Object.entries(SYSTEM_OIDS)) flat.set(oid, raw.system[k]);
  put(ENTITY_COLS, raw.entity);
  put({ ...IF_NAME_COLS, ...IF_COLS }, raw.ifaces);
  put(LLDP_LOC_COLS, raw.lldpLoc);
  put(LLDP_REM_COLS, raw.lldpRem);
  for (const [idx, v] of Object.entries(raw.lldpMan)) flat.set(`${LLDP_MAN_ADDR}.${idx}`, v);
  return flat;
}

function cmpOid(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

function fakeSession(flat, { timeout = false } = {}) {
  const oids = [...flat.keys()].sort(cmpOid);
  const walked = [];
  return {
    walked,
    get(list, cb) {
      if (timeout) return cb(new FakeTimeout('Request timed out'));
      cb(null, list.map((oid) => (flat.has(oid) ? { oid, type: 4, value: flat.get(oid) } : { oid, type: 128, value: null })));
    },
    subtree(base, maxRep, feed, done) {
      walked.push(base);
      const vbs = oids.filter((o) => o.startsWith(`${base}.`)).map((oid) => ({ oid, type: 4, value: flat.get(oid) }));
      if (vbs.length) feed(vbs);
      done(null);
    },
  };
}

test('collectTarget : lecture via une session simulee', async () => {
  const session = fakeSession(flatten(sw1Raw()));
  const raw = await collectTarget(fakeSnmp, { host: '10.0.0.1', lldp: true, interfaces: true }, { session });
  const d = parseTargetData(raw);
  assert.equal(d.sysName, 'sw1.corp.local');
  assert.equal(d.serial, 'FOC1234X0YZ');
  assert.equal(d.interfaces.length, 6);
  assert.equal(d.neighbors.length, 4);
  assert.equal(d.neighbors.find((n) => n.sysName === 'SW2').ifIndex, 49);
  assert.ok(typeof raw.t === 'number');

  // sans LLDP sur l'equipement : les autres colonnes LLDP ne sont pas lues
  const raw2 = sw2Raw();
  raw2.lldpRem = {};
  const s2 = fakeSession(flatten(raw2));
  await collectTarget(fakeSnmp, { host: '10.0.0.2' }, { session: s2 });
  assert.ok(s2.walked.includes(LLDP_REM_COLS.chassisId));
  assert.ok(!s2.walked.includes(LLDP_REM_COLS.sysName));
  // cible injoignable
  await assert.rejects(collectTarget(fakeSnmp, { host: '10.0.0.9' }, { session: fakeSession(new Map(), { timeout: true }) }), /timed out/);
});

// --- collecteur (net-snmp reel, cible sans agent) -----------------------------------

const silent = { debug() {}, info() {}, warn() {}, error() {}, child() { return silent; } };

test('collecteur : cible sans reponse -> entite critique', async () => {
  const col = createSnmp({
    type: 'snmp', name: 'snmp',
    targets: [{ host: '127.0.0.1', port: 1, name: 'lab-sw', requestTimeout: 1, retries: 0 }],
  }, { logger: silent, publish() {} });
  const snap = await col.poll();
  assert.equal(snap.entities.length, 1);
  assert.equal(snap.entities[0].id, 'snmp:127.0.0.1');
  assert.equal(snap.entities[0].status, 'critical');
  assert.equal(snap.entities[0].name, 'lab-sw');
});

test('collecteur : configuration SNMPv3 invalide isolee par cible', async () => {
  const col = createSnmp({ type: 'snmp', targets: [{ host: '127.0.0.1', version: '3' }] }, { logger: silent, publish() {} });
  const snap = await col.poll();
  assert.equal(snap.entities[0].status, 'critical');
  assert.match(snap.entities[0].statusText, /user/);
});

test('collectTarget : agent defectueux (OID non croissant / noSuchObject) sans boucle infinie', async () => {
  const flat = flatten(sw2Raw());
  const session = fakeSession(flat);
  const subtree = session.subtree;
  let calls = 0;
  session.subtree = (base, maxRep, feed, done) => {
    // colonnes absentes : l'agent renvoie indefiniment noSuchObject sur le meme OID
    if (![...flat.keys()].some((o) => o.startsWith(`${base}.`))) {
      for (let i = 0; i < 1000; i++) {
        calls++;
        if (feed([{ oid: base, type: 128, value: null }])) return done(null);
      }
      return done(new Error('boucle infinie'));
    }
    // colonne ifName : OID qui revient en arriere apres la 1re ligne
    if (base === IF_NAME_COLS.name) {
      for (let i = 0; i < 1000; i++) {
        calls++;
        if (feed([{ oid: `${base}.48`, type: 4, value: b('Gi1/0/48') }])) return done(null);
      }
      return done(new Error('boucle infinie'));
    }
    return subtree(base, maxRep, feed, done);
  };
  const d = parseTargetData(await collectTarget(fakeSnmp, { host: '10.0.0.2' }, { session }));
  assert.equal(d.interfaces[0].name, 'Gi1/0/48');
  assert.ok(calls < 100);
});
