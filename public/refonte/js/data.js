// Scénario et modèle d'état de la démo « refonte ».
// Le temps est exprimé en secondes relatives à « maintenant » (0 = direct, négatif = passé).
import WORLD from './world.js';

export { WORLD };

// Jetons de la piste A « Maquette & calques » (docs/refonte/README.md § 3).
export const P = {
  bg: '#12161C', surface: '#181D24', raised: '#1F252E', hairline: '#2A313B', edge: '#3B434E',
  ink: '#8A94A0', inkLight: '#DDE1E6', disabled: '#5A636E', ivory: '#F5F1E8', temporal: '#B78CFF',
  critical: '#FF5A47', major: '#F5A524', minor: '#E8D44D',
  metric: ['#1B2633', '#2F4E6E', '#4F7FAE', '#7AA5D2', '#9CC3EA'],
  flow: { web: '#6E9CC0', database: '#8E97CF', auth: '#5FAFA8', storage: '#86B59A', replication: '#A9BCD0', other: '#7D8791' },
};

// Instant de chargement de la page : le temps de la démo est compté en secondes à partir de là.
export const BASE = Date.now();
export const nowT = () => (Date.now() - BASE) / 1000;

// Incident : esx-par-08 perd ses deux alimentations 3 min 12 s avant l'ouverture de la page.
export const T0 = -192;
export const RESTARTED = { 'app-portail-02': 'esx-par-09', 'rds-sh-03': 'esx-par-07', 'k8s-worker-04': 'esx-par-10' };
const HOST08_VMS = WORLD.vms.filter((v) => v.host === 'esx-par-08').map((v) => v.name);

// ---------------------------------------------------------------- événements
// prio : 1 critique, 2 majeur, 3 mineur, 0 maintenance. group : identifiant de la cause racine.
const E = [];
const ev = (o) => E.push({ end: Infinity, group: null, ack: null, ...o });

ev({ id: 'psu1', prio: 2, obj: 'esx-par-08', title: 'Alimentation PSU1 en défaut', detail: 'redondance électrique perdue · Redfish', start: T0 - 95, end: T0, source: 'redfish' });
ev({ id: 'esx08', prio: 1, obj: 'esx-par-08', title: 'Hôte injoignable', detail: 'cause probable : PSU1 et PSU2 en défaut', start: T0, root: true, source: 'vcenter-par · ping · redfish' });
ev({ id: 'lnk1', prio: 2, obj: 'tor-a06-1', title: 'Lien Eth1/2 down', detail: 'vers esx-par-08 vmnic0', start: T0 + 5, group: 'esx08', source: 'snmp-reseau' });
ev({ id: 'lnk2', prio: 2, obj: 'tor-a06-2', title: 'Lien Eth1/2 down', detail: 'vers esx-par-08 vmnic1', start: T0 + 5, group: 'esx08', source: 'snmp-reseau' });
for (const vm of HOST08_VMS) {
  const restarted = RESTARTED[vm];
  ev({ id: `vm-${vm}`, prio: 2, obj: vm, title: 'VM injoignable', detail: restarted ? `redémarrée par HA sur ${restarted}` : 'non redémarrée : réserve N+1 insuffisante', start: T0 + 10, end: restarted ? T0 + 50 : Infinity, group: 'esx08', source: 'vcenter-par' });
}
ev({ id: 'svc-crm', prio: 1, obj: 'svc:crm', title: 'Service interrompu', detail: 'CRM · dépend de crm-db-01', start: T0 + 12, group: 'esx08', source: 'règles de service' });
ev({ id: 'svc-pki', prio: 1, obj: 'svc:pki', title: 'Service interrompu', detail: 'PKI · instance unique pki-01', start: T0 + 12, group: 'esx08', source: 'règles de service' });
for (const [id, name] of [['portail', 'Portail clients'], ['rds', 'Bureaux à distance'], ['k8s', 'Kubernetes']]) {
  ev({ id: `svc-${id}`, prio: 3, obj: `svc:${id}`, title: 'Service dégradé', detail: `${name} · redondance N+1 tenue`, start: T0 + 12, group: 'esx08', source: 'règles de service' });
}
ev({ id: 'cl-n1', prio: 2, obj: 'CL-PROD-PAR', title: 'Réserve N+1 consommée', detail: '9/10 hôtes · corrélé à esx-par-08', start: T0 + 30, source: 'vcenter-par' });
ev({ id: 'a04', prio: 2, obj: 'A04', title: 'T° d’entrée 28,4 °C', detail: 'seuil 27 °C · sonde avant haute', start: -760, ack: { by: 'Astreinte DC', comment: 'CLIM 2 en dégivrage, retour prévu 15 min', at: -640 }, source: 'snmp-salle' });
ev({ id: 'lic', prio: 2, obj: 'lic-par-01', title: 'Perte de supervision', detail: 'aucune donnée depuis 3 intervalles', start: -900, source: 'windows' });
ev({ id: 'transit', prio: 2, obj: 'rtr-par-1', title: 'Transit 1 saturé', detail: 'p95 81 % sur 24 h · Gi0/0/0', start: -8040, ack: { by: 'Réseau', comment: 'Augmentation de débit commandée à l’opérateur', at: -7200 }, source: 'snmp-reseau' });
ev({ id: 'stor', prio: 3, obj: 'stor-par-1', title: 'vm_nfs01 plein le 14/11', detail: 'projection ± 6 j · 81 % utilisé', start: -86400, source: 'métrologie' });
ev({ id: 'sqlbk', prio: 3, obj: 'sql-par-01', title: 'Sauvegarde plus longue', detail: '+38 % par rapport aux 4 dernières semaines', start: -22200, source: 'métrologie' });
ev({ id: 'cert', prio: 3, obj: 'hv-par-03', title: 'Certificat WinRM', detail: 'expire dans 21 j', start: -259200, source: 'windows' });
ev({ id: 'bkp', prio: 0, obj: 'bkp-par-01', title: 'En maintenance', detail: 'mise à jour Veeam · 2 alarmes suspendues', start: -5400, source: 'planification' });

export const EVENTS = E;
export const EVENT_BY_ID = new Map(E.map((e) => [e.id, e]));

export const ACK_TEMPLATES = ['Diagnostic en cours', 'Intervention sur site', 'Attente fournisseur', 'Escaladé au N2'];

// ---------------------------------------------------------------- objets
const deviceIndex = new Map();
for (const row of WORLD.room.rows) for (const rack of row.racks) for (const d of rack.devices) deviceIndex.set(d.id, { ...d, rack: rack.id, row: row.name });
const hostIndex = new Map(WORLD.hosts.map((h) => [h.id, h]));
const vmIndex = new Map(WORLD.vms.map((v) => [v.name, v]));

export const SERVICE_NAMES = {
  'svc:portail': 'Portail clients', 'svc:k8s': 'Kubernetes', 'svc:rds': 'Bureaux à distance', 'svc:crm': 'CRM', 'svc:erp': 'ERP',
  'svc:mail': 'Messagerie', 'svc:pki': 'PKI', 'svc:ad': 'Annuaire AD/DNS', 'svc:dfs': 'Fichiers DFS', 'svc:sql': 'SQL Always On',
};

/** Décrit un objet à partir de son identifiant (équipement, hôte, VM, baie, cluster, service). */
export function describe(id) {
  if (!id) return null;
  if (id.startsWith('svc:')) return { id, kind: 'service', name: SERVICE_NAMES[id] || id };
  if (/^[AB]0\d$/.test(id)) return { id, kind: 'rack', name: `Baie ${id}`, rack: id };
  if (/^(CL|HVCL|PVE)-/.test(id)) return { id, kind: 'cluster', name: id, hosts: WORLD.hosts.filter((h) => h.cluster === id) };
  const vm = vmIndex.get(id);
  if (vm) return { id, kind: 'vm', name: id, vm };
  const dev = deviceIndex.get(id);
  const host = hostIndex.get(id);
  if (dev || host) return { id, kind: host ? 'host' : 'device', name: id, device: dev, host };
  return { id, kind: 'autre', name: id };
}

export function rackOf(id) {
  const d = deviceIndex.get(id);
  if (d) return d.rack;
  const vm = vmIndex.get(id);
  if (vm) return deviceIndex.get(vm.host)?.rack || null;
  if (/^[AB]0\d$/.test(id)) return id;
  return null;
}

export function searchObjects(q) {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const out = [];
  const push = (id, kind, sub) => { if (out.length < 12) out.push({ id, kind, sub }); };
  for (const [id, name] of Object.entries(SERVICE_NAMES)) if (name.toLowerCase().includes(s)) push(id, 'service', name);
  for (const d of deviceIndex.values()) if (d.id.includes(s) || (d.ip || '').startsWith(s)) push(d.id, d.type, `${d.rack} U${d.u} · ${d.ip || d.model}`);
  for (const v of WORLD.vms) if (v.name.includes(s) || (v.ip || '').startsWith(s) || (v.app || '').toLowerCase().includes(s)) push(v.name, 'vm', `${v.app} · ${v.ip}`);
  return out;
}

// ---------------------------------------------------------------- état à l'instant t
function activeAt(e, t) { return e.start <= t && t < e.end; }

/**
 * Calcule l'état complet de l'infrastructure à l'instant t (s, relatif à maintenant).
 * acks : prises en charge faites pendant la session { [eventId]: {by, comment, at} }.
 */
export function stateAt(t, acks = {}) {
  const events = [];
  for (const e of E) {
    if (!activeAt(e, t)) continue;
    const ack = acks[e.id] && acks[e.id].at <= t ? acks[e.id] : (e.ack && e.ack.at <= t ? e.ack : null);
    events.push({ ...e, age: t - e.start, ackNow: ack });
  }
  const roots = events.filter((e) => !e.group);
  for (const r of roots) r.children = events.filter((c) => c.group === r.id);
  roots.sort((a, b) => (prioRank(a) - prioRank(b)) || (!!a.ackNow - !!b.ackNow) || (a.start - b.start) * -1);

  // états par objet : root | critical | major | minor | unreach | maint | ok
  const obj = new Map();
  const set = (id, st) => { const cur = obj.get(id); if (!cur || RANK[st] < RANK[cur]) obj.set(id, st); };
  for (const e of events) {
    if (e.prio === 0) set(e.obj, 'maint');
    else if (e.root) set(e.obj, 'root');
    else if (e.id.startsWith('vm-')) set(e.obj, 'unreach');
    else if (e.obj.startsWith('svc:')) set(e.obj, e.prio === 1 ? 'down' : 'degraded');
    else if (e.id.startsWith('lnk')) { /* le lien, pas l'équipement */ }
    else set(e.obj, e.prio === 1 ? 'critical' : e.prio === 2 ? 'major' : 'minor');
  }
  const links = new Map();
  for (const e of events) if (e.id.startsWith('lnk')) links.set(`${e.obj}:Eth1/2`, 'down');

  // placement courant des VM (HA a redémarré trois VM ailleurs)
  const vmHost = new Map(WORLD.vms.map((v) => [v.name, v.host]));
  if (t >= T0 + 50) for (const [vm, host] of Object.entries(RESTARTED)) vmHost.set(vm, host);

  const counters = { 1: 0, 2: 0, 3: 0 };
  for (const r of roots) if (r.prio > 0 && !r.ackNow) counters[r.prio]++;
  const incident = t >= T0;
  return { t, events, roots, obj, links, vmHost, counters, incident, afterHA: t >= T0 + 50, n1Consumed: t >= T0 + 30 };
}

const RANK = { root: 0, critical: 1, down: 1, unreach: 2, major: 3, degraded: 4, minor: 5, maint: 6, ok: 7 };
function prioRank(e) { return e.prio === 0 ? 9 : e.prio; }

// ---------------------------------------------------------------- séries de mesure
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let x = a; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// profil journalier (heure locale) : montée à 8 h, plateau, décrue à 19 h, week-end calme
function dayProfile(hour, weekday) {
  const w = weekday >= 5 ? 0.35 : 1;
  const v = hour < 7 ? 0.05 : hour < 9 ? (hour - 7) / 2 : hour < 12 ? 0.95 : hour < 14 ? 0.8 : hour < 18 ? 0.9 : hour < 21 ? 0.9 - (hour - 18) * 0.28 : 0.08;
  return Math.max(0, v * w);
}

export const METRICS = {
  cpu: { label: 'CPU', unit: '%', max: 100, thr: 85 },
  mem: { label: 'Mémoire', unit: '%', max: 100, thr: 90 },
  net: { label: 'Réseau', unit: '% capacité', max: 100, thr: 75 },
  temp: { label: 'T° d’entrée', unit: '°C', max: 35, thr: 27 },
};

export const PERIODS = { '24h': { span: 86400, step: 300, label: '24 h · pas 5 min' }, '7j': { span: 604800, step: 3600, label: '7 j · pas 1 h (p95)' }, '30j': { span: 2592000, step: 14400, label: '30 j · pas 4 h (p95)' } };

/**
 * Série synthétique déterministe pour un objet et une mesure, se terminant à `end` (s relatif).
 * Retourne { t:[], v:[], lo:[], hi:[], prev:[] } ; v contient null pendant les trous de collecte.
 */
export function series(id, metric, periodKey = '7j', end = 0) {
  const { span, step } = PERIODS[periodKey];
  const n = Math.floor(span / step) + 1;
  const d = describe(id);
  const base = d?.vm ? { cpu: d.vm.cpuBase, mem: d.vm.memBase } : {};
  const seed = hash(`${id}|${metric}`);
  const rnd = mulberry(seed);
  const out = { t: [], v: [], lo: [], hi: [], prev: [] };
  const amp = metric === 'temp' ? 1.6 : metric === 'mem' ? 6 : 34;
  const lvl = metric === 'temp' ? 22.6 + (seed % 10) / 10 : metric === 'mem' ? (base.mem || 55 + (seed % 25)) : metric === 'net' ? 14 + (seed % 12) : (base.cpu ? base.cpu * 0.6 : 16 + (seed % 14));
  const noiseA = metric === 'temp' ? 0.22 : metric === 'mem' ? 1.2 : 4.5;
  const special = SPECIAL[`${id}|${metric}`];
  for (let i = 0; i < n; i++) {
    const tt = end - span + i * step;
    const date = new Date(BASE + tt * 1000);
    const prof = dayProfile(date.getHours() + date.getMinutes() / 60, (date.getDay() + 6) % 7);
    let v = lvl + amp * prof + (rnd() - 0.5) * 2 * noiseA;
    if (special) v = special(v, tt, date);
    const expected = lvl + amp * prof;
    out.t.push(tt);
    out.lo.push(Math.max(0, expected - noiseA * 2.2));
    out.hi.push(expected + noiseA * 2.2);
    out.prev.push(expected * 0.95 + (rnd() - 0.5) * noiseA * 1.4);
    if (id === 'esx-par-08' && tt >= T0) v = null;
    if (id === 'lic-par-01' && tt >= -900) v = null;
    out.v.push(v == null ? null : Math.max(0, metric === 'temp' ? v : Math.min(100, v)));
  }
  return out;
}

const SPECIAL = {
  'esx-par-07|cpu': (v, t) => v + (t >= T0 + 50 ? 22 : 0),
  'esx-par-07|mem': (v, t) => v + (t >= T0 + 50 ? 17 : 0),
  'esx-par-09|cpu': (v, t) => v + (t >= T0 + 50 ? 8 : 0),
  'sql-par-01|cpu': (v, t, d) => v + (d.getHours() === 2 || d.getHours() === 3 ? 48 : 0),
  'stor-par-1|net': (v, t, d) => v + (d.getHours() >= 22 || d.getHours() <= 1 ? 44 : 0),
  'A04|temp': (v, t) => (t >= -760 ? 28.4 + Math.sin(t / 90) * 0.2 : v + 2.4),
  'tor-a06-1|net': (v, t) => (t >= T0 + 5 ? v * 0.72 : v),
  'rtr-par-1|net': (v) => v + 38,
};

/** Mesures disponibles pour un objet (les autres sont « non mesurées »). */
export function metricsFor(id) {
  const d = describe(id);
  if (!d) return [];
  if (d.kind === 'rack') return ['temp'];
  if (d.kind === 'vm') return ['cpu', 'mem', 'net'];
  if (d.kind === 'host') return ['cpu', 'mem', 'net', 'temp'];
  if (d.device?.type === 'switch' || d.device?.type === 'router') return ['net', 'temp'];
  if (d.device?.type === 'storage') return ['cpu', 'net'];
  if (d.device) return ['cpu', 'mem', 'net'];
  return [];
}

// ---------------------------------------------------------------- formats
export function fmtAge(s) {
  s = Math.max(0, Math.round(s));
  if (s >= 172800) return `${Math.floor(s / 86400)} j`;
  if (s >= 86400) return '1 j';
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const x = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
}
export function fmtClock(t, withSeconds = true) {
  const d = new Date(BASE + t * 1000);
  const hh = String(d.getHours()).padStart(2, '0'); const mm = String(d.getMinutes()).padStart(2, '0'); const ss = String(d.getSeconds()).padStart(2, '0');
  return withSeconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
}
export function fmtDay(t) {
  return new Date(BASE + t * 1000).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

// ---------------------------------------------------------------- état global (au-dessus des pannes)
// Signaux retenus par le conseil de production (docs/refonte/CONSEIL-PRODUCTION.md) : ce ne sont pas des
// pannes mais des marges qui s'usent. Chaque signal a sa propre variable visuelle dans la démo spatiale.

/**
 * Signaux d'état global à l'instant t.
 * - redondance : 'tenue' | 'mince' | 'perdue' (la prochaine panne banale devient une crise)
 * - marge : niveau 1 (mince) ou 2 (proche de la limite) pour la capacité, le thermique, la contention
 * - changements : interventions en cours (planifiées ou non), avec leur avancement
 * - budget : vitesse de consommation du budget d'erreur d'un service (1 = rythme prévu)
 * - horsRegime : trafic inhabituel sur un lien (secours actif, flux hors fenêtre)
 * - perimes : objets sans donnée depuis plus de 3 intervalles
 */
export function globalAt(t) {
  const afterHA = t >= T0 + 50;
  const inc = t >= T0;
  const redondance = [
    { id: 'CL-PROD-PAR', niveau: t >= T0 + 30 ? 'perdue' : 'tenue', detail: t >= T0 + 30 ? '9/10 hôtes : une panne de plus ne passe pas' : 'N+1 disponible' },
    { id: 'transit', niveau: 'mince', detail: 'transit 1 à 81 % au p95 : la paire tient à peine la perte d’un lien' },
    { id: 'ups-par-2', niveau: 'mince', detail: 'voie B à 43 % (2N : 40 % au plus)' },
    ...['svc:portail', 'svc:rds', 'svc:k8s'].map((id) => ({ id, niveau: inc ? 'perdue' : 'tenue', detail: inc ? (afterHA ? 'toutes les instances servent, sur un cluster sans réserve' : 'une instance perdue, N+1 tenu') : 'N+1' })),
  ];
  const marge = [
    { id: 'stor-par-1', niveau: 1, detail: 'vm_nfs01 plein dans 24 j (projection 30 j)' },
    { id: 'A05', niveau: 1, detail: 'T° d’entrée 25,8 °C (confort < 25 °C)' },
    { id: 'A04', niveau: 2, detail: 'T° d’entrée 28,4 °C' },
    ...(afterHA ? [{ id: 'esx-par-07', niveau: 1, detail: 'CPU ready 7 % depuis la reprise HA' }] : []),
    { id: 'rtr-par-1', niveau: 2, detail: 'transit 1 au p95 81 % sur 24 h' },
  ];
  const changements = [
    { id: 'bkp-par-01', planifie: true, avancement: null, detail: 'maintenance Veeam jusqu’à 18:00' },
    { id: 'svc:portail', planifie: true, avancement: 0.6, detail: 'CHG-2291 · portail v2.15 · 6/10 instances mises à jour' },
  ];
  const budget = [
    { id: 'svc:rds', vitesse: t >= T0 + 60 ? 6.8 : 0.9, detail: 'budget d’erreur consommé 6,8× plus vite que prévu (latence de connexion)' },
    { id: 'svc:crm', vitesse: inc ? 100 : 1, detail: 'service interrompu' },
  ];
  const horsRegime = [
    { id: 'A08', debut: -240, detail: 'flux de sauvegarde hors fenêtre : 3,1 Gb/s vers bkp-par-01' },
  ];
  const perimes = t >= -900 ? ['lic-par-01'] : [];
  return { redondance, marge, changements, budget, horsRegime, perimes };
}
