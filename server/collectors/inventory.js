// Collecteur "inventaire" : lit config/inventory.json (JSONC) et le republie a
// chaque modification du fichier. Priorite maximale : l'inventaire fait foi
// pour le nom, l'emplacement physique et le cablage declare.
import fs from 'node:fs';
import { Collector } from './base.js';
import { readJsoncFile } from '../util/jsonc.js';
import { inventoryToSnapshot } from '../model/inventory.js';

class InventoryCollector extends Collector {
  constructor(cfg, ctx) {
    super({ priority: 100, ...cfg, name: cfg.name || 'inventaire', sourceId: cfg.sourceId || 'inventory' }, ctx);
    this.file = cfg.file;
    this.lastMtime = 0;
  }

  defaultInterval() { return 10; }

  async poll() {
    if (!this.file || !fs.existsSync(this.file)) {
      throw new Error(`fichier d'inventaire introuvable : ${this.file}`);
    }
    const st = fs.statSync(this.file);
    if (st.mtimeMs === this.lastMtime) return null;
    const inv = readJsoncFile(this.file);
    const { snapshot, networks, warnings } = inventoryToSnapshot(inv);
    for (const w of warnings) this.log.warn(w);
    this.ctx.setInventoryNetworks?.(networks);
    this.lastMtime = st.mtimeMs;
    this.log.info(`inventaire charge : ${snapshot.entities.length} entites, ${snapshot.links.length} liens`);
    return snapshot;
  }
}

export default function create(cfg, ctx) {
  return new InventoryCollector(cfg, ctx);
}
