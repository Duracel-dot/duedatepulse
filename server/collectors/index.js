// Registre des collecteurs : type -> module (charge a la demande, pour qu'un
// module optionnel absent, ex. net-snmp, n'empeche pas les autres de tourner).
const REGISTRY = {
  demo: './demo.js',
  inventory: './inventory.js',
  windows: './windows.js',
  hyperv: './hyperv.js',
  vsphere: './vsphere.js',
  proxmox: './proxmox.js',
  snmp: './snmp.js',
  netflow: './netflow.js',
  ping: './ping.js',
};

export const COLLECTOR_TYPES = Object.keys(REGISTRY);

export async function createCollector(cfg, ctx) {
  const modPath = REGISTRY[cfg.type];
  if (!modPath) throw new Error(`type de collecteur inconnu : ${cfg.type} (types : ${COLLECTOR_TYPES.join(', ')})`);
  const mod = await import(modPath);
  return mod.default(cfg, ctx);
}
