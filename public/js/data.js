// Modele cote navigateur : topologie recue du serveur (snapshot puis deltas SSE).
import { worstStatus, statusRank } from '/shared/model.js';
import { buildIndex } from '/shared/graph.js';

export class TopologyModel extends EventTarget {
  constructor() {
    super();
    this.entities = new Map();
    this.links = new Map();
    this.flows = new Map();
    this.alarms = [];
    this.collectors = [];
    this.version = 0;
    this.index = null;
    this.agg = new Map();
    this.children = new Map();
    this.structureKey = '';
  }

  applySnapshot(s) {
    this.entities = new Map(s.entities.map((e) => [e.id, e]));
    this.links = new Map(s.links.map((l) => [l.id, l]));
    this.flows = new Map(s.flows.map((f) => [f.id, f]));
    this.alarms = s.alarms || [];
    if (s.collectors) this.collectors = s.collectors;
    this.version = s.version;
    this.recompute({ structure: true, metrics: true, flows: true, links: true, alarms: true, collectors: true });
  }

  applyDelta(d) {
    let structure = false;
    for (const e of d.entities.set) {
      const prev = this.entities.get(e.id);
      if (!prev || prev.parent !== e.parent || prev.type !== e.type || prev.attrs?.u !== e.attrs?.u ||
          prev.attrs?.rowIndex !== e.attrs?.rowIndex || prev.attrs?.slot !== e.attrs?.slot || prev.name !== e.name) structure = true;
      this.entities.set(e.id, e);
    }
    for (const id of d.entities.del) { this.entities.delete(id); structure = true; }
    let linksStructure = false;
    for (const l of d.links.set) { if (!this.links.has(l.id)) linksStructure = true; this.links.set(l.id, l); }
    for (const id of d.links.del) { this.links.delete(id); linksStructure = true; }
    for (const f of d.flows.set) this.flows.set(f.id, f);
    for (const id of d.flows.del) this.flows.delete(id);
    if (d.alarms) this.alarms = d.alarms;
    this.version = d.version;
    this.recompute({
      structure: structure || linksStructure,
      metrics: d.entities.set.length > 0,
      links: d.links.set.length > 0 || d.links.del.length > 0,
      flows: d.flows.set.length > 0 || d.flows.del.length > 0 || structure,
      alarms: !!d.alarms,
    });
  }

  setCollectors(list) {
    this.collectors = list;
    this.dispatchEvent(new CustomEvent('change', { detail: { collectors: true } }));
  }

  recompute(flags) {
    this.index = buildIndex(this.entities.values(), this.links.values());
    this.children = this.index.children;
    this.computeAggregates();
    this.dispatchEvent(new CustomEvent('change', { detail: flags }));
  }

  /** Statut agrege (pire statut de l'entite et de ses descendants). */
  computeAggregates() {
    const agg = new Map();
    const visit = (id, depth = 0) => {
      if (agg.has(id)) return agg.get(id);
      const e = this.entities.get(id);
      let s = e && e.status !== 'unknown' && e.status !== 'off' ? e.status : 'unknown';
      if (depth < 12) {
        for (const c of this.children.get(id) || []) {
          const cs = visit(c, depth + 1);
          if (cs !== 'unknown') s = s === 'unknown' ? cs : worstStatus(s, cs);
        }
      }
      agg.set(id, s);
      return s;
    };
    for (const id of this.entities.keys()) visit(id);
    this.agg = agg;
  }

  get(id) { return this.entities.get(id); }

  ancestors(id) {
    const chain = [];
    const seen = new Set();
    let cur = this.entities.get(id);
    while (cur && cur.parent && !seen.has(cur.parent)) {
      seen.add(cur.parent);
      cur = this.entities.get(cur.parent);
      if (cur) chain.unshift(cur);
    }
    return chain;
  }

  descendants(id, out = new Set()) {
    for (const c of this.children.get(id) || []) {
      if (out.has(c)) continue;
      out.add(c);
      this.descendants(c, out);
    }
    return out;
  }

  counts() {
    const c = { ok: 0, warning: 0, critical: 0, unknown: 0, off: 0 };
    for (const e of this.entities.values()) {
      if (e.type === 'site' || e.type === 'room' || e.type === 'rack') continue;
      c[e.status] = (c[e.status] || 0) + 1;
    }
    return c;
  }

  activeAlarms() {
    return this.alarms.filter((a) => !a.acked);
  }

  /** Recherche plein texte (nom, id, IP, nom d'hote...). */
  search(q, limit = 12) {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const res = [];
    for (const e of this.entities.values()) {
      let score = 0;
      const name = (e.name || '').toLowerCase();
      if (name === s) score = 100;
      else if (name.startsWith(s)) score = 80;
      else if (name.includes(s)) score = 60;
      else if (e.id.toLowerCase().includes(s)) score = 40;
      else if ((e.keys || []).some((k) => k.slice(k.indexOf(':') + 1).startsWith(s))) score = 50;
      else if (Object.values(e.attrs || {}).some((v) => typeof v === 'string' && v.toLowerCase().includes(s))) score = 20;
      if (score) res.push({ e, score: score + statusRank(e.status) });
    }
    res.sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name));
    return res.slice(0, limit).map((r) => r.e);
  }
}

/** Connexion temps reel (Server-Sent Events) avec reconnexion automatique. */
export function connect(model, { onState } = {}) {
  let es;
  let retry = 1000;
  const open = () => {
    onState?.('connecting');
    es = new EventSource('/api/events');
    es.addEventListener('snapshot', (ev) => {
      retry = 1000;
      model.applySnapshot(JSON.parse(ev.data));
      onState?.('live');
    });
    es.addEventListener('delta', (ev) => {
      const d = JSON.parse(ev.data);
      if (d.version !== model.version + 1 && model.version !== 0) {
        // delta manque : on se resynchronise
        es.close();
        open();
        return;
      }
      model.applyDelta(d);
    });
    es.addEventListener('collectors', (ev) => model.setCollectors(JSON.parse(ev.data)));
    es.onerror = () => {
      onState?.('error');
      if (es.readyState === EventSource.CLOSED) {
        setTimeout(open, retry);
        retry = Math.min(retry * 2, 15000);
      }
    };
  };
  open();
  return () => es?.close();
}
