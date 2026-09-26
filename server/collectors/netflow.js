// Recepteur NetFlow v5 / v9 / IPFIX (UDP).
//
// Les enregistrements recus sont agreges en conversations
// (client, serveur, protocole, port de service) sur une fenetre glissante ;
// le collecteur publie periodiquement les conversations les plus volumineuses
// sous forme de flux (debit moyen sur la fenetre).
import dgram from 'node:dgram';
import { Collector } from './base.js';
import { appForPort } from '../../shared/model.js';
import { parsePacket, TemplateCache } from './netflow-parser.js';

const PROTO_NAMES = { 1: 'icmp', 6: 'tcp', 17: 'udp', 58: 'icmp' };
// protocoles porteurs de ports (TCP, UDP, DCCP, SCTP)
const PORT_PROTOS = new Set([6, 17, 33, 132]);
const EPHEMERAL_MIN = 32768;

export function protoName(n) {
  return PROTO_NAMES[n] || String(n);
}

function isServicePort(p) {
  return p > 0 && (p < 1024 || appForPort(p) != null);
}

/**
 * Determine le port de service et le sens de la conversation.
 * Le port de service est le port « connu » (< 1024 ou reference dans
 * WELL_KNOWN_PORTS) ; si les deux le sont, le plus petit ; sinon le port
 * destination (sauf s'il est ephemere et pas le port source).
 * @returns {{port:number|null, serverIsDst:boolean}}
 */
export function servicePort(srcPort, dstPort, proto = 6) {
  if (!PORT_PROTOS.has(proto)) return { port: null, serverIsDst: true };
  const s = isServicePort(srcPort);
  const d = isServicePort(dstPort);
  if (s && d) return srcPort < dstPort ? { port: srcPort, serverIsDst: false } : { port: dstPort, serverIsDst: true };
  if (s) return { port: srcPort, serverIsDst: false };
  if (d) return { port: dstPort, serverIsDst: true };
  // aucun port connu : destination, sauf si seule la destination est ephemere (reponse)
  if (dstPort >= EPHEMERAL_MIN && srcPort > 0 && srcPort < EPHEMERAL_MIN) return { port: srcPort, serverIsDst: false };
  return { port: dstPort, serverIsDst: true };
}

/** Enregistrement de flux -> conversation {client, server, proto, port}. */
export function conversationOf(rec) {
  const { port, serverIsDst } = servicePort(rec.srcPort, rec.dstPort, rec.proto);
  return serverIsDst
    ? { client: rec.src, server: rec.dst, proto: rec.proto, port }
    : { client: rec.dst, server: rec.src, proto: rec.proto, port };
}

/**
 * Agregation des conversations sur une fenetre glissante decoupee en tranches.
 * `now` est injectable (tests).
 */
export class FlowAggregator {
  constructor({ windowSec = 60, bucketSec, maxFlows = 500, maxConversations = 100000, now = Date.now } = {}) {
    this.windowMs = Math.max(1, Number(windowSec) || 60) * 1000;
    this.bucketMs = Math.max(1, Number(bucketSec) || Math.round(this.windowMs / 12000)) * 1000;
    this.maxFlows = Math.max(1, Number(maxFlows) || 500);
    this.maxConversations = maxConversations;
    this.now = now;
    this.startedAt = now();
    this.buckets = [];
    this.dropped = 0;
  }

  add(records, t = this.now()) {
    if (!records?.length) return;
    const idx = Math.floor(t / this.bucketMs);
    let b = this.buckets[this.buckets.length - 1];
    if (!b || b.idx !== idx) {
      b = { idx, convs: new Map() };
      this.buckets.push(b);
      this.prune(t);
    }
    for (const r of records) {
      const c = conversationOf(r);
      const key = `${c.client}|${c.server}|${c.proto}|${c.port}`;
      let e = b.convs.get(key);
      if (!e) {
        if (b.convs.size >= this.maxConversations) { this.dropped++; continue; }
        e = { ...c, bytes: 0, packets: 0 };
        b.convs.set(key, e);
      }
      e.bytes += r.bytes || 0;
      e.packets += r.packets || 0;
    }
  }

  /** Supprime les tranches entierement sorties de la fenetre. */
  prune(t = this.now()) {
    const limit = t - this.windowMs;
    while (this.buckets.length && (this.buckets[0].idx + 1) * this.bucketMs <= limit) this.buckets.shift();
  }

  /** Snapshot : conversations triees par debit decroissant. */
  snapshot(t = this.now()) {
    this.prune(t);
    const sums = new Map();
    for (const b of this.buckets) {
      for (const [k, e] of b.convs) {
        const s = sums.get(k);
        if (s) { s.bytes += e.bytes; s.packets += e.packets; } else sums.set(k, { ...e });
      }
    }
    // au demarrage, la fenetre n'est pas encore pleine
    const spanSec = Math.min(this.windowMs, Math.max(1000, t - this.startedAt)) / 1000;
    const flows = [...sums.values()]
      .map((e) => ({
        src: { ip: e.client },
        dst: { ip: e.server },
        proto: protoName(e.proto),
        port: e.port,
        app: e.port != null ? appForPort(e.port) : null,
        bps: Math.round((e.bytes * 8) / spanSec),
        pps: Math.round((e.packets / spanSec) * 100) / 100,
      }))
      .sort((a, b) => b.bps - a.bps)
      .slice(0, this.maxFlows);
    return { entities: [], links: [], flows };
  }
}

class NetflowCollector extends Collector {
  constructor(cfg, ctx) {
    super(cfg, ctx);
    this.port = Number(cfg.port ?? 2055);
    this.bindAddress = cfg.bind || '0.0.0.0';
    this.sampling = Number(cfg.sampling) > 0 ? Number(cfg.sampling) : 1;
    this.now = ctx.now || Date.now;
    this.templates = new TemplateCache();
    this.agg = new FlowAggregator({ windowSec: cfg.window ?? 60, maxFlows: cfg.maxFlows ?? 500, now: this.now });
    this.exporters = new Map();
    this.packets = 0;
    this.records = 0;
    this.parseErrors = 0;
    this.socket = null;
    this.listening = false;
    this.socketError = null;
  }

  defaultInterval() { return 10; }

  async start() {
    await this.openSocket();
    return super.start();
  }

  async stop() {
    await super.stop();
    const sock = this.socket;
    this.socket = null;
    this.listening = false;
    if (sock) await new Promise((resolve) => { try { sock.close(() => resolve()); } catch { resolve(); } });
  }

  openSocket() {
    return new Promise((resolve) => {
      const sock = dgram.createSocket({ type: this.bindAddress.includes(':') ? 'udp6' : 'udp4' });
      this.socket = sock;
      sock.on('message', (msg, rinfo) => this.onMessage(msg, rinfo.address));
      sock.on('error', (err) => {
        // journalise une seule fois la meme erreur (nouvelle tentative a chaque cycle)
        if (err.message !== this.socketError?.message) this.log.error(`socket UDP ${this.bindAddress}:${this.port} : ${err.message}`);
        this.socketError = err;
        if (!this.listening) {
          try { sock.close(); } catch { /* deja fermee */ }
          if (this.socket === sock) this.socket = null;
          resolve();
        }
      });
      sock.once('listening', () => {
        this.listening = true;
        this.socketError = null;
        // tampon de reception plus grand pour absorber les rafales
        try { sock.setRecvBufferSize(4 * 1024 * 1024); } catch { /* refuse par l'OS */ }
        this.log.info(`reception NetFlow/IPFIX sur ${this.bindAddress}:${this.port}/udp`);
        resolve();
      });
      sock.bind(this.port, this.bindAddress);
    });
  }

  /** Traitement d'un datagramme (public pour les tests). */
  onMessage(msg, address) {
    this.packets++;
    let ex = this.exporters.get(address);
    if (!ex) {
      ex = { address, packets: 0, records: 0, errors: 0, missingTemplate: 0, version: null, lastSeen: null, lastError: null };
      this.exporters.set(address, ex);
    }
    ex.packets++;
    ex.lastSeen = new Date(this.now()).toISOString();
    try {
      const res = parsePacket(msg, { exporter: address, templates: this.templates, sampling: this.sampling });
      ex.version = res.version;
      ex.records += res.records.length;
      ex.missingTemplate += res.missingTemplate;
      this.records += res.records.length;
      this.agg.add(res.records);
    } catch (err) {
      ex.errors++;
      ex.lastError = err.message;
      this.parseErrors++;
      if (ex.errors === 1) this.log.warn(`paquet invalide de ${address} : ${err.message}`);
    }
  }

  async poll() {
    if (!this.listening && !this.stopped) await this.openSocket();
    if (!this.listening) {
      throw new Error(`port UDP ${this.bindAddress}:${this.port} non ouvert${this.socketError ? ` : ${this.socketError.message}` : ''}`);
    }
    return this.agg.snapshot();
  }

  status() {
    return {
      ...super.status(),
      port: this.port,
      bind: this.bindAddress,
      packets: this.packets,
      records: this.records,
      parseErrors: this.parseErrors,
      exporters: [...this.exporters.values()].map((e) => ({ ...e, templates: this.templates.countFor(e.address) })),
    };
  }
}

export default function create(cfg, ctx) {
  return new NetflowCollector(cfg, ctx);
}
