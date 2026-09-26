// Collecteur ICMP : joignabilite et latence via la commande systeme `ping` (aucune dependance).
//
// cfg : { type:'ping', targets?:['10.0.0.1', {ip:'10.0.0.2', name:'x'}], auto?:true,
//         concurrency:32, timeoutMs:1000, interval:30, maxTargets:2000 }
//  - auto : ping de toute entite fusionnee ayant une cle ip:, non arretee, et connue
//    d'au moins une AUTRE source que ce collecteur (sinon l'entite s'auto-entretiendrait).
import { execFile } from 'node:child_process';
import { Collector } from './base.js';
import { ipKey, isIPv4, clsOf } from '../../shared/model.js';

/**
 * Analyse la sortie de ping (independante de la langue).
 * Windows : ping peut sortir en code 0 sur "Destination injoignable" -> on exige aussi "TTL=".
 * @returns {{reachable:boolean, latencyMs:number|null}}
 */
export function parsePingOutput(stdout, code, platform = process.platform) {
  const out = String(stdout ?? '');
  const ok = Number(code) === 0;
  const reachable = platform === 'win32' ? ok && /\bttl[=:]\s*\d+/i.test(out) : ok;
  let latencyMs = null;
  if (reachable) {
    // "time=3ms", "temps=3 ms", "Zeit<1ms", "time=0.412 ms"
    const m = out.match(/[=<]\s*(\d+(?:[.,]\d+)?)\s*ms\b/i);
    if (m) latencyMs = Number(m[1].replace(',', '.'));
  }
  return { reachable, latencyMs };
}

/** Arguments de la commande ping selon la plateforme. */
export function pingArgs(ip, timeoutMs, platform = process.platform) {
  const ms = Math.max(1, Math.round(timeoutMs));
  if (platform === 'win32') return ['-n', '1', '-w', String(ms), ip];
  if (platform === 'darwin') return ['-c', '1', '-W', String(ms), ip]; // -W en ms sous macOS
  return ['-c', '1', '-W', String(Math.max(1, Math.ceil(ms / 1000))), ip];
}

/** Ping unique ; rejette si la commande ping est introuvable. */
export function pingOnce(ip, timeoutMs = 1000, platform = process.platform) {
  return new Promise((resolve, reject) => {
    execFile('ping', pingArgs(ip, timeoutMs, platform), {
      timeout: timeoutMs + 4000, windowsHide: true, encoding: 'latin1',
    }, (err, stdout) => {
      if (err && (err.code === 'ENOENT' || err.code === 'EACCES')) {
        reject(new Error(`commande ping indisponible (${err.code})`));
        return;
      }
      const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
      resolve(parsePingOutput(stdout, code, platform));
    });
  });
}

function sourceName(s) {
  if (s == null) return null;
  if (typeof s === 'string') return s;
  return s.id ?? s.source ?? s.sourceId ?? s.name ?? null;
}

function entityIPv4(e) {
  for (const k of e.keys || []) {
    if (typeof k === 'string' && k.startsWith('ip:') && isIPv4(k.slice(3))) return k.slice(3);
  }
  return null;
}

/** Entite connue d'une autre source que la notre (evite l'auto-entretien). */
function seenByOthers(e, sourceId) {
  return (e.sources || []).some((s) => {
    const n = sourceName(s);
    return n != null && n !== sourceId;
  });
}

/** Cibles explicites normalisees : [{ ip, name }] (IPv4 uniquement). */
export function normalizeExplicitTargets(list) {
  const out = [];
  const seen = new Set();
  for (const t of Array.isArray(list) ? list : list == null ? [] : [list]) {
    const ip = String((t && typeof t === 'object' ? t.ip : t) ?? '').trim();
    if (!isIPv4(ip) || seen.has(ip)) continue;
    seen.add(ip);
    out.push({ ip, name: (t && typeof t === 'object' && t.name) || ip });
  }
  return out;
}

/**
 * Construit la liste des IP a pinger.
 * @returns {Array<{ip:string, entities:Array<{id,type,name}>, name?:string}>}
 */
export function selectTargets(entities, { sourceId, explicit = [], auto = true, maxTargets = 2000 } = {}) {
  const byIp = new Map();
  const add = (ip, ent, name) => {
    let t = byIp.get(ip);
    if (!t) {
      if (byIp.size >= maxTargets) return;
      t = { ip, entities: [], name: null };
      byIp.set(ip, t);
    }
    if (ent && !t.entities.some((x) => x.id === ent.id)) t.entities.push({ id: ent.id, type: ent.type, name: ent.name });
    if (name && !t.name) t.name = name;
  };
  const candidates = (entities || []).filter((e) => e && e.id && seenByOthers(e, sourceId) &&
    e.type !== 'external' && clsOf(e.type) !== 'external');

  // cibles explicites d'abord (prioritaires sur maxTargets)
  for (const t of explicit) {
    const matches = candidates.filter((e) => (e.keys || []).includes(`ip:${t.ip}`));
    if (matches.length) matches.forEach((e) => add(t.ip, e, t.name));
    else add(t.ip, null, t.name);
  }
  if (auto) {
    for (const e of candidates) {
      if (e.status === 'off') continue;
      const ip = entityIPv4(e);
      if (ip && ipKey(ip)) add(ip, e, null);
    }
  }
  return [...byIp.values()];
}

/** Resultats de ping -> snapshot. */
export function pingSnapshot(targets, results) {
  const entities = [];
  const ids = new Set();
  targets.forEach((t, i) => {
    const r = results[i] || { reachable: false, latencyMs: null };
    const base = {
      keys: [ipKey(t.ip)].filter(Boolean),
      status: r.reachable ? 'ok' : 'critical',
      metrics: { latencyMs: r.reachable ? r.latencyMs : null, reachable: r.reachable ? 1 : 0 },
    };
    if (!r.reachable) base.statusText = 'Injoignable (ping)';
    const list = t.entities.length
      ? t.entities.map((e) => ({ id: e.id, type: e.type, name: e.name }))
      : [{ id: `ping:${t.ip}`, type: 'external', name: t.name || t.ip, attrs: { ip: [t.ip] } }];
    for (const e of list) {
      if (ids.has(e.id)) continue;
      ids.add(e.id);
      entities.push({ ...e, ...base });
    }
  });
  return { entities, links: [], flows: [] };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

export class PingCollector extends Collector {
  defaultInterval() { return 30; }

  /** Surcharge possible (tests). */
  pingOne(ip) {
    return pingOnce(ip, this.pingTimeoutMs());
  }

  pingTimeoutMs() {
    return Math.max(100, Number(this.cfg.timeoutMs ?? 1000));
  }

  async poll() {
    const store = this.ctx.store;
    const entities = store && typeof store.getEntities === 'function' ? store.getEntities() || [] : [];
    const targets = selectTargets(entities, {
      sourceId: this.sourceId,
      explicit: normalizeExplicitTargets(this.cfg.targets),
      auto: this.cfg.auto !== false,
      maxTargets: Math.max(1, Number(this.cfg.maxTargets ?? 2000)),
    });
    if (!targets.length) return { entities: [], links: [], flows: [] };
    const concurrency = Math.max(1, Number(this.cfg.concurrency ?? 32));
    const results = await mapLimit(targets, concurrency, (t) => this.pingOne(t.ip));
    const down = results.filter((r) => !r.reachable).length;
    this.log.debug(`${targets.length} cible(s) pingee(s), ${down} injoignable(s)`);
    return pingSnapshot(targets, results);
  }
}

export default function create(cfg, ctx) {
  return new PingCollector(cfg, ctx);
}
