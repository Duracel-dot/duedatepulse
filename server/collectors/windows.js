// Collecteur "systeme" Windows : CIM via scripts/ps/windows.ps1
// (WinRM pour les cibles distantes, acces local direct pour 'localhost').
//
// cfg : { type:'windows', targets:['localhost','srv-ad01'], credential?:{username,password},
//         flows?:false, interval:60, timeout:120, concurrency:4, opTimeoutSec:20,
//         protocol:'wsman'|'dcom', diskWarnPct:null (seuils du magasin), serviceExclude:[], maxFlows:5000,
//         precheck:true, winrmPort:5985, useSsl:false }
import os from 'node:os';
import net from 'node:net';
import { Collector } from './base.js';
import { runPowerShellScript, asArray, psDate } from '../util/powershell.js';
import {
  buildKeys, hostKey, ipKey, uuidKey, normalizeMac, isIPv4, appForPort,
} from '../../shared/model.js';

const GB = 1024 ** 3;

// ---------------------------------------------------------------------------
// Utilitaires partages avec hyperv.js
// ---------------------------------------------------------------------------

export function isLocalTarget(name, localName = os.hostname()) {
  const n = String(name ?? '').trim().toLowerCase();
  if (!n || n === 'localhost' || n === '.' || n === '127.0.0.1' || n === '::1') return true;
  const local = String(localName || '').trim().toLowerCase().split('.')[0];
  return !!local && (n === local || n.startsWith(`${local}.`));
}

/** Identifiant court et stable d'une cible : nom court en minuscules, IP telle quelle. */
export function targetSlug(name, localName = os.hostname()) {
  if (isLocalTarget(name, localName)) return String(localName || 'localhost').trim().toLowerCase().split('.')[0];
  const s = String(name).trim().toLowerCase();
  if (isIPv4(s) || s.includes(':')) return s;
  return s.split('.')[0];
}

/** Liste de cibles dedoublonnee (par identifiant court). */
export function normalizeTargets(list, localName = os.hostname()) {
  const seen = new Set();
  const out = [];
  for (const t of asArray(list)) {
    const name = String(t ?? '').trim();
    if (!name) continue;
    const slug = targetSlug(name, localName);
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push(name);
  }
  return out;
}

const VM_RX = /vmware|virtualbox|innotek|\bkvm\b|qemu|\bxen\b|proxmox|hvm domu|parallels|bochs|nutanix|openstack|ovirt|rhev|amazon ec2|google compute engine/i;

/** Detection d'une machine virtuelle a partir du fabricant / modele (Win32_ComputerSystem). */
export function isVirtualMachine(manufacturer, model) {
  const man = String(manufacturer ?? '');
  const mod = String(model ?? '');
  if (/microsoft/i.test(man) && /virtual machine/i.test(mod)) return true;
  return VM_RX.test(`${man} ${mod}`);
}

/**
 * Numero de serie utilisable comme cle de correlation. Pour une VM, seuls les
 * numeros propres a la VM sont gardes (VMware-..., format Hyper-V).
 */
export function serialForKey(serial, isVm) {
  const s = clean(serial);
  if (!s) return null;
  if (!isVm) return s;
  if (/^vmware-/i.test(s)) return s;
  if (/^\d{4}-\d{4}-\d{4}-\d{4}-\d{4}-\d{4}-\d{2}$/.test(s)) return s;
  return null;
}

// UUID SMBIOS generiques (cartes meres "par defaut") : jamais utilises comme cle
const BAD_UUIDS = new Set(['ffffffff-ffff-ffff-ffff-ffffffffffff', '03000200-0400-0500-0006-000700080009']);

export function uuidForKey(uuid) {
  const k = uuidKey(uuid);
  return k && !BAD_UUIDS.has(k.slice(5)) ? k.slice(5) : null;
}

// Cartes dont l'adresse MAC / IP n'identifie pas la machine (identiques d'un poste a l'autre)
const IGNORED_NIC_RX = /failover cluster virtual|virtualbox host-only|vmware virtual ethernet adapter for vmnet|wan miniport|loopback|teredo|isatap|bluetooth/i;

export function usableMac(mac) {
  const m = normalizeMac(mac);
  if (!m) return null;
  // MAC de cluster NLB (partagee entre noeuds)
  if (m.startsWith('02:bf:') || m.startsWith('03:bf:')) return null;
  return m;
}

/** Adresses MAC / IPv4 utiles des cartes Win32_NetworkAdapterConfiguration. */
export function nicAddresses(nics) {
  const macs = new Set();
  const ips = new Set();
  for (const n of asArray(nics)) {
    if (!n || IGNORED_NIC_RX.test(n.Description || '')) continue;
    const m = usableMac(n.MACAddress);
    if (m) macs.add(m);
    for (const ip of asArray(n.IPAddress)) {
      const s = String(ip).trim();
      if (isIPv4(s) && ipKey(s)) ips.add(s);
    }
  }
  return { macs: [...macs], ips: [...ips] };
}

export function clean(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function round(v, d = 1) {
  if (v == null || !Number.isFinite(v)) return null;
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

/** Date PowerShell ("/Date(ms)/", ISO, ou objet { value } de PS 5.1). */
export function toDate(v) {
  if (v && typeof v === 'object' && !(v instanceof Date)) v = v.value ?? v.DateTime ?? null;
  const d = psDate(v);
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/** Supprime les champs null/undefined d'un objet (metriques, attributs). */
export function compact(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v != null) out[k] = v;
  return out;
}

/** Memoire utilisee en % (Win32_OperatingSystem, valeurs en Ko). */
export function memUsedPct(osInfo) {
  const total = num(osInfo?.TotalVisibleMemorySize);
  const free = num(osInfo?.FreePhysicalMemory);
  if (!total || free == null) return null;
  return round((1 - free / total) * 100, 1);
}

/** Duree de fonctionnement : valeur calculee par le script, sinon depuis la date de demarrage. */
export function uptimeSeconds(uptimeS, lastBoot, now = Date.now()) {
  const u = num(uptimeS);
  if (u != null && u >= 0) return Math.round(u);
  if (lastBoot) return Math.max(0, Math.round((now - lastBoot.getTime()) / 1000));
  return null;
}

const NET_ERRORS = {
  ENOTFOUND: 'nom introuvable (DNS)',
  EAI_AGAIN: 'nom introuvable (DNS)',
  ECONNREFUSED: 'connexion refusee',
  ETIMEDOUT: 'pas de reponse',
  EHOSTUNREACH: 'hote inaccessible',
  ENETUNREACH: 'reseau inaccessible',
  ECONNRESET: 'connexion reinitialisee',
};

/** Test de connexion TCP (port WinRM) : resout { ok:true } ou { ok:false, error:<code> }. */
export function tcpProbe(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(r);
    };
    const socket = net.connect({ host, port });
    socket.setTimeout(timeoutMs, () => finish({ ok: false, error: 'ETIMEDOUT' }));
    socket.once('connect', () => finish({ ok: true }));
    socket.once('error', (err) => finish({ ok: false, error: err.code || err.message }));
  });
}

/**
 * Ecarte les cibles distantes dont le port WinRM ne repond pas, sans lancer PowerShell
 * (une machine eteinte couterait sinon le delai de connexion WinRM a tout son lot).
 * @returns {Promise<{alive:string[], down:Array<{name,ok:false,error}>}>}
 */
export async function precheckTargets(targets, { port = 5985, timeoutMs = 3000, probe = tcpProbe, localName = os.hostname(), concurrency = 32 } = {}) {
  const results = new Array(targets.length);
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const i = next++;
      const t = targets[i];
      results[i] = isLocalTarget(t, localName) ? { ok: true } : await probe(t, port, timeoutMs);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, targets.length)) }, worker));
  const alive = [];
  const down = [];
  targets.forEach((t, i) => {
    if (results[i]?.ok) alive.push(t);
    else {
      const code = results[i]?.error || 'erreur inconnue';
      down.push({ name: t, ok: false, error: `WinRM (port ${port}) : ${NET_ERRORS[code] || code}` });
    }
  });
  return { alive, down };
}

/**
 * Lance un script PowerShell pour une liste de cibles, reparties sur `concurrency`
 * processus en parallele. Une cible absente du resultat ou un processus en echec
 * donne { name, ok:false, error, procError } (procError : faute de PowerShell, pas de la cible).
 */
export async function runTargetsInParallel({
  script, targets, params = {}, concurrency = 4, timeoutMs = 60000, credential, runner = runPowerShellScript,
}) {
  const list = asArray(targets);
  const n = Math.max(1, Math.min(Number(concurrency) || 1, list.length));
  const groups = Array.from({ length: n }, () => []);
  list.forEach((t, i) => groups[i % n].push(t));
  const results = await Promise.all(groups.filter((g) => g.length).map(async (group) => {
    let out;
    try {
      out = await runner(script, { ...params, targets: group }, { timeoutMs, credential });
    } catch (err) {
      const error = err?.message || String(err);
      // delai depasse : imputable aux cibles (WinRM bloque...) ; sinon PowerShell lui-meme est en cause
      const procError = !/delai depasse/i.test(error);
      return group.map((name) => ({ name, ok: false, error, procError }));
    }
    const rows = asArray(out?.targets).filter((r) => r && typeof r === 'object');
    const byName = new Map(rows.map((r) => [String(r.name).toLowerCase(), r]));
    return group.map((name) => byName.get(String(name).toLowerCase()) || {
      name, ok: false, error: out?.error || 'aucun resultat pour cette cible', procError: true,
    });
  }));
  return { targets: results.flat() };
}

/**
 * Collecte commune windows / hyperv : pre-test WinRM puis script PowerShell en parallele.
 * Leve une erreur si PowerShell lui-meme est en echec pour toutes les cibles testees
 * (ne pas declarer alors toutes les machines injoignables).
 * @param {Collector} col  collecteur (cfg, timeoutMs, runner, probe, log)
 */
export async function collectTargets(col, script, targets, params) {
  const cfg = col.cfg;
  const skipPrecheck = cfg.precheck === false || String(cfg.protocol || '').toLowerCase() === 'dcom';
  const { alive, down } = skipPrecheck
    ? { alive: targets, down: [] }
    : await precheckTargets(targets, {
      port: num(cfg.winrmPort) ?? (cfg.useSsl ? 5986 : 5985),
      timeoutMs: num(cfg.precheckTimeoutMs) ?? 3000,
      probe: col.probe || tcpProbe,
    });
  let rows = [];
  if (alive.length) {
    const data = await runTargetsInParallel({
      script,
      targets: alive,
      params,
      concurrency: cfg.concurrency ?? 4,
      // marge pour publier un resultat partiel avant le delai global du collecteur
      timeoutMs: Math.max(5000, col.timeoutMs - 5000),
      credential: cfg.credential,
      runner: col.runner || runPowerShellScript,
    });
    if (data.targets.length && data.targets.every((r) => r.procError)) throw new Error(data.targets[0].error);
    rows = data.targets;
  }
  const byName = new Map([...rows, ...down].map((r) => [String(r.name).toLowerCase(), r]));
  const ordered = targets.map((t) => byName.get(t.toLowerCase())).filter(Boolean);
  for (const r of ordered) {
    if (!r.ok) col.log.debug(`${r.name} : ${r.error}`);
    else if (r.hvError) col.log.debug(`${r.name} : ${r.hvError}`);
    else if (asArray(r.errors).length) col.log.debug(`${r.name} : ${asArray(r.errors).join(' | ')}`);
  }
  return { targets: ordered };
}

// ---------------------------------------------------------------------------
// Flux TCP
// ---------------------------------------------------------------------------

function normIp(ip) {
  const s = String(ip ?? '').trim().toLowerCase();
  return s.startsWith('::ffff:') && isIPv4(s.slice(7)) ? s.slice(7) : s;
}

function procName(p) {
  const s = clean(p);
  return s ? s.replace(/\.exe$/i, '') : null;
}

/**
 * Sens d'une connexion : entrante si le port local est en ecoute ; a defaut
 * de liste d'ecoute, heuristique sur les ports ephemeres (>= 49152).
 */
export function isInbound(localPort, remotePort, listenSet) {
  if (listenSet && listenSet.size) return listenSet.has(localPort);
  if (localPort < 49152 && remotePort >= 49152) return true;
  if (remotePort < 49152 && localPort >= 49152) return false;
  return localPort < remotePort;
}

/**
 * Agrege les connexions etablies d'une machine par (client, serveur, port de service).
 * src = cote client, dst = cote serveur ; bps inconnu (la table TCP ne donne pas de volume).
 */
export function aggregateConnections(conns, listen) {
  const listenSet = listen == null ? null : new Set(asArray(listen).map(Number));
  const map = new Map();
  for (const c of asArray(conns)) {
    if (!c) continue;
    const la = normIp(c.LocalAddress);
    const ra = normIp(c.RemoteAddress);
    const lp = Number(c.LocalPort);
    const rp = Number(c.RemotePort);
    if (!ipKey(la) || !ipKey(ra) || la === ra || !(lp > 0) || !(rp > 0)) continue;
    const inbound = isInbound(lp, rp, listenSet);
    const port = inbound ? lp : rp;
    const client = inbound ? ra : la;
    const server = inbound ? la : ra;
    const key = `${client}|${server}|${port}`;
    let f = map.get(key);
    if (!f) {
      const proc = procName(c.Process);
      f = {
        src: { ip: client },
        dst: { ip: server },
        proto: 'tcp',
        port,
        app: appForPort(port) || (inbound ? proc : null),
        bps: null,
        conns: 0,
        process: inbound ? proc : null,
        clientProcess: inbound ? null : proc,
      };
      map.set(key, f);
    }
    f.conns++;
  }
  return [...map.values()];
}

/** Fusionne les flux de plusieurs machines (une connexion peut etre vue des deux cotes). */
export function mergeFlows(map, flows) {
  for (const f of flows) {
    const key = `${f.src.ip}|${f.dst.ip}|${f.port}`;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, { ...f });
      continue;
    }
    cur.conns = Math.max(cur.conns, f.conns);
    cur.process = cur.process || f.process;
    cur.clientProcess = cur.clientProcess || f.clientProcess;
    if (!cur.app && f.app) cur.app = f.app;
  }
  return map;
}

// ---------------------------------------------------------------------------
// Conversion JSON PowerShell -> snapshot
// ---------------------------------------------------------------------------

function mapReachable(t, opts) {
  const cs = t.cs || {};
  const osInfo = t.os || {};
  const name = clean(cs.Name) || clean(t.name);
  const dnsName = (clean(cs.DNSHostName) || name).toLowerCase();
  const domain = cs.PartOfDomain === false ? null : clean(cs.Domain)?.toLowerCase() || null;
  const fqdn = domain ? `${dnsName}.${domain}` : null;
  const vendor = clean(cs.Manufacturer);
  const model = clean(cs.Model);
  const vm = isVirtualMachine(vendor, model);
  const serial = clean(t.bios?.SerialNumber);
  const uuid = uuidForKey(t.product?.UUID);
  const { macs, ips } = nicAddresses(t.nics);

  const disks = asArray(t.disks).filter((d) => d && num(d.Size) > 0).map((d) => {
    const size = num(d.Size);
    const free = num(d.FreeSpace) ?? 0;
    return compact({
      id: clean(d.DeviceID),
      label: clean(d.VolumeName),
      sizeGB: round(size / GB, 1),
      freeGB: round(free / GB, 1),
      usedPct: round((1 - free / size) * 100, 1),
    });
  });
  const worstDisk = disks.reduce((m, d) => (m == null || d.usedPct > m ? d.usedPct : m), null);

  const services = asArray(t.stoppedServices).filter(Boolean)
    .map((s) => (typeof s === 'string' ? { Name: s } : s))
    .filter((s) => clean(s.Name));

  const lastBoot = toDate(osInfo.LastBootUpTime);
  const memBytes = num(cs.TotalPhysicalMemory) ?? (num(osInfo.TotalVisibleMemorySize) ?? 0) * 1024;

  const problems = [];
  if (services.length) {
    const labels = services.map((s) => clean(s.DisplayName) || s.Name);
    const more = labels.length > 5 ? ` (+${labels.length - 5})` : '';
    problems.push(`Services automatiques arretes : ${labels.slice(0, 5).join(', ')}${more}`);
  }
  const fullDisks = opts.diskWarnPct == null ? [] : disks.filter((d) => d.usedPct > opts.diskWarnPct);
  if (fullDisks.length) {
    problems.push(`Disque presque plein : ${fullDisks.map((d) => `${d.id} ${Math.round(d.usedPct)} %`).join(', ')}`);
  }

  const errors = asArray(t.errors).filter(Boolean);
  return {
    id: `windows:${targetSlug(t.name, opts.localName)}`,
    type: vm ? 'vm' : 'server',
    name,
    keys: buildKeys({
      hostname: name, fqdn, serial: serialForKey(serial, vm), uuid, mac: macs, ip: ips,
    }),
    status: problems.length ? 'warning' : 'ok',
    statusText: problems.length ? problems.join(' ; ') : undefined,
    attrs: compact({
      os: clean(osInfo.Caption),
      osVersion: clean(osInfo.Version),
      vendor,
      model,
      serial,
      uuid,
      cpuCores: num(cs.NumberOfLogicalProcessors),
      memGB: memBytes ? round(memBytes / GB, 1) : null,
      ip: ips,
      mac: macs,
      domain,
      fqdn,
      lastBoot: lastBoot ? lastBoot.toISOString() : null,
      disks,
      stoppedServices: services.map((s) => s.Name),
      target: t.name,
      collectErrors: errors.length ? errors : null,
    }),
    metrics: compact({
      cpu: num(t.cpuLoad),
      mem: memUsedPct(osInfo),
      disk: worstDisk,
      uptimeS: uptimeSeconds(t.uptimeS, lastBoot),
    }),
  };
}

function mapUnreachable(t, opts) {
  const known = opts.known?.get(String(t.name).toLowerCase());
  const local = isLocalTarget(t.name, opts.localName);
  const name = known?.name || (local ? opts.localName : clean(t.name));
  const keys = known?.keys?.length ? known.keys : [hostKey(name) || ipKey(name)].filter(Boolean);
  return {
    id: `windows:${targetSlug(t.name, opts.localName)}`,
    type: known?.type || 'server',
    name,
    keys,
    status: 'critical',
    statusText: `Injoignable : ${t.error || 'erreur inconnue'}`,
    attrs: { target: t.name, error: t.error || null },
  };
}

/**
 * Convertit la sortie JSON de windows.ps1 en snapshot.
 * @param {object} data  { targets: [...] }
 * @param {{known?:Map, localName?:string, diskWarnPct?:number, maxFlows?:number}} options
 *   known : cache cible -> {type, name, keys} (derniere collecte reussie), mis a jour ici ;
 *   il permet de publier une cible injoignable au meme endroit (meme type / memes cles).
 */
export function windowsToSnapshot(data, options = {}) {
  const opts = {
    known: options.known || null,
    localName: options.localName || os.hostname(),
    diskWarnPct: options.diskWarnPct ?? null,
    maxFlows: options.maxFlows ?? 5000,
  };
  const entities = [];
  const flowMap = new Map();
  const ids = new Set();
  for (const t of asArray(data?.targets)) {
    if (!t || typeof t !== 'object' || !clean(t.name)) continue;
    const ent = t.ok ? mapReachable(t, opts) : mapUnreachable(t, opts);
    if (ids.has(ent.id)) ent.id = `${ent.id}~${String(t.name).toLowerCase()}`;
    ids.add(ent.id);
    if (!ent.statusText) delete ent.statusText;
    entities.push(ent);
    if (t.ok) {
      opts.known?.set(String(t.name).toLowerCase(), { type: ent.type, name: ent.name, keys: ent.keys });
      mergeFlows(flowMap, aggregateConnections(t.conns, t.listen));
    }
  }
  const flows = [...flowMap.values()].sort((a, b) => b.conns - a.conns).slice(0, opts.maxFlows);
  return { entities, links: [], flows };
}

// ---------------------------------------------------------------------------
// Collecteur
// ---------------------------------------------------------------------------

export class WindowsCollector extends Collector {
  constructor(cfg, ctx) {
    super(cfg, ctx);
    this.known = new Map();
    this.runner = runPowerShellScript; // remplacables (tests)
    this.probe = tcpProbe;
  }

  defaultInterval() { return 60; }

  async poll() {
    const targets = normalizeTargets(this.cfg.targets);
    if (!targets.length) return { entities: [], links: [], flows: [] };
    const data = await collectTargets(this, 'windows.ps1', targets, compact({
      flows: !!this.cfg.flows,
      opTimeoutSec: num(this.cfg.opTimeoutSec),
      protocol: clean(this.cfg.protocol),
      serviceExclude: this.cfg.serviceExclude ? asArray(this.cfg.serviceExclude) : null,
      port: num(this.cfg.winrmPort),
      useSsl: this.cfg.useSsl ? true : null,
    }));
    return windowsToSnapshot(data, {
      known: this.known,
      diskWarnPct: num(this.cfg.diskWarnPct),
      maxFlows: num(this.cfg.maxFlows) ?? 5000,
    });
  }
}

export default function create(cfg, ctx) {
  return new WindowsCollector(cfg, ctx);
}
