// Collecteur Proxmox VE (API REST /api2/json).
//
// Publie trois niveaux : serveur physique (noeud /hw), hyperviseur (noeud),
// VM (qemu) et conteneurs (lxc). Authentification par jeton d'API (conseille)
// ou par identifiant / mot de passe (ticket PVEAuthCookie).
import { Collector } from './base.js';
import { httpRequest } from '../util/http-client.js';
import { buildKeys, normalizeMac, ipKey, worstStatus } from '../../shared/model.js';

const GiB = 1024 ** 3;
const TICKET_TTL_MS = 90 * 60 * 1000; // ticket PVE valable 2 h

function round1(v) { return Math.round(v * 10) / 10; }

function pct(used, max) { return max > 0 && used != null ? round1((used / max) * 100) : undefined; }

function uniq(list) { return [...new Set(list.filter(Boolean))]; }

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

/** Client API Proxmox VE. */
export class ProxmoxClient {
  constructor(cfg) {
    this.base = String(cfg.url || '').replace(/\/+$/, '').replace(/\/api2\/json$/, '');
    this.tokenId = cfg.tokenId || null;
    this.tokenSecret = cfg.tokenSecret || '';
    this.username = cfg.username || null;
    this.password = cfg.password || '';
    this.tls = { insecure: !!cfg.insecure, ca: cfg.ca || undefined, timeoutMs: (Number(cfg.requestTimeout) || 30) * 1000 };
    this.ticket = null;
    this.ticketAt = 0;
  }

  async login() {
    const res = await httpRequest(`${this.base}/api2/json/access/ticket`, {
      method: 'POST', form: { username: this.username, password: this.password }, ...this.tls,
    });
    this.ticket = res.body?.data?.ticket || null;
    if (!this.ticket) throw new Error('Proxmox : ticket d\'authentification absent');
    this.ticketAt = Date.now();
  }

  async authHeaders() {
    if (this.tokenId) return { Authorization: `PVEAPIToken=${this.tokenId}=${this.tokenSecret}` };
    if (!this.username) throw new Error('proxmox : tokenId/tokenSecret ou username/password requis');
    if (!this.ticket || Date.now() - this.ticketAt > TICKET_TTL_MS) await this.login();
    return { Cookie: `PVEAuthCookie=${this.ticket}` };
  }

  /** GET /api2/json<path> -> champ data. */
  async get(path, retry = true) {
    if (!this.base) throw new Error('proxmox : "url" manquant');
    const headers = await this.authHeaders();
    try {
      const res = await httpRequest(`${this.base}/api2/json${path}`, { headers, ...this.tls });
      return res.body?.data;
    } catch (err) {
      // ticket expire : nouvelle authentification puis une seule nouvelle tentative
      if (err.status === 401 && retry && !this.tokenId) {
        this.ticket = null;
        return this.get(path, false);
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Analyse de la configuration des invites (fonctions pures)
// ---------------------------------------------------------------------------

/**
 * Carte reseau d'une VM ou d'un conteneur :
 *   qemu : 'virtio=BC:24:11:AA:BB:CC,bridge=vmbr0,tag=20,firewall=1'
 *   lxc  : 'name=eth0,bridge=vmbr0,hwaddr=BC:24:11:AA:BB:CC,ip=10.0.0.5/24,tag=20,type=veth'
 */
export function parseNetConfig(str) {
  const out = { mac: null, model: null, bridge: null, vlan: null, ip: null, ip6: null, ifname: null };
  if (!str) return out;
  for (const part of String(str).split(',')) {
    const i = part.indexOf('=');
    const k = (i < 0 ? part : part.slice(0, i)).trim();
    const v = i < 0 ? '' : part.slice(i + 1).trim();
    if (k === 'hwaddr' || k === 'macaddr') out.mac = normalizeMac(v) || out.mac;
    else if (k === 'bridge') out.bridge = v;
    else if (k === 'tag') out.vlan = Number(v) || null;
    else if (k === 'name') out.ifname = v;
    else if (k === 'ip') out.ip = /^[\d.]+(\/\d+)?$/.test(v) ? v.split('/')[0] : null;
    else if (k === 'ip6') out.ip6 = v.includes(':') ? v.split('/')[0] : null;
    else if (!out.model && !['firewall', 'link_down', 'mtu', 'queues', 'rate', 'trunks', 'type', 'gw', 'gw6'].includes(k)) {
      // modele de carte qemu : "virtio=MAC" (ou "virtio" seul)
      const m = normalizeMac(v);
      if (m || i < 0) { out.model = k; if (m) out.mac = m; }
    }
  }
  return out;
}

/** smbios1 : 'uuid=6b6f...,manufacturer=...' -> uuid. */
export function parseSmbiosUuid(str) {
  const m = String(str || '').match(/(?:^|,)uuid=([0-9a-fA-F-]{32,36})/);
  return m ? m[1].toLowerCase() : null;
}

/** Interfaces vues de l'invite (agent qemu ou /lxc/{id}/interfaces) -> [{name, mac, ips}]. */
export function parseGuestInterfaces(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.result) ? data.result : [];
  return list.map((i) => {
    const ips = [];
    for (const a of i['ip-addresses'] || []) ips.push(a['ip-address']);
    for (const k of ['inet', 'inet6']) if (i[k]) ips.push(...String(i[k]).split(/[\s,]+/));
    return {
      name: i.name || null,
      mac: normalizeMac(i['hardware-address'] || i.hwaddr),
      ips: uniq(ips.map((ip) => String(ip).split('/')[0]).filter((ip) => ipKey(ip))),
    };
  }).filter((i) => i.name !== 'lo');
}

/** Nom de VM utilisable comme nom d'hote (etiquette DNS). */
function dnsName(name) {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(String(name || '')) ? name : null;
}

// ---------------------------------------------------------------------------
// Construction du snapshot
// ---------------------------------------------------------------------------

/**
 * @param {string} name  nom de la source (prefixe des id)
 * @param {{status, resources, configs?, agent?, rates?}} d
 */
export function buildProxmoxSnapshot(name, d) {
  const prefix = `proxmox:${name}:`;
  const status = d.status || [];
  const resources = d.resources || [];
  const cluster = status.find((s) => s.type === 'cluster')?.name || null;
  const nodeInfo = {};
  for (const s of status) if (s.type === 'node') nodeInfo[s.name] = s;

  const storages = {};
  for (const s of resources) {
    if (s.type !== 'storage' || !(s.maxdisk > 0)) continue;
    (storages[s.node] ||= []).push({ name: s.storage, usedPct: pct(s.disk, s.maxdisk), shared: !!s.shared });
  }

  const entities = [];
  for (const n of resources.filter((r) => r.type === 'node')) {
    const node = n.node;
    const info = nodeInfo[node] || {};
    const ip = info.ip || null;
    const online = n.status ? n.status === 'online' : !!info.online;
    const hwId = `${prefix}${node}/hw`;
    const memGB = n.maxmem ? round1(n.maxmem / GiB) : null;
    entities.push({
      id: hwId,
      type: 'server',
      name: node,
      keys: buildKeys({ hostname: node, ip }),
      status: online ? 'ok' : 'unknown',
      attrs: { ip: ip ? [ip] : [], cpuThreads: n.maxcpu ?? null, memGB },
      metrics: {},
    });
    const st = (storages[node] || []).sort((a, b) => a.name.localeCompare(b.name));
    const hv = {
      id: `${prefix}${node}`,
      type: 'hypervisor',
      name: node,
      parent: hwId,
      keys: buildKeys({ hostname: node, ip }),
      status: online ? 'ok' : 'critical',
      attrs: { hypervisor: 'Proxmox VE', cluster, cpuCores: n.maxcpu ?? null, memGB, ip: ip ? [ip] : [], storages: st },
      metrics: {},
    };
    if (!online) hv.statusText = `Noeud ${n.status || 'hors ligne'}`;
    else {
      const full = st.filter((s) => s.usedPct > 90);
      if (full.length) {
        hv.status = worstStatus(hv.status, 'warning');
        hv.statusText = `Stockage presque plein : ${full.map((s) => `${s.name} (${s.usedPct} %)`).join(', ')}`;
      }
      if (n.cpu != null) hv.metrics.cpu = round1(n.cpu * 100);
      const mem = pct(n.mem, n.maxmem);
      if (mem != null) hv.metrics.mem = mem;
      const disk = pct(n.disk, n.maxdisk);
      if (disk != null) hv.metrics.disk = disk;
      if (n.uptime != null) hv.metrics.uptimeS = n.uptime;
    }
    entities.push(hv);
  }

  for (const g of resources) {
    if ((g.type !== 'qemu' && g.type !== 'lxc') || g.template) continue;
    const id = `${g.type}/${g.vmid}`;
    const conf = d.configs?.[id] || {};
    const nets = Object.keys(conf)
      .filter((k) => /^net\d+$/.test(k))
      .sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)))
      .map((k) => ({ name: k, ...parseNetConfig(conf[k]) }));
    const guestIfs = d.agent?.[id] || [];
    const macs = uniq([...nets.map((n) => n.mac), ...guestIfs.map((i) => i.mac)]);
    const ips = uniq([...nets.flatMap((n) => [n.ip, n.ip6]), ...guestIfs.flatMap((i) => i.ips)]);
    const hostname = g.type === 'lxc' ? dnsName(conf.hostname) || dnsName(g.name) : dnsName(g.name);
    const running = g.status === 'running';
    const e = {
      id: `${prefix}${id}`,
      type: g.type === 'lxc' ? 'container' : 'vm',
      name: g.name || id,
      parent: `${prefix}${g.node}`,
      keys: buildKeys({ hostname, uuid: g.type === 'qemu' ? parseSmbiosUuid(conf.smbios1) : null, mac: macs, ip: ips }),
      status: running ? 'ok' : g.status === 'stopped' ? 'off' : 'unknown',
      attrs: {
        vmid: g.vmid,
        node: g.node,
        cluster,
        powerState: g.status || null,
        cpuCores: g.maxcpu ?? null,
        memGB: g.maxmem ? round1(g.maxmem / GiB) : null,
        ostype: conf.ostype || null,
        networks: nets.map((n) => ({ name: n.name, mac: n.mac, bridge: n.bridge, vlan: n.vlan, model: n.model || (n.ifname ? `veth ${n.ifname}` : null) })),
        vlan: nets.find((n) => n.vlan != null)?.vlan ?? null,
        ip: ips,
        mac: macs,
      },
      metrics: {},
    };
    if (running) {
      if (g.cpu != null) e.metrics.cpu = round1(g.cpu * 100);
      const mem = pct(g.mem, g.maxmem);
      if (mem != null) e.metrics.mem = mem;
      // disque : significatif pour les conteneurs seulement (0 pour qemu)
      if (g.type === 'lxc') {
        const disk = pct(g.disk, g.maxdisk);
        if (disk != null) e.metrics.disk = disk;
      }
      if (g.uptime != null) e.metrics.uptimeS = g.uptime;
      const r = d.rates?.[id];
      if (r?.rxBps != null) e.metrics.rxBps = r.rxBps;
      if (r?.txBps != null) e.metrics.txBps = r.txBps;
    }
    entities.push(e);
  }
  return { entities, links: [], flows: [] };
}

/** Debits reseau des invites a partir des compteurs cumules netin/netout. */
export function guestRates(prev, cur, dtSec) {
  const out = {};
  if (!prev || !(dtSec > 0)) return out;
  for (const [id, c] of Object.entries(cur)) {
    const p = prev[id];
    if (!p || c.uptime < p.uptime) continue; // redemarrage : compteurs remis a zero
    const dIn = c.netin >= p.netin ? c.netin - p.netin : null;
    const dOut = c.netout >= p.netout ? c.netout - p.netout : null;
    out[id] = {
      rxBps: dIn == null ? null : Math.round((dIn * 8) / dtSec),
      txBps: dOut == null ? null : Math.round((dOut * 8) / dtSec),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Collecteur
// ---------------------------------------------------------------------------

class ProxmoxCollector extends Collector {
  constructor(cfg, ctx) {
    super(cfg, ctx);
    this.client = new ProxmoxClient(cfg);
    this.configs = new Map(); // "qemu/100" -> {t, conf}
    this.counters = null;     // {t, values}
  }

  defaultInterval() { return 30; }

  async poll() {
    const c = this.client;
    const cfg = this.cfg;
    const status = (await c.get('/cluster/status')) || [];
    const resources = (await c.get('/cluster/resources')) || [];
    const guests = resources.filter((r) => (r.type === 'qemu' || r.type === 'lxc') && !r.template && r.node);

    // configuration des invites (MAC, VLAN, uuid SMBIOS), rafraichie toutes les configRefresh s
    if (cfg.vmConfig !== false) {
      const now = Date.now();
      const ttl = (Number(cfg.configRefresh) || 300) * 1000;
      const ids = new Set(guests.map((g) => `${g.type}/${g.vmid}`));
      for (const id of this.configs.keys()) if (!ids.has(id)) this.configs.delete(id);
      const stale = guests.filter((g) => !(this.configs.get(`${g.type}/${g.vmid}`)?.t > now - ttl));
      await mapLimit(stale, 6, async (g) => {
        try {
          const conf = await c.get(`/nodes/${encodeURIComponent(g.node)}/${g.type}/${g.vmid}/config`);
          this.configs.set(`${g.type}/${g.vmid}`, { t: now, conf: conf || {} });
        } catch { /* invite ignore */ }
      });
    }
    const configs = {};
    for (const [id, v] of this.configs) configs[id] = v.conf;

    // adresses vues de l'invite (agent qemu / interfaces lxc)
    const agent = {};
    if (cfg.guestAgent) {
      const running = guests.filter((g) => {
        if (g.status !== 'running') return false;
        if (g.type === 'lxc') return true;
        // agent qemu declare dans la configuration (si connue)
        const conf = configs[`qemu/${g.vmid}`];
        return !conf || /(^|,)(enabled=)?1(,|$)/.test(String(conf.agent ?? ''));
      });
      await mapLimit(running, 6, async (g) => {
        const path = g.type === 'qemu'
          ? `/nodes/${encodeURIComponent(g.node)}/qemu/${g.vmid}/agent/network-get-interfaces`
          : `/nodes/${encodeURIComponent(g.node)}/lxc/${g.vmid}/interfaces`;
        try { agent[`${g.type}/${g.vmid}`] = parseGuestInterfaces(await c.get(path)); } catch { /* agent absent */ }
      });
    }

    // debits reseau entre deux releves
    const now = Date.now();
    const values = {};
    for (const g of guests) {
      if (g.status === 'running' && g.netin != null) values[`${g.type}/${g.vmid}`] = { netin: g.netin, netout: g.netout, uptime: g.uptime ?? 0 };
    }
    const rates = this.counters ? guestRates(this.counters.values, values, (now - this.counters.t) / 1000) : {};
    this.counters = { t: now, values };

    return buildProxmoxSnapshot(this.name, { status, resources, configs, agent, rates });
  }
}

export default function create(cfg, ctx) {
  return new ProxmoxCollector(cfg, ctx);
}
