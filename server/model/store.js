// Magasin de topologie : fusionne les snapshots de toutes les sources en UNE
// topologie coherente (entites, liens, flux, alarmes), calcule les deltas pour
// les clients et conserve un historique court des metriques.
import { EventEmitter } from 'node:events';
import {
  ENTITY_TYPES, MERGE_KEY_KINDS, clsOf, layerOf, isStatus, statusRank, worstStatus, keyKind,
  ipKey, toArray, parseCidr, cidrContains, isIPv4, isPrivateIPv4, appForPort, flowCategory,
} from '../../shared/model.js';
import { History } from './history.js';

const CLS_ORDER = ['physical', 'hypervisor', 'vm', 'external'];
const IP_LOOKUP_ORDER = ['vm', 'hypervisor', 'physical', 'external'];

export const DEFAULT_THRESHOLDS = {
  cpu: { warning: 85, critical: 95, label: 'CPU', unit: ' %' },
  mem: { warning: 90, critical: 97, label: 'Mémoire', unit: ' %' },
  disk: { warning: 85, critical: 95, label: 'Disque', unit: ' %' },
  temp: { warning: 70, critical: 85, label: 'Température', unit: ' °C' },
  latencyMs: { warning: 150, critical: 800, label: 'Latence', unit: ' ms' },
  util: { warning: 75, critical: 92, label: 'Utilisation', unit: ' %' },
};

export class TopologyStore extends EventEmitter {
  /**
   * @param {{thresholds?:object, networks?:Array<{cidr:string,name:string,id?:string}>,
   *          maxFlows?:number, logger?:object, rebuildDelayMs?:number, history?:object}} opts
   */
  constructor(opts = {}) {
    super();
    this.log = opts.logger;
    this.thresholds = mergeThresholds(opts.thresholds);
    this.networks = [];
    this.setNetworks(opts.networks || []);
    this.maxFlows = opts.maxFlows ?? 600;
    this.rebuildDelayMs = opts.rebuildDelayMs ?? 250;
    this.history = new History(opts.history);
    this.sources = new Map();
    this.version = 0;
    this.entities = new Map();
    this.links = new Map();
    this.flows = new Map();
    this.alarms = [];
    this.prevJson = { entities: new Map(), links: new Map(), flows: new Map(), alarms: '[]' };
    this.alarmSince = new Map();
    this.acked = new Set();
    this.rebuildTimer = null;
    this.generatedAt = null;
  }

  setNetworks(list) {
    this.networks = toArray(list)
      .map((n) => ({ ...n, parsed: parseCidr(n.cidr) }))
      .filter((n) => n.parsed)
      .sort((a, b) => b.parsed.bits - a.parsed.bits);
  }

  // ------------------------------------------------------------------------
  // Entree des donnees
  // ------------------------------------------------------------------------

  /** Enregistre le snapshot complet d'une source (remplace le precedent). */
  publish(sourceId, snapshot, opts = {}) {
    const now = Date.now();
    const norm = normalizeSnapshot(snapshot, now);
    this.sources.set(sourceId, {
      id: sourceId,
      priority: opts.priority ?? 10,
      staleAfterMs: opts.staleAfterMs ?? null,
      updatedAt: now,
      ...norm,
    });
    this.scheduleRebuild();
  }

  removeSource(sourceId) {
    if (this.sources.delete(sourceId)) this.scheduleRebuild();
  }

  scheduleRebuild() {
    if (this.rebuildTimer) return;
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      try {
        this.rebuild();
      } catch (err) {
        this.log?.error('echec de reconstruction de la topologie', err);
      }
    }, this.rebuildDelayMs);
  }

  acknowledge(alarmId, ack = true) {
    if (ack) this.acked.add(alarmId); else this.acked.delete(alarmId);
    this.scheduleRebuild();
  }

  // ------------------------------------------------------------------------
  // Lecture
  // ------------------------------------------------------------------------

  getEntities() { return [...this.entities.values()]; }
  getEntity(id) { return this.entities.get(id) || null; }

  getTopology() {
    return {
      version: this.version,
      generatedAt: this.generatedAt,
      entities: [...this.entities.values()],
      links: [...this.links.values()],
      flows: [...this.flows.values()],
      alarms: this.alarms,
    };
  }

  getHistory(id) { return this.history.get(id); }

  // ------------------------------------------------------------------------
  // Fusion
  // ------------------------------------------------------------------------

  rebuild(now = Date.now()) {
    const raws = [];
    for (const src of this.sources.values()) {
      const stale = src.staleAfterMs != null && now - src.updatedAt > src.staleAfterMs;
      for (const e of src.entities) {
        raws.push({ src: src.id, pri: src.priority, at: src.updatedAt, stale, e, cls: clsOf(e.type) });
      }
    }

    // 1. Union-find : meme classe + (meme id OU meme cle forte)
    const uf = new UnionFind(raws.length);
    const firstBy = new Map();
    raws.forEach((r, i) => {
      const tokens = [`id|${r.cls}|${r.e.id}`];
      for (const k of r.e.keys) if (MERGE_KEY_KINDS.has(keyKind(k))) tokens.push(`k|${r.cls}|${k}`);
      for (const t of tokens) {
        const j = firstBy.get(t);
        if (j === undefined) firstBy.set(t, i); else uf.union(i, j);
      }
    });
    const groupsByRoot = new Map();
    raws.forEach((r, i) => {
      const root = uf.find(i);
      if (!groupsByRoot.has(root)) groupsByRoot.set(root, []);
      groupsByRoot.get(root).push(r);
    });

    // 2. Identifiant canonique (stable) de chaque groupe
    const groups = [...groupsByRoot.values()].map((members) => {
      members.sort((a, b) => b.pri - a.pri || a.e.id.localeCompare(b.e.id));
      return { members, cls: members[0].cls, canonical: members[0].e.id };
    });
    groups.sort((a, b) => CLS_ORDER.indexOf(a.cls) - CLS_ORDER.indexOf(b.cls) ||
      a.canonical.localeCompare(b.canonical));
    const usedIds = new Set();
    const bySrcLocal = new Map();
    const byId = new Map();
    const byKey = new Map();
    for (const g of groups) {
      let id = g.canonical;
      if (usedIds.has(id)) id = `${id}#${g.cls}`;
      usedIds.add(id);
      g.id = id;
      for (const m of g.members) {
        bySrcLocal.set(`${m.src}\u0000${m.e.id}`, id);
        if (!byId.has(m.e.id)) byId.set(m.e.id, id);
        for (const k of m.e.keys) {
          if (!byKey.has(k)) byKey.set(k, []);
          const arr = byKey.get(k);
          if (!arr.some((x) => x.id === id)) arr.push({ id, cls: g.cls });
        }
      }
    }
    for (const g of groups) byId.set(g.id, g.id);

    const ctx = { bySrcLocal, byId, byKey };

    // 3. Fusion des attributs
    const entities = new Map();
    for (const g of groups) entities.set(g.id, mergeGroup(g, ctx));

    // 4. Parents (resolution + protection contre les cycles)
    for (const g of groups) {
      const ent = entities.get(g.id);
      ent.parent = null;
      for (const m of g.members) {
        if (m.e.parent == null) continue;
        const pid = resolveRef(m.e.parent, m.src, ctx, { cls: m.e.parentCls });
        if (pid && pid !== ent.id && entities.has(pid)) { ent.parent = pid; break; }
      }
    }
    breakParentCycles(entities);

    // 5. Liens
    const links = this.mergeLinks(ctx, entities);

    // 6. Flux (peut creer des entites externes synthetiques)
    const flows = this.mergeFlows(ctx, entities, now);

    // 7. Seuils + alarmes
    for (const ent of entities.values()) applyThresholds(ent, this.thresholds);
    for (const l of links.values()) applyLinkThresholds(l, this.thresholds);
    const alarms = this.computeAlarms(entities, links, now);

    this.history.record(entities, now);
    this.commit(entities, links, flows, alarms, now);
  }

  mergeLinks(ctx, entities) {
    const byPair = new Map();
    for (const src of this.sources.values()) {
      for (const l of src.links) {
        const a = resolveRef(l.a, src.id, ctx);
        const b = resolveRef(l.b, src.id, ctx);
        if (!a || !b || a === b || !entities.has(a) || !entities.has(b)) continue;
        const flip = a > b;
        const item = {
          x: flip ? b : a, y: flip ? a : b,
          px: (flip ? l.bPort : l.aPort) || null, py: (flip ? l.aPort : l.bPort) || null,
          kind: l.kind, speedBps: l.speedBps, status: l.status, statusText: l.statusText,
          metrics: l.metrics, pri: src.priority, at: src.updatedAt, src: src.id, label: l.label,
        };
        const pair = `${item.x}|${item.y}`;
        if (!byPair.has(pair)) byPair.set(pair, []);
        const list = byPair.get(pair);
        const same = list.find((o) => portsCompatible(o.px, item.px) && portsCompatible(o.py, item.py));
        if (same) mergeLinkInto(same, item); else list.push({ ...item, sources: [item.src] });
      }
    }
    const links = new Map();
    for (const list of byPair.values()) {
      for (const o of list) {
        const id = `${o.x}:${o.px || ''}~${o.y}:${o.py || ''}`;
        links.set(id, {
          id, a: o.x, aPort: o.px, b: o.y, bPort: o.py,
          kind: o.kind || 'ethernet', speedBps: o.speedBps ?? null,
          status: o.status || 'unknown', statusText: o.statusText || null,
          metrics: o.metrics || {}, sources: o.sources, label: o.label || null,
        });
      }
    }
    return links;
  }

  mergeFlows(ctx, entities, now) {
    const agg = new Map();
    const externals = new Map();
    const resolveEp = (ep, srcId) => {
      if (ep && typeof ep === 'object' && ep.ip && !ep.id && !ep.key && !ep.keys) {
        const hit = lookupIp(ep.ip, ctx);
        if (hit) return hit;
        return this.externalForIp(ep.ip, entities, externals);
      }
      return resolveRef(ep, srcId, ctx);
    };
    for (const src of this.sources.values()) {
      for (const f of src.flows) {
        const s = resolveEp(f.src, src.id);
        const d = resolveEp(f.dst, src.id);
        if (!s || !d || s === d) continue;
        const proto = f.proto || 'tcp';
        const port = f.port ?? null;
        const key = `${s}>${d}>${proto}>${port ?? ''}`;
        let o = agg.get(key);
        if (!o) {
          const app = f.app || appForPort(port) || null;
          o = {
            id: key, src: s, dst: d, proto, port, app, category: f.category || flowCategory(app, port),
            bps: null, pps: null, conns: null, sources: [], label: f.label || null,
            process: null, clientProcess: null,
          };
          agg.set(key, o);
        }
        if (f.bps != null) o.bps = (o.bps || 0) + f.bps;
        if (f.pps != null) o.pps = (o.pps || 0) + f.pps;
        if (f.conns != null) o.conns = (o.conns || 0) + f.conns;
        o.process = o.process || f.process;
        o.clientProcess = o.clientProcess || f.clientProcess;
        if (!o.sources.includes(src.id)) o.sources.push(src.id);
      }
    }
    for (const [id, ext] of externals) {
      if (!entities.has(id)) entities.set(id, ext);
    }
    const list = [...agg.values()]
      .sort((a, b) => (b.bps || 0) - (a.bps || 0) || (b.conns || 0) - (a.conns || 0))
      .slice(0, this.maxFlows);
    for (const f of list) {
      if (f.bps != null) f.bps = round3(f.bps);
      if (f.pps != null) f.pps = round3(f.pps);
    }
    // les externes synthetiques sans flux retenu sont retires
    const used = new Set(list.flatMap((f) => [f.src, f.dst]));
    for (const id of externals.keys()) {
      if (!used.has(id) && entities.get(id)?.attrs?.synthetic) entities.delete(id);
    }
    return new Map(list.map((f) => [f.id, f]));
  }

  /** Rattache une IP inconnue a une entite externe (reseau nomme, LAN, Internet). */
  externalForIp(ip, entities, externals) {
    if (!isIPv4(ip)) return this.syntheticExternal('ext:internet', 'Internet', 'internet', entities, externals);
    for (const n of this.networks) {
      if (cidrContains(n.parsed, ip)) {
        const id = n.id || `ext:net:${slug(n.name || n.cidr)}`;
        if (entities.has(id)) return id;
        return this.syntheticExternal(id, n.name || n.cidr, n.kind || 'network', entities, externals, { cidr: n.cidr });
      }
    }
    for (const ent of entities.values()) {
      if (ent.type !== 'external') continue;
      for (const c of toArray(ent.attrs?.cidrs)) {
        if (cidrContains(parseCidr(c), ip)) return ent.id;
      }
    }
    if (isPrivateIPv4(ip)) {
      const lanDefault = [...entities.values()].find((e) => e.type === 'external' && e.attrs?.default === 'lan');
      if (lanDefault) return lanDefault.id;
      return this.syntheticExternal('ext:lan', 'Réseau interne non inventorié', 'lan', entities, externals);
    }
    const inetDefault = [...entities.values()].find((e) => e.type === 'external' && (e.attrs?.default === 'internet' || e.attrs?.kind === 'internet'));
    if (inetDefault) return inetDefault.id;
    return this.syntheticExternal('ext:internet', 'Internet', 'internet', entities, externals);
  }

  syntheticExternal(id, name, kind, entities, externals, attrs = {}) {
    if (entities.has(id)) return id;
    if (!externals.has(id)) {
      externals.set(id, {
        id, type: 'external', cls: 'external', layer: 'external', name, parent: null,
        status: 'unknown', statusText: null, attrs: { kind, synthetic: true, ...attrs },
        metrics: {}, keys: [], sources: ['flows'], updatedAt: null,
      });
    }
    return id;
  }

  computeAlarms(entities, links, now) {
    const alarms = [];
    const seen = new Set();
    const push = (id, severity, target, message, extra) => {
      seen.add(id);
      const prev = this.alarmSince.get(id);
      let since = prev?.since ?? now;
      if (prev && statusRank(severity) > statusRank(prev.severity)) since = now;
      this.alarmSince.set(id, { since, severity });
      alarms.push({ id, severity, ...target, message, since: new Date(since).toISOString(), acked: this.acked.has(id), ...extra });
    };
    for (const e of entities.values()) {
      if (e.status === 'warning' || e.status === 'critical') {
        push(`e:${e.id}`, e.status, { entity: e.id }, e.statusText || 'État dégradé', { name: e.name, type: e.type });
      }
    }
    for (const l of links.values()) {
      if (l.status === 'warning' || l.status === 'critical') {
        const an = entities.get(l.a)?.name || l.a;
        const bn = entities.get(l.b)?.name || l.b;
        push(`l:${l.id}`, l.status, { link: l.id, entity: l.a },
          `Lien ${an}${l.aPort ? ` (${l.aPort})` : ''} - ${bn}${l.bPort ? ` (${l.bPort})` : ''} : ${l.statusText || 'dégradé'}`,
          { name: `${an} - ${bn}`, type: 'link' });
      }
    }
    for (const id of [...this.alarmSince.keys()]) {
      if (!seen.has(id)) { this.alarmSince.delete(id); this.acked.delete(id); }
    }
    alarms.sort((a, b) => statusRank(b.severity) - statusRank(a.severity) || a.since.localeCompare(b.since));
    return alarms;
  }

  commit(entities, links, flows, alarms, now) {
    const delta = { entities: diffMap(this.prevJson.entities, entities), links: diffMap(this.prevJson.links, links), flows: diffMap(this.prevJson.flows, flows) };
    const alarmsJson = JSON.stringify(alarms);
    const alarmsChanged = alarmsJson !== this.prevJson.alarms;
    this.prevJson.alarms = alarmsJson;
    this.entities = entities;
    this.links = links;
    this.flows = flows;
    this.alarms = alarms;
    this.generatedAt = new Date(now).toISOString();
    const changed = alarmsChanged || ['entities', 'links', 'flows'].some((k) => delta[k].set.length || delta[k].del.length);
    if (!changed) return null;
    this.version++;
    const out = { version: this.version, generatedAt: this.generatedAt, ...delta };
    if (alarmsChanged) out.alarms = alarms;
    this.emit('delta', out);
    return out;
  }
}

// ---------------------------------------------------------------------------
// Normalisation des snapshots
// ---------------------------------------------------------------------------

export function normalizeSnapshot(snapshot = {}, now = Date.now()) {
  const entities = [];
  const seen = new Set();
  for (const raw of toArray(snapshot.entities)) {
    if (!raw || raw.id == null) continue;
    const id = String(raw.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const type = ENTITY_TYPES[raw.type] ? raw.type : 'appliance';
    const keys = new Set(toArray(raw.keys).filter((k) => typeof k === 'string' && k.includes(':')));
    for (const ip of toArray(raw.attrs?.ip)) { const k = ipKey(ip); if (k) keys.add(k); }
    let parent = raw.parent ?? null;
    let parentCls = null;
    if (parent && typeof parent === 'object') parentCls = parent.cls || null;
    entities.push({
      id, type, name: raw.name != null ? String(raw.name) : null, parent, parentCls,
      keys: [...keys], status: isStatus(raw.status) ? raw.status : null,
      statusText: raw.statusText || null, attrs: cleanObject(raw.attrs), metrics: cleanMetrics(raw.metrics),
      at: raw.updatedAt ? Date.parse(raw.updatedAt) || now : now,
    });
  }
  const links = toArray(snapshot.links).filter((l) => l && l.a != null && l.b != null).map((l) => ({
    a: l.a, b: l.b, aPort: l.aPort != null ? String(l.aPort).trim() || null : null,
    bPort: l.bPort != null ? String(l.bPort).trim() || null : null,
    kind: l.kind || null, speedBps: numOrNull(l.speedBps), status: isStatus(l.status) ? l.status : null,
    statusText: l.statusText || null, metrics: cleanMetrics(l.metrics), label: l.label || null,
  }));
  const flows = toArray(snapshot.flows).filter((f) => f && f.src != null && f.dst != null).map((f) => ({
    src: f.src, dst: f.dst, proto: f.proto != null ? String(f.proto).toLowerCase() : null,
    port: numOrNull(f.port), app: f.app || null, category: f.category || null,
    bps: numOrNull(f.bps), pps: numOrNull(f.pps), conns: numOrNull(f.conns), label: f.label || null,
    process: f.process ? String(f.process) : null, clientProcess: f.clientProcess ? String(f.clientProcess) : null,
  }));
  return { entities, links, flows };
}

function cleanObject(o) {
  if (!o || typeof o !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') out[k] = v;
  return out;
}

function cleanMetrics(m) {
  if (!m || typeof m !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(m)) {
    const n = typeof v === 'number' ? v : Number(v);
    if (v !== null && v !== '' && Number.isFinite(n)) out[k] = Math.round(n * 100) / 100;
  }
  return out;
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Fusion d'un groupe
// ---------------------------------------------------------------------------

function mergeGroup(g, ctx) {
  const byPriAsc = [...g.members].sort((a, b) => a.pri - b.pri || a.at - b.at);
  const byFreshAsc = [...g.members].sort((a, b) => a.e.at - b.e.at || a.pri - b.pri);
  const top = g.members[0];
  const attrs = {};
  for (const m of byPriAsc) Object.assign(attrs, m.e.attrs);
  const metrics = {};
  for (const m of byFreshAsc) if (!m.stale) Object.assign(metrics, m.e.metrics);
  const keys = new Set();
  for (const m of g.members) for (const k of m.e.keys) keys.add(k);
  const sources = [...new Set(g.members.map((m) => m.src))];

  // Statut : pire statut connu parmi les sources non obsoletes
  let status = null;
  const texts = [];
  const live = g.members.filter((m) => !m.stale);
  for (const m of live) if (m.e.status) status = status ? worstStatus(status, m.e.status) : m.e.status;
  if (status) {
    for (const m of live) if (m.e.status === status && m.e.statusText && !texts.includes(m.e.statusText)) texts.push(m.e.statusText);
  }
  const staleMembers = g.members.filter((m) => m.stale && m.e.status);
  const staleOnly = !status && staleMembers.length > 0;
  if (staleOnly) {
    status = 'unknown';
    texts.push(`Données obsolètes (${[...new Set(staleMembers.map((m) => m.src))].join(', ')})`);
  }
  let name = null;
  for (const m of g.members) if (m.e.name) { name = m.e.name; break; }
  const type = top.e.type;
  return {
    id: g.id,
    type,
    cls: clsOf(type),
    layer: layerOf(type),
    name: name || g.id,
    parent: null,
    status: status || 'unknown',
    statusText: texts.join(' ; ') || null,
    attrs,
    metrics,
    keys: [...keys],
    sources,
    stale: staleOnly || undefined,
    updatedAt: new Date(Math.max(...g.members.map((m) => m.e.at))).toISOString(),
  };
}

function resolveRef(ref, srcId, ctx, opts = {}) {
  if (ref == null) return null;
  if (typeof ref === 'string') {
    return ctx.bySrcLocal.get(`${srcId}\u0000${ref}`) ?? ctx.byId.get(ref) ?? null;
  }
  if (typeof ref === 'object') {
    if (ref.id) return resolveRef(String(ref.id), srcId, ctx);
    const cls = ref.cls || opts.cls || null;
    const keys = ref.keys ? toArray(ref.keys) : ref.key ? [ref.key] : [];
    for (const k of keys) {
      const hits = ctx.byKey.get(k);
      if (!hits) continue;
      const hit = cls ? hits.find((h) => h.cls === cls) : hits[0];
      if (hit) return hit.id;
    }
    if (ref.ip) return lookupIp(ref.ip, ctx);
  }
  return null;
}

function lookupIp(ip, ctx) {
  const k = ipKey(ip);
  if (!k) return null;
  const hits = ctx.byKey.get(k);
  if (!hits || !hits.length) return null;
  for (const cls of IP_LOOKUP_ORDER) {
    const h = hits.find((x) => x.cls === cls);
    if (h) return h.id;
  }
  return hits[0].id;
}

function breakParentCycles(entities) {
  for (const ent of entities.values()) {
    const seen = new Set([ent.id]);
    let cur = ent;
    while (cur.parent) {
      if (seen.has(cur.parent)) { cur.parent = null; break; }
      seen.add(cur.parent);
      cur = entities.get(cur.parent);
      if (!cur) break;
    }
  }
}

function portsCompatible(p, q) {
  return !p || !q || normPort(p) === normPort(q);
}

function normPort(p) {
  return String(p).toLowerCase().replace(/\s+/g, '');
}

function mergeLinkInto(o, item) {
  o.px = o.px || item.px;
  o.py = o.py || item.py;
  o.speedBps = Math.max(o.speedBps || 0, item.speedBps || 0) || null;
  if (item.status) o.status = o.status ? worstStatus(o.status, item.status) : item.status;
  if (item.statusText && !o.statusText) o.statusText = item.statusText;
  if (item.pri > o.pri && item.kind) o.kind = item.kind;
  if (item.label && !o.label) o.label = item.label;
  if (item.at >= o.at && Object.keys(item.metrics || {}).length) o.metrics = { ...o.metrics, ...item.metrics };
  if (!o.sources.includes(item.src)) o.sources.push(item.src);
}

// ---------------------------------------------------------------------------
// Seuils
// ---------------------------------------------------------------------------

function mergeThresholds(custom = {}) {
  const out = {};
  for (const [k, v] of Object.entries(DEFAULT_THRESHOLDS)) out[k] = { ...v, ...(custom?.[k] || {}) };
  for (const [k, v] of Object.entries(custom || {})) if (!out[k] && k !== 'byType') out[k] = { ...v };
  out.byType = {
    storage: { latencyMs: { warning: 5, critical: 20, label: 'Latence E/S', unit: ' ms' } },
    ...(custom?.byType || {}),
  };
  return out;
}

export function evaluateMetric(name, value, thresholds, type) {
  const t = { ...(thresholds[name] || {}), ...(thresholds.byType?.[type]?.[name] || {}) };
  if (value == null || t.warning == null && t.critical == null) return null;
  const label = t.label || name;
  const unit = t.unit ?? '';
  if (t.critical != null && value >= t.critical) return { status: 'critical', text: `${label} ${fmt(value)}${unit} (seuil ${t.critical}${unit})` };
  if (t.warning != null && value >= t.warning) return { status: 'warning', text: `${label} ${fmt(value)}${unit} (seuil ${t.warning}${unit})` };
  return null;
}

function applyThresholds(ent, thresholds) {
  if (ent.status === 'off' || ent.stale) return;
  const texts = [];
  let status = null;
  for (const name of Object.keys(ent.metrics)) {
    if (name === 'util') continue;
    const r = evaluateMetric(name, ent.metrics[name], thresholds, ent.type);
    if (!r) continue;
    status = status ? worstStatus(status, r.status) : r.status;
    texts.push(r.text);
  }
  if (!status) return;
  const before = ent.status;
  ent.status = worstStatus(ent.status === 'unknown' ? 'ok' : ent.status, status);
  if (statusRank(ent.status) > statusRank(before) || !ent.statusText) {
    ent.statusText = [...texts, ent.statusText].filter(Boolean).join(' ; ');
  } else {
    ent.statusText = [ent.statusText, ...texts].filter(Boolean).join(' ; ');
  }
}

function applyLinkThresholds(link, thresholds) {
  const util = link.metrics?.util;
  if (util == null || link.status === 'critical') return;
  const r = evaluateMetric('util', util, thresholds, 'link');
  if (!r) return;
  link.status = worstStatus(link.status === 'unknown' ? 'ok' : link.status, r.status);
  link.statusText = r.text;
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

function diffMap(prev, next) {
  const set = [];
  const del = [];
  const seen = new Set();
  for (const [id, obj] of next) {
    seen.add(id);
    const json = JSON.stringify(obj);
    if (prev.get(id) !== json) { set.push(obj); prev.set(id, json); }
  }
  for (const id of [...prev.keys()]) {
    if (!seen.has(id)) { del.push(id); prev.delete(id); }
  }
  return { set, del };
}

class UnionFind {
  constructor(n) { this.p = Array.from({ length: n }, (_, i) => i); }
  find(i) {
    while (this.p[i] !== i) { this.p[i] = this.p[this.p[i]]; i = this.p[i]; }
    return i;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.p[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

function fmt(v) {
  return String(Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10).replace('.', ',');
}

function round3(v) {
  if (!v) return v;
  const p = 10 ** Math.max(0, 2 - Math.floor(Math.log10(Math.abs(v))));
  return Math.round(v * p) / p;
}

function slug(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
