// Palette de la vue 3D.
import * as THREE from 'three';

export const STATUS_COLORS = {
  ok: '#22c55e',
  warning: '#f59e0b',
  critical: '#ef4444',
  unknown: '#64748b',
  off: '#334155',
};

export const TYPE_COLORS = {
  server: '#273244',
  storage: '#1d3a5c',
  appliance: '#2b313d',
  pdu: '#2d2a1a',
  ups: '#3a3320',
  switch: '#123a52',
  router: '#2e2657',
  firewall: '#552222',
  loadbalancer: '#174a3c',
  accesspoint: '#1f3b4d',
};

export const EXTERNAL_COLORS = {
  internet: '#60a5fa',
  cloud: '#a78bfa',
  wan: '#22d3ee',
  site: '#34d399',
  users: '#fbbf24',
  lan: '#94a3b8',
  network: '#94a3b8',
};

const cache = new Map();
export function color(hex) {
  let c = cache.get(hex);
  if (!c) { c = new THREE.Color(hex); cache.set(hex, c); }
  return c;
}

export function statusColor(status) {
  return color(STATUS_COLORS[status] || STATUS_COLORS.unknown);
}

// Degrade "carte de chaleur" 0-100 : bleu -> vert -> jaune -> orange -> rouge
const HEAT = [
  [0, new THREE.Color('#1e40af')],
  [30, new THREE.Color('#0ea5e9')],
  [55, new THREE.Color('#22c55e')],
  [75, new THREE.Color('#eab308')],
  [88, new THREE.Color('#f97316')],
  [100, new THREE.Color('#dc2626')],
];

export function heatColor(v, out = new THREE.Color()) {
  if (v == null || Number.isNaN(v)) return out.set('#475569');
  const x = Math.max(0, Math.min(100, v));
  for (let i = 1; i < HEAT.length; i++) {
    if (x <= HEAT[i][0]) {
      const [a, ca] = HEAT[i - 1];
      const [b, cb] = HEAT[i];
      return out.copy(ca).lerp(cb, (x - a) / (b - a));
    }
  }
  return out.copy(HEAT[HEAT.length - 1][1]);
}

/** Echelle de temperature -> 0-100 pour la carte de chaleur (20 C -> 0, 85 C -> 100). */
export function tempToHeat(t) {
  return t == null ? null : ((t - 20) / 65) * 100;
}

/** Couleur d'un lien selon son etat et son taux d'utilisation. */
export function linkColor(link, out = new THREE.Color()) {
  if (link.status === 'critical' && !(link.metrics?.util > 0)) return out.set(STATUS_COLORS.critical);
  const u = link.metrics?.util;
  if (u == null) return out.set(link.kind === 'wan' ? '#22d3ee' : '#3b82f6');
  if (u < 40) return out.set('#38bdf8').lerp(color('#22c55e'), u / 40);
  if (u < 75) return out.set('#22c55e').lerp(color('#eab308'), (u - 40) / 35);
  return out.set('#f59e0b').lerp(color('#ef4444'), Math.min(1, (u - 75) / 20));
}
