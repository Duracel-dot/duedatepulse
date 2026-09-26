// Classe de base des collecteurs.
//
// Un collecteur produit periodiquement un "snapshot" COMPLET de ce qu'il voit
// (voir docs/COLLECTEURS.md). Chaque snapshot remplace le precedent de la meme
// source ; le magasin (server/model/store.js) fusionne toutes les sources.
export class Collector {
  /**
   * @param {object} cfg  bloc de configuration du collecteur ({type, name, interval, ...})
   * @param {object} ctx  {publish(sourceId, snapshot, opts), store, logger, config, paths}
   */
  constructor(cfg, ctx) {
    this.cfg = cfg;
    this.ctx = ctx;
    this.type = cfg.type;
    this.name = cfg.name || cfg.type;
    this.sourceId = cfg.sourceId || this.name;
    this.intervalMs = Math.max(1, Number(cfg.interval ?? this.defaultInterval())) * 1000;
    this.timeoutMs = Math.max(1, Number(cfg.timeout ?? 120)) * 1000;
    this.priority = cfg.priority ?? 10;
    this.log = ctx.logger.child(this.name);
    this.state = {
      name: this.name, type: this.type, state: 'starting', lastRun: null, lastSuccess: null,
      lastDurationMs: null, lastError: null, counts: null, runs: 0, errors: 0,
    };
    this.timer = null;
    this.running = false;
    this.stopped = false;
  }

  /** Intervalle par defaut en secondes. */
  defaultInterval() { return 60; }

  /** A surcharger : retourne un snapshot {entities, links, flows}. */
  async poll() { throw new Error('poll() non implemente'); }

  async start() {
    this.stopped = false;
    this.loop();
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.state.state = 'stopped';
  }

  async loop() {
    if (this.stopped) return;
    await this.runOnce();
    if (this.stopped) return;
    this.timer = setTimeout(() => this.loop(), this.intervalMs);
    this.timer.unref?.();
  }

  async runOnce() {
    if (this.running) return;
    this.running = true;
    const t0 = Date.now();
    this.state.lastRun = new Date(t0).toISOString();
    this.state.runs++;
    try {
      const snapshot = await withTimeout(this.poll(), this.timeoutMs, `${this.name} : delai depasse`);
      if (snapshot) this.publish(snapshot);
      if (this.state.state === 'error') this.log.info('collecte retablie');
      this.state.state = 'ok';
      this.state.lastError = null;
      this.state.lastSuccess = new Date().toISOString();
    } catch (err) {
      const msg = err?.message || String(err);
      // une erreur identique a la precedente n'est journalisee qu'en debug
      if (msg !== this.state.lastError) this.log.warn(`echec de collecte : ${msg}`);
      else this.log.debug(`echec de collecte : ${msg}`);
      this.state.state = 'error';
      this.state.errors++;
      this.state.lastError = msg;
    } finally {
      this.state.lastDurationMs = Date.now() - t0;
      this.running = false;
    }
  }

  publish(snapshot) {
    this.state.counts = {
      entities: snapshot.entities?.length || 0,
      links: snapshot.links?.length || 0,
      flows: snapshot.flows?.length || 0,
    };
    this.ctx.publish(this.sourceId, snapshot, { priority: this.priority, collector: this.name });
  }

  status() {
    return { ...this.state, interval: this.intervalMs / 1000 };
  }
}

export function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(timer));
}
