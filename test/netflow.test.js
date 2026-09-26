import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { parsePacket, TemplateCache, ipv6ToString, FlowParseError } from '../server/collectors/netflow-parser.js';
import createNetflow, { FlowAggregator, servicePort, conversationOf, protoName } from '../server/collectors/netflow.js';

// --- construction de paquets ------------------------------------------------

function ip4(buf, off, ip) {
  ip.split('.').forEach((p, i) => { buf[off + i] = Number(p); });
}

function v5Packet(records, { sampling = 0 } = {}) {
  const buf = Buffer.alloc(24 + records.length * 48);
  buf.writeUInt16BE(5, 0);
  buf.writeUInt16BE(records.length, 2);
  buf.writeUInt32BE(100000, 4);          // sysUptime
  buf.writeUInt32BE(1700000000, 8);      // unix_secs
  buf.writeUInt16BE(sampling, 22);
  records.forEach((r, i) => {
    const o = 24 + i * 48;
    ip4(buf, o, r.src);
    ip4(buf, o + 4, r.dst);
    buf.writeUInt16BE(r.inIf || 0, o + 12);
    buf.writeUInt16BE(r.outIf || 0, o + 14);
    buf.writeUInt32BE(r.packets, o + 16);
    buf.writeUInt32BE(r.bytes, o + 20);
    buf.writeUInt32BE(90000, o + 24);
    buf.writeUInt32BE(99000, o + 28);
    buf.writeUInt16BE(r.srcPort, o + 32);
    buf.writeUInt16BE(r.dstPort, o + 34);
    buf[o + 38] = r.proto;
  });
  return buf;
}

// gabarit v9 : srcIP(8) dstIP(12) srcPort(7) dstPort(11) proto(4) octets(1, 8 octets) pkts(2) in(10) out(14) last(21) first(22)
const V9_FIELDS = [[8, 4], [12, 4], [7, 2], [11, 2], [4, 1], [1, 8], [2, 4], [10, 2], [14, 2], [21, 4], [22, 4]];
const V9_REC_LEN = V9_FIELDS.reduce((s, f) => s + f[1], 0);

function v9Header(count, sourceId = 7) {
  const h = Buffer.alloc(20);
  h.writeUInt16BE(9, 0);
  h.writeUInt16BE(count, 2);
  h.writeUInt32BE(500000, 4);
  h.writeUInt32BE(1700000000, 8);
  h.writeUInt32BE(1, 12);
  h.writeUInt32BE(sourceId, 16);
  return h;
}

function v9TemplateSet(tid = 256) {
  const b = Buffer.alloc(4 + 4 + V9_FIELDS.length * 4);
  b.writeUInt16BE(0, 0);
  b.writeUInt16BE(b.length, 2);
  b.writeUInt16BE(tid, 4);
  b.writeUInt16BE(V9_FIELDS.length, 6);
  V9_FIELDS.forEach(([id, len], i) => { b.writeUInt16BE(id, 8 + i * 4); b.writeUInt16BE(len, 10 + i * 4); });
  return b;
}

function v9DataSet(records, tid = 256) {
  const raw = 4 + records.length * V9_REC_LEN;
  const len = raw + ((4 - (raw % 4)) % 4); // bourrage a 32 bits
  const b = Buffer.alloc(len);
  b.writeUInt16BE(tid, 0);
  b.writeUInt16BE(len, 2);
  records.forEach((r, i) => {
    let o = 4 + i * V9_REC_LEN;
    ip4(b, o, r.src); o += 4;
    ip4(b, o, r.dst); o += 4;
    b.writeUInt16BE(r.srcPort, o); o += 2;
    b.writeUInt16BE(r.dstPort, o); o += 2;
    b[o] = r.proto; o += 1;
    b.writeBigUInt64BE(BigInt(r.bytes), o); o += 8;
    b.writeUInt32BE(r.packets, o); o += 4;
    b.writeUInt16BE(3, o); o += 2;
    b.writeUInt16BE(4, o); o += 2;
    b.writeUInt32BE(499000, o); o += 4;
    b.writeUInt32BE(480000, o); o += 4;
  });
  return b;
}

// IPFIX : srcIPv6(27) dstIPv6(28) champ entreprise (variable) srcPort dstPort proto octets(4) pkts(4) flowStartMs(152) applicationName(96, variable)
function ipfixPacket({ withTemplate = true, withData = true, domain = 42, longName = false } = {}) {
  const parts = [];
  if (withTemplate) {
    const fields = [[27, 16], [28, 16], [0x8000 | 100, 0xffff, 9], [7, 2], [11, 2], [4, 1], [1, 4], [2, 4], [152, 8], [96, 0xffff]];
    const len = 4 + 4 + fields.reduce((s, f) => s + (f[0] & 0x8000 ? 8 : 4), 0);
    const b = Buffer.alloc(len);
    b.writeUInt16BE(2, 0);
    b.writeUInt16BE(len, 2);
    b.writeUInt16BE(300, 4);
    b.writeUInt16BE(fields.length, 6);
    let o = 8;
    for (const [id, flen, ent] of fields) {
      b.writeUInt16BE(id, o); b.writeUInt16BE(flen, o + 2); o += 4;
      if (id & 0x8000) { b.writeUInt32BE(ent, o); o += 4; }
    }
    parts.push(b);
  }
  if (withData) {
    const src = Buffer.from('20010db8000000000000000000000001', 'hex');
    const dst = Buffer.from('20010db800000000000000000000abcd', 'hex');
    const name = Buffer.from(longName ? 'x'.repeat(300) : 'https');
    const nameLen = longName ? Buffer.from([255, 0, 0]) : Buffer.from([name.length]);
    nameLen.length === 3 && nameLen.writeUInt16BE(name.length, 1);
    const entVal = Buffer.from([3, 1, 2, 3]); // variable : 1 octet de longueur + 3
    const rec = Buffer.concat([
      src, dst, entVal,
      Buffer.from([0xc3, 0x50]), // 50000
      Buffer.from([0x01, 0xbb]), // 443
      Buffer.from([6]),
      Buffer.from([0, 0, 0x27, 0x10]), // 10000 octets
      Buffer.from([0, 0, 0, 20]),
      (() => { const t = Buffer.alloc(8); t.writeBigUInt64BE(1700000000123n); return t; })(),
      nameLen, name,
    ]);
    const h = Buffer.alloc(4);
    h.writeUInt16BE(300, 0);
    h.writeUInt16BE(4 + rec.length, 2);
    parts.push(h, rec);
  }
  const body = Buffer.concat(parts);
  const hdr = Buffer.alloc(16);
  hdr.writeUInt16BE(10, 0);
  hdr.writeUInt16BE(16 + body.length, 2);
  hdr.writeUInt32BE(1700000000, 4);
  hdr.writeUInt32BE(1, 8);
  hdr.writeUInt32BE(domain, 12);
  return Buffer.concat([hdr, body]);
}

// --- parseur ----------------------------------------------------------------

test('NetFlow v5 : decodage des enregistrements', () => {
  const buf = v5Packet([
    { src: '10.0.0.1', dst: '10.0.0.2', srcPort: 51000, dstPort: 443, proto: 6, bytes: 1500, packets: 3, inIf: 1, outIf: 2 },
    { src: '10.0.0.3', dst: '8.8.8.8', srcPort: 40000, dstPort: 53, proto: 17, bytes: 80, packets: 1 },
  ]);
  const res = parsePacket(buf, { exporter: '192.0.2.1' });
  assert.equal(res.version, 5);
  assert.equal(res.records.length, 2);
  const [a, b] = res.records;
  assert.deepEqual(
    { src: a.src, dst: a.dst, srcPort: a.srcPort, dstPort: a.dstPort, proto: a.proto, bytes: a.bytes, packets: a.packets, exporter: a.exporter, inIf: a.inIf, outIf: a.outIf },
    { src: '10.0.0.1', dst: '10.0.0.2', srcPort: 51000, dstPort: 443, proto: 6, bytes: 1500, packets: 3, exporter: '192.0.2.1', inIf: 1, outIf: 2 },
  );
  assert.equal(b.dst, '8.8.8.8');
  assert.equal(b.proto, 17);
  // horodatage : unix_secs - (uptime - first)
  assert.equal(a.start, 1700000000000 - 10000);
  assert.equal(a.end, 1700000000000 - 1000);
});

test('NetFlow v5 : echantillonnage (en-tete prioritaire sur la configuration)', () => {
  const recs = [{ src: '10.0.0.1', dst: '10.0.0.2', srcPort: 1, dstPort: 2, proto: 6, bytes: 100, packets: 2 }];
  assert.equal(parsePacket(v5Packet(recs), { sampling: 10 }).records[0].bytes, 1000);
  // mode 01 (2 bits de poids fort) + intervalle 100
  const r = parsePacket(v5Packet(recs, { sampling: (1 << 14) | 100 }), { sampling: 10 }).records[0];
  assert.equal(r.bytes, 10000);
  assert.equal(r.packets, 200);
});

test('NetFlow v5 : paquet tronque -> erreur', () => {
  const buf = v5Packet([{ src: '10.0.0.1', dst: '10.0.0.2', srcPort: 1, dstPort: 2, proto: 6, bytes: 1, packets: 1 }]);
  assert.throws(() => parsePacket(buf.subarray(0, 50)), FlowParseError);
  assert.throws(() => parsePacket(Buffer.from([0, 7, 0, 0])), /version/);
});

test('NetFlow v9 : gabarit et donnees dans le meme paquet', () => {
  const recs = [
    { src: '172.16.0.10', dst: '172.16.1.20', srcPort: 49152, dstPort: 1433, proto: 6, bytes: 5_000_000_000, packets: 4000 },
    { src: '172.16.0.11', dst: '172.16.1.20', srcPort: 49153, dstPort: 1433, proto: 6, bytes: 700, packets: 7 },
  ];
  const buf = Buffer.concat([v9Header(3), v9TemplateSet(), v9DataSet(recs)]);
  const templates = new TemplateCache();
  const res = parsePacket(buf, { exporter: '10.9.9.9', templates });
  assert.equal(res.version, 9);
  assert.equal(res.templates, 1);
  assert.equal(res.records.length, 2);
  const a = res.records[0];
  assert.equal(a.src, '172.16.0.10');
  assert.equal(a.dst, '172.16.1.20');
  assert.equal(a.dstPort, 1433);
  assert.equal(a.bytes, 5_000_000_000); // compteur sur 8 octets
  assert.equal(a.packets, 4000);
  assert.equal(a.inIf, 3);
  assert.equal(a.outIf, 4);
  assert.equal(a.start, 1700000000000 - 20000);
  assert.equal(templates.countFor('10.9.9.9'), 1);
});

test('NetFlow v9 : gabarit et donnees dans des paquets separes', () => {
  const templates = new TemplateCache();
  const rec = { src: '10.1.1.1', dst: '10.2.2.2', srcPort: 3389, dstPort: 60000, proto: 6, bytes: 1234, packets: 5 };
  // donnees avant le gabarit : ignorees
  const early = parsePacket(Buffer.concat([v9Header(1), v9DataSet([rec])]), { exporter: 'r1', templates });
  assert.equal(early.records.length, 0);
  assert.equal(early.missingTemplate, 1);
  parsePacket(Buffer.concat([v9Header(1), v9TemplateSet()]), { exporter: 'r1', templates });
  const res = parsePacket(Buffer.concat([v9Header(1), v9DataSet([rec])]), { exporter: 'r1', templates, sampling: 2 });
  assert.equal(res.records.length, 1);
  assert.equal(res.records[0].srcPort, 3389);
  assert.equal(res.records[0].bytes, 2468);
  // gabarit propre a l'exportateur et au source id
  assert.equal(parsePacket(Buffer.concat([v9Header(1), v9DataSet([rec])]), { exporter: 'r2', templates }).records.length, 0);
  assert.equal(parsePacket(Buffer.concat([v9Header(1, 8), v9DataSet([rec])]), { exporter: 'r1', templates }).records.length, 0);
});

test('NetFlow v9 : gabarit d\'options ignore', () => {
  const opt = Buffer.alloc(16);
  opt.writeUInt16BE(1, 0);
  opt.writeUInt16BE(16, 2);
  opt.writeUInt16BE(257, 4);
  const res = parsePacket(Buffer.concat([v9Header(1), opt]), { exporter: 'r1' });
  assert.equal(res.records.length, 0);
  assert.equal(res.templates, 0);
});

test('IPFIX : IPv6, champ entreprise et champs de longueur variable', () => {
  const templates = new TemplateCache();
  const res = parsePacket(ipfixPacket(), { exporter: '2001:db8::fe', templates });
  assert.equal(res.version, 10);
  assert.equal(res.templates, 1);
  assert.equal(res.records.length, 1);
  const r = res.records[0];
  assert.equal(r.src, '2001:db8::1');
  assert.equal(r.dst, '2001:db8::abcd');
  assert.equal(r.srcPort, 50000);
  assert.equal(r.dstPort, 443);
  assert.equal(r.proto, 6);
  assert.equal(r.bytes, 10000);
  assert.equal(r.packets, 20);
  assert.equal(r.start, 1700000000123);
  // longueur variable sur 3 octets (255 + uint16)
  const long = parsePacket(ipfixPacket({ withTemplate: false, longName: true }), { exporter: '2001:db8::fe', templates });
  assert.equal(long.records.length, 1);
  assert.equal(long.records[0].bytes, 10000);
  // domaine d'observation different : gabarit inconnu
  const other = parsePacket(ipfixPacket({ withTemplate: false, domain: 43 }), { exporter: '2001:db8::fe', templates });
  assert.equal(other.records.length, 0);
  assert.equal(other.missingTemplate, 1);
});

test('ipv6ToString', () => {
  assert.equal(ipv6ToString(Buffer.from('00000000000000000000ffff0a000001', 'hex')), '10.0.0.1');
  assert.equal(ipv6ToString(Buffer.from('fe800000000000000000000000000001', 'hex')), 'fe80::1');
  assert.equal(ipv6ToString(Buffer.from('20010db8000100000001000000000001', 'hex')), '2001:db8:1:0:1::1');
});

// --- agregation --------------------------------------------------------------

test('detection du port de service', () => {
  assert.deepEqual(servicePort(51000, 443, 6), { port: 443, serverIsDst: true });
  assert.deepEqual(servicePort(443, 51000, 6), { port: 443, serverIsDst: false });
  assert.deepEqual(servicePort(3389, 60000, 6), { port: 3389, serverIsDst: false }); // port connu > 1024
  assert.deepEqual(servicePort(53, 123, 17), { port: 53, serverIsDst: false });      // deux ports connus : le plus petit
  assert.deepEqual(servicePort(40000, 7777, 6), { port: 7777, serverIsDst: true });  // inconnu : destination
  assert.deepEqual(servicePort(7777, 40000, 6), { port: 7777, serverIsDst: false }); // reponse vers port ephemere
  assert.deepEqual(servicePort(0, 2048, 1), { port: null, serverIsDst: true });      // ICMP : pas de port
  const c = conversationOf({ src: '10.0.0.5', dst: '10.0.0.9', srcPort: 1433, dstPort: 50123, proto: 6 });
  assert.deepEqual(c, { client: '10.0.0.9', server: '10.0.0.5', proto: 6, port: 1433 });
  assert.equal(protoName(6), 'tcp');
  assert.equal(protoName(47), '47');
});

test('agregation : conversations, debit sur la fenetre glissante, tri et limite', () => {
  let now = 0;
  const agg = new FlowAggregator({ windowSec: 60, bucketSec: 10, maxFlows: 2, now: () => now });
  const req = { src: '10.0.0.1', dst: '10.0.0.2', srcPort: 50000, dstPort: 443, proto: 6, bytes: 300000, packets: 300 };
  const resp = { src: '10.0.0.2', dst: '10.0.0.1', srcPort: 443, dstPort: 50000, proto: 6, bytes: 450000, packets: 600 };
  now = 5000; agg.add([req, resp]);
  now = 35000; agg.add([req]);
  now = 36000; agg.add([{ src: '10.0.0.3', dst: '10.0.0.2', srcPort: 50001, dstPort: 22, proto: 6, bytes: 6000, packets: 60 }]);
  now = 37000; agg.add([{ src: '10.0.0.4', dst: '10.0.0.2', srcPort: 123, dstPort: 123, proto: 17, bytes: 60, packets: 1 }]);
  now = 60000;
  const snap = agg.snapshot();
  assert.deepEqual(snap.entities, []);
  assert.deepEqual(snap.links, []);
  assert.equal(snap.flows.length, 2); // maxFlows
  const [f1, f2] = snap.flows;
  // aller + retour + 2e requete agreges dans une seule conversation
  assert.deepEqual(f1.src, { ip: '10.0.0.1' });
  assert.deepEqual(f1.dst, { ip: '10.0.0.2' });
  assert.equal(f1.proto, 'tcp');
  assert.equal(f1.port, 443);
  assert.equal(f1.app, 'https');
  assert.equal(f1.bps, ((300000 + 450000 + 300000) * 8) / 60);
  assert.equal(f1.pps, 20);
  assert.equal(f2.port, 22);
  assert.equal(f2.app, 'ssh');
  assert.equal(f2.bps, 800);

  // 70 s plus tard : la premiere tranche (0-10 s) sort de la fenetre
  now = 70000;
  const snap2 = agg.snapshot();
  assert.equal(snap2.flows[0].bps, (300000 * 8) / 60);
  // bien plus tard : tout est expire
  now = 200000;
  assert.equal(agg.snapshot().flows.length, 0);
});

test('agregation : fenetre partielle au demarrage', () => {
  let now = 1000000;
  const agg = new FlowAggregator({ windowSec: 60, now: () => now });
  agg.add([{ src: '10.0.0.1', dst: '10.0.0.2', srcPort: 50000, dstPort: 80, proto: 6, bytes: 1000, packets: 10 }]);
  now += 10000;
  const [f] = agg.snapshot().flows;
  assert.equal(f.bps, 800); // 8000 bits / 10 s
  assert.equal(f.pps, 1);
});

// --- collecteur (reception UDP reelle sur 127.0.0.1) --------------------------

const silent = { debug() {}, info() {}, warn() {}, error() {}, child() { return silent; } };

test('collecteur : reception UDP, publication et statut', async () => {
  const published = [];
  const ctx = { logger: silent, publish: (id, snap) => published.push({ id, snap }) };
  const port = 20000 + Math.floor(Math.random() * 20000);
  const col = createNetflow({ type: 'netflow', name: 'nf', port, bind: '127.0.0.1', interval: 3600 }, ctx);
  await col.start();
  try {
    assert.equal(col.listening, true);
    const client = dgram.createSocket('udp4');
    const pkt = v5Packet([{ src: '10.0.0.1', dst: '10.0.0.2', srcPort: 50000, dstPort: 443, proto: 6, bytes: 6000, packets: 6 }]);
    await new Promise((res, rej) => client.send(pkt, port, '127.0.0.1', (e) => (e ? rej(e) : res())));
    await new Promise((res, rej) => client.send(Buffer.from([0, 99, 0, 0, 1]), port, '127.0.0.1', (e) => (e ? rej(e) : res())));
    client.close();
    for (let i = 0; i < 50 && col.status().packets < 2; i++) await new Promise((r) => setTimeout(r, 20));
    const st = col.status();
    assert.equal(st.packets, 2);
    assert.equal(st.records, 1);
    assert.equal(st.parseErrors, 1);
    assert.equal(st.exporters.length, 1);
    assert.equal(st.exporters[0].address, '127.0.0.1');
    assert.equal(st.exporters[0].version, 5);
    await col.runOnce();
    const last = published[published.length - 1];
    assert.equal(last.id, 'nf');
    assert.equal(last.snap.flows.length, 1);
    assert.equal(last.snap.flows[0].port, 443);
  } finally {
    await col.stop();
  }
  assert.equal(col.socket, null);
});

test('collecteur : port UDP deja utilise -> erreur de collecte, pas d\'exception', async () => {
  const busy = dgram.createSocket('udp4');
  await new Promise((r) => busy.bind(0, '127.0.0.1', r));
  const port = busy.address().port;
  const col = createNetflow({ type: 'netflow', name: 'nf2', port, bind: '127.0.0.1', interval: 3600 }, { logger: silent, publish() {} });
  try {
    await col.start();
    assert.equal(col.listening, false);
    await assert.rejects(col.poll(), /non ouvert.*EADDRINUSE/);
  } finally {
    await col.stop();
    busy.close();
  }
});
