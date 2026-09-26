// Historique court des metriques (tampons circulaires en Float32Array) pour les
// mini-graphes du panneau de detail. Aucune persistance : c'est une vue "live".
const TRACKED = ['cpu', 'mem', 'disk', 'temp', 'rxBps', 'txBps', 'latencyMs', 'powerW'];

export class History {
  /** @param {{size?:number, stepMs?:number}} opts  size echantillons, espaces d'au moins stepMs */
  constructor(opts = {}) {
    this.size = opts.size ?? 360;
    this.stepMs = opts.stepMs ?? 10000;
    this.series = new Map();
  }

  record(entities, now = Date.now()) {
    for (const ent of entities.values()) {
      const m = ent.metrics;
      if (!m) continue;
      const present = TRACKED.filter((k) => typeof m[k] === 'number');
      if (!present.length) continue;
      let s = this.series.get(ent.id);
      if (!s) {
        s = { t: new Float64Array(this.size), v: {}, idx: 0, count: 0, last: 0 };
        this.series.set(ent.id, s);
      }
      if (now - s.last < this.stepMs) continue;
      s.last = now;
      const i = s.idx;
      s.t[i] = now;
      for (const k of TRACKED) {
        if (!s.v[k] && typeof m[k] === 'number') s.v[k] = new Float32Array(this.size).fill(NaN);
        if (s.v[k]) s.v[k][i] = typeof m[k] === 'number' ? m[k] : NaN;
      }
      s.idx = (i + 1) % this.size;
      s.count = Math.min(s.count + 1, this.size);
    }
    for (const id of this.series.keys()) if (!entities.has(id)) this.series.delete(id);
  }

  /** @returns {{t:number[], [metric]: (number|null)[]}} */
  get(id) {
    const s = this.series.get(id);
    if (!s) return { t: [] };
    const out = { t: [] };
    const start = (s.idx - s.count + this.size) % this.size;
    for (const k of Object.keys(s.v)) out[k] = [];
    for (let n = 0; n < s.count; n++) {
      const i = (start + n) % this.size;
      out.t.push(s.t[i]);
      for (const k of Object.keys(s.v)) {
        const v = s.v[k][i];
        out[k].push(Number.isNaN(v) ? null : Math.round(v * 100) / 100);
      }
    }
    return out;
  }
}
