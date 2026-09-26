// Collecteur VMware vCenter : API REST vSphere Automation (vSphere 7+), repli sur
// l'ancienne API /rest (reponses {value: ...}), metriques via VI/JSON (8.0U1+).
//
// Publie trois niveaux : serveur physique (ESXi /hw), hyperviseur, VM.
import { Collector } from './base.js';
import { httpRequest } from '../util/http-client.js';
import { buildKeys, isIPv4, normalizeMac, worstStatus } from '../../shared/model.js';

function unquote(v) {
  if (v == null) return null;
  return String(v).trim().replace(/^"(.*)"$/, '$1') || null;
}

function round1(v) { return Math.round(v * 10) / 10; }

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

/** Client vCenter : session REST (+ session VI/JSON si necessaire). */
export class VsphereClient {
  constructor(cfg, log) {
    this.base = String(cfg.url || '').replace(/\/+$/, '');
    this.username = cfg.username ?? '';
    this.password = cfg.password ?? '';
    this.tls = { insecure: !!cfg.insecure, ca: cfg.ca || undefined, timeoutMs: (Number(cfg.requestTimeout) || 30) * 1000 };
    this.release = cfg.viJsonRelease || '8.0.1.0';
    this.log = log;
    this.token = null;
    this.mode = null;              // 'api' (vSphere 7+) | 'rest' (ancienne API)
    this.viToken = null;           // session VI/JSON dediee (si la session REST n'est pas acceptee)
    this.viState = 'unknown';      // unknown | ok | disabled
  }

  async login() {
    if (!this.base) throw new Error('vsphere : "url" manquant');
    const headers = { Authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}` };
    try {
      const res = await httpRequest(`${this.base}/api/session`, { method: 'POST', headers, ...this.tls });
      this.token = unquote(res.body);
      this.mode = 'api';
    } catch (err) {
      if (err.status !== 404) throw err;
      const res = await httpRequest(`${this.base}/rest/com/vmware/cis/session`, { method: 'POST', headers, ...this.tls });
      this.token = unquote(res.body?.value);
      this.mode = 'rest';
    }
    if (!this.token) throw new Error('vCenter : jeton de session absent');
  }

  async logout() {
    if (!this.token) return;
    const path = this.mode === 'rest' ? '/rest/com/vmware/cis/session' : '/api/session';
    const token = this.token;
    this.token = null;
    await httpRequest(this.base + path, { method: 'DELETE', headers: { 'vmware-api-session-id': token }, ...this.tls, timeoutMs: 5000 });
  }

  async request(path, retry = true) {
    if (!this.token) await this.login();
    try {
      return await httpRequest(this.base + path, { headers: { 'vmware-api-session-id': this.token }, ...this.tls });
    } catch (err) {
      // session expiree : nouvelle ouverture puis une seule nouvelle tentative
      if (err.status === 401 && retry) {
        this.token = null;
        return this.request(path, false);
      }
      throw err;
    }
  }

  /** GET /vcenter/... : filtres adaptes ('clusters' -> 'filter.clusters' en mode /rest). */
  async get(resource, filters = {}) {
    if (!this.token) await this.login();
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) q.append(this.mode === 'rest' ? `filter.${k}` : k, v);
    const qs = q.toString();
    const res = await this.request(`/${this.mode}${resource}${qs ? `?${qs}` : ''}`);
    return this.mode === 'rest' ? res.body?.value : res.body;
  }

  /**
   * Propriete d'un objet via VI/JSON (/sdk/vim25/{release}/{type}/{moid}/{prop}).
   * Retourne null si l'API est indisponible (desactivee au premier echec 400/401/403/404).
   */
  async vi(type, moid, prop, retry = true) {
    if (this.viState === 'disabled') return null;
    const path = `/sdk/vim25/${this.release}/${type}/${encodeURIComponent(moid)}/${prop}`;
    try {
      const res = await httpRequest(this.base + path, { headers: { 'vmware-api-session-id': this.viToken || this.token }, ...this.tls });
      this.viState = 'ok';
      return res.body;
    } catch (err) {
      if (err.status === 401 && retry && await this.viLogin()) return this.vi(type, moid, prop, false);
      if (this.viState === 'unknown' && [400, 401, 403, 404, 501].includes(err.status)) {
        this.viState = 'disabled';
        this.log?.info(`API VI/JSON ${this.release} indisponible (${err.message}) : metriques et numeros de serie desactives`);
        return null;
      }
      throw err;
    }
  }

  /** Session VI/JSON dediee (SessionManager.Login). */
  async viLogin() {
    try {
      const res = await httpRequest(`${this.base}/sdk/vim25/${this.release}/SessionManager/SessionManager/Login`, {
        method: 'POST', body: { userName: this.username, password: this.password }, ...this.tls,
      });
      const tok = res.headers['vmware-api-session-id'];
      if (tok) { this.viToken = tok; return true; }
    } catch { /* API absente ou refusee */ }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Construction du snapshot (fonctions pures)
// ---------------------------------------------------------------------------

/** Numero de serie (service tag) dans hardware.otherIdentifyingInfo. */
export function serviceTag(info) {
  if (!Array.isArray(info)) return null;
  const pick = (key) => info.find((i) => i?.identifierType?.key === key && i.identifierValue && String(i.identifierValue).trim());
  const found = pick('SerialNumberTag') || pick('ServiceTag');
  return found ? String(found.identifierValue).trim() : null;
}

const ALARM_STATUS = { red: 'critical', yellow: 'warning' };

/** Statut d'un hote ESXi. */
export function hostStatus(connection, power, maintenance) {
  if (connection === 'NOT_RESPONDING' || connection === 'DISCONNECTED') {
    return { status: 'critical', statusText: connection === 'DISCONNECTED' ? 'Hote deconnecte de vCenter' : 'Hote ne repond pas' };
  }
  if (power === 'POWERED_OFF') return { status: 'off', statusText: 'Hote eteint' };
  if (power === 'STANDBY') return { status: 'off', statusText: 'Hote en veille' };
  if (maintenance) return { status: 'warning', statusText: 'Mode maintenance' };
  if (connection === 'CONNECTED' && power === 'POWERED_ON') return { status: 'ok' };
  return { status: 'unknown' };
}

export function vmStatus(power) {
  if (power === 'POWERED_ON') return 'ok';
  if (power === 'POWERED_OFF' || power === 'SUSPENDED') return 'off';
  return 'unknown';
}

/** Cartes reseau d'une VM (/api : objet par cle, /rest : [{key, value}]). */
function nicList(nics) {
  if (!nics) return [];
  const list = Array.isArray(nics) ? nics.map((n) => n?.value ?? n) : Object.values(nics);
  return list.filter(Boolean);
}

function applyAlarm(e, overall) {
  const s = ALARM_STATUS[overall];
  if (!s) return;
  const worst = worstStatus(e.status, s);
  if (worst !== e.status) {
    e.status = worst;
    e.statusText = `Alarme vCenter (${overall})`;
  }
}

/**
 * @param {string} name  nom de la source (prefixe des id)
 * @param {{hosts, vms, hostCluster?, hostSummaries?, vmSummaries?, identities?, details?}} d
 */
export function buildVsphereSnapshot(name, d) {
  const prefix = `vsphere:${name}:`;
  const entities = [];
  const hostNames = {};
  for (const h of d.hosts || []) {
    const s = d.hostSummaries?.[h.host] || null;
    const hw = s?.hardware || {};
    const qs = s?.quickStats || {};
    const hostName = String(h.name || h.host);
    const byIp = isIPv4(hostName) || hostName.includes(':');
    const ident = byIp ? { ip: hostName } : { hostname: hostName };
    const serial = serviceTag(hw.otherIdentifyingInfo);
    const memGB = hw.memorySize ? round1(hw.memorySize / 1024 ** 3) : null;
    const hwId = `${prefix}${h.host}/hw`;
    const hvId = `${prefix}${h.host}`;
    hostNames[h.host] = hostName;

    entities.push({
      id: hwId,
      type: 'server',
      name: hostName,
      keys: buildKeys({ ...ident, serial, uuid: hw.uuid }),
      status: h.connection_state === 'CONNECTED' ? (h.power_state === 'POWERED_ON' ? 'ok' : h.power_state ? 'off' : 'unknown') : 'unknown',
      attrs: {
        vendor: hw.vendor || null,
        model: hw.model || null,
        serial,
        uuid: hw.uuid || null,
        cpuModel: hw.cpuModel || null,
        cpuSockets: hw.numCpuPkgs ?? null,
        cpuCores: hw.numCpuCores ?? null,
        memGB,
        ip: byIp ? [hostName] : [],
      },
      metrics: {},
    });

    const st = hostStatus(h.connection_state, h.power_state, s?.runtime?.inMaintenanceMode);
    const hv = {
      id: hvId,
      type: 'hypervisor',
      name: hostName,
      parent: hwId,
      keys: buildKeys(ident),
      status: st.status,
      attrs: {
        hypervisor: 'VMware ESXi',
        version: s?.config?.product?.fullName || null,
        cluster: d.hostCluster?.[h.host] || null,
        connectionState: h.connection_state || null,
        powerState: h.power_state || null,
        maintenance: s?.runtime?.inMaintenanceMode ?? null,
        cpuCores: hw.numCpuCores ?? null,
        memGB,
        ip: byIp ? [hostName] : [],
      },
      metrics: {},
    };
    if (st.statusText) hv.statusText = st.statusText;
    if (st.status === 'ok') applyAlarm(hv, s?.overallStatus);
    if (qs.overallCpuUsage != null && hw.cpuMhz && hw.numCpuCores) hv.metrics.cpu = round1((qs.overallCpuUsage / (hw.cpuMhz * hw.numCpuCores)) * 100);
    if (qs.overallMemoryUsage != null && hw.memorySize) hv.metrics.mem = round1((qs.overallMemoryUsage / (hw.memorySize / 1024 ** 2)) * 100);
    if (qs.uptime != null) hv.metrics.uptimeS = qs.uptime;
    entities.push(hv);
  }

  for (const vm of d.vms || []) {
    const sum = d.vmSummaries?.[vm.vm] || null;
    if (sum?.config?.template) continue;
    const idn = d.identities?.[vm.vm] || null;
    const det = d.details?.[vm.vm] || null;
    const nics = nicList(det?.nics);
    const macs = uniq(nics.map((n) => normalizeMac(n.mac_address)));
    const ips = uniq([idn?.ip_address, sum?.guest?.ipAddress]);
    const guestHost = idn?.host_name || sum?.guest?.hostName || null;
    const uuid = sum?.config?.uuid || det?.identity?.bios_uuid || null;
    const memMB = vm.memory_size_MiB ?? sum?.config?.memorySizeMB ?? null;
    const power = vm.power_state;
    const qs = sum?.quickStats || {};
    const e = {
      id: `${prefix}${vm.vm}`,
      type: 'vm',
      name: vm.name || vm.vm,
      parent: `${prefix}${vm.hostId}`,
      keys: buildKeys({ hostname: guestHost, uuid, mac: macs, ip: ips }),
      status: vmStatus(power),
      attrs: {
        powerState: power || null,
        cpuCores: vm.cpu_count ?? sum?.config?.numCpu ?? null,
        memGB: memMB != null ? round1(memMB / 1024) : null,
        guestOS: idn?.full_name?.default_message || sum?.config?.guestFullName || sum?.guest?.guestFullName || det?.guest_OS || null,
        guestHostname: guestHost,
        ip: ips,
        mac: macs,
        networks: nics.map((n) => ({ mac: normalizeMac(n.mac_address), network: n.backing?.network_name || null })),
        uuid,
        instanceUuid: sum?.config?.instanceUuid || det?.identity?.instance_uuid || null,
        cluster: d.hostCluster?.[vm.hostId] || null,
        host: hostNames[vm.hostId] || null,
      },
      metrics: {},
    };
    if (power === 'POWERED_ON') {
      applyAlarm(e, sum?.overallStatus);
      const maxCpu = sum?.runtime?.maxCpuUsage;
      if (qs.overallCpuUsage != null && maxCpu > 0) e.metrics.cpu = round1((qs.overallCpuUsage / maxCpu) * 100);
      const cfgMem = sum?.config?.memorySizeMB ?? memMB;
      if (qs.guestMemoryUsage != null && cfgMem > 0) e.metrics.mem = round1((qs.guestMemoryUsage / cfgMem) * 100);
      if (qs.uptimeSeconds != null) e.metrics.uptimeS = qs.uptimeSeconds;
    }
    entities.push(e);
  }
  return { entities, links: [], flows: [] };
}

// ---------------------------------------------------------------------------
// Collecteur
// ---------------------------------------------------------------------------

class VsphereCollector extends Collector {
  constructor(cfg, ctx) {
    super(cfg, ctx);
    this.client = new VsphereClient(cfg, this.log);
    this.details = new Map(); // vm -> {t, d} (GET /vcenter/vm/{vm}, rafraichi toutes les detailsRefresh s)
  }

  defaultInterval() { return 60; }

  async stop() {
    await super.stop();
    this.client.logout().catch(() => { /* session deja fermee */ });
  }

  async poll() {
    const c = this.client;
    const cfg = this.cfg;
    const clusters = (await c.get('/vcenter/cluster')) || [];
    const hosts = (await c.get('/vcenter/host')) || [];
    const hostCluster = {};
    for (const cl of clusters) {
      for (const h of (await c.get('/vcenter/host', { clusters: cl.cluster })) || []) hostCluster[h.host] = cl.name;
    }
    const perHost = await mapLimit(hosts, 4, async (h) => {
      const list = (await c.get('/vcenter/vm', { hosts: h.host })) || [];
      return list.map((vm) => ({ ...vm, hostId: h.host }));
    });
    const vms = perHost.flat();

    const hostSummaries = {};
    const vmSummaries = {};
    if (cfg.quickStats !== false && hosts.length) {
      const one = async (h) => {
        try { hostSummaries[h.host] = await c.vi('HostSystem', h.host, 'summary'); } catch { /* hote ignore */ }
      };
      // le premier appel sert de sonde (API VI/JSON disponible ?)
      await one(hosts[0]);
      if (c.viState !== 'disabled') await mapLimit(hosts.slice(1), 8, one);
      if (c.viState === 'ok') {
        await mapLimit(vms, 8, async (vm) => {
          try { vmSummaries[vm.vm] = await c.vi('VirtualMachine', vm.vm, 'summary'); } catch { /* VM ignoree */ }
        });
      }
    }

    const identities = {};
    if (cfg.guestInfo !== false) {
      await mapLimit(vms.filter((v) => v.power_state === 'POWERED_ON'), 8, async (vm) => {
        try { identities[vm.vm] = await c.get(`/vcenter/vm/${encodeURIComponent(vm.vm)}/guest/identity`); } catch { /* VMware Tools absent */ }
      });
    }

    if (cfg.vmDetails !== false) {
      const now = Date.now();
      const ttl = (Number(cfg.detailsRefresh) || 900) * 1000;
      const ids = new Set(vms.map((v) => v.vm));
      for (const id of this.details.keys()) if (!ids.has(id)) this.details.delete(id);
      const stale = vms.filter((v) => !(this.details.get(v.vm)?.t > now - ttl));
      await mapLimit(stale, 8, async (vm) => {
        try { this.details.set(vm.vm, { t: now, d: await c.get(`/vcenter/vm/${encodeURIComponent(vm.vm)}`) }); } catch { /* ignore */ }
      });
    }
    const details = {};
    for (const [id, v] of this.details) details[id] = v.d;

    return buildVsphereSnapshot(this.name, { hosts, vms, hostCluster, hostSummaries, vmSummaries, identities, details });
  }

  status() {
    return { ...super.status(), api: this.client.mode, viJson: this.client.viState };
  }
}

export default function create(cfg, ctx) {
  return new VsphereCollector(cfg, ctx);
}
