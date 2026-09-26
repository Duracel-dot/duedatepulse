// Démo spatiale : toute la console vit dans la scène 3D.
// L'axe vertical porte le niveau d'abstraction : physique (sol) → réseau → virtualisation → services.
// Un élément logique est à l'aplomb de son ancrage physique : une verticale = une chaîne de dépendances.
// L'état global suit la grammaire du conseil de production (grammaire.js) : une scène saine est immobile,
// opaque, doublée et sombre ; l'état global se lit dans les exceptions.
import { WORLD, P, T0, EVENT_BY_ID, ACK_TEMPLATES, stateAt, globalAt, describe, searchObjects, metricsFor, series, fmtAge, fmtClock, nowT, SERVICE_NAMES } from './data.js';
import { buildMaquette, RACK, ROW_A_FRONT, ROW_B_FRONT } from './maquette.js';
import { LUMINANCE, CHOREGRAPHIE as CH } from './grammaire.js';

const CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js';
const canvas = document.getElementById('scene');
const live = document.getElementById('a11y-live');
const FONTS = ["400 16px 'IBM Plex Sans'", "500 16px 'IBM Plex Sans'", "600 16px 'IBM Plex Sans'", "400 16px 'IBM Plex Mono'", "500 16px 'IBM Plex Mono'", "600 16px 'IBM Plex Sans Condensed'", "700 16px 'IBM Plex Sans Condensed'"];
const SANS = "'IBM Plex Sans', 'Segoe UI', sans-serif";
const MONO = "'IBM Plex Mono', Consolas, monospace";
const COND = "'IBM Plex Sans Condensed', 'Segoe UI', sans-serif";

let THREE;
try {
  await Promise.race([Promise.all(FONTS.map((f) => document.fonts?.load(f))), new Promise((r) => setTimeout(r, 2000))]).catch(() => {});
  THREE = await import(document.querySelector('meta[name="sng-three"]')?.content || CDN);
} catch (err) {
  console.error(err);
  const fb = document.getElementById('fallback');
  fb.hidden = false;
  fb.textContent = 'La scène 3D n’a pas pu se charger sur ce poste. La démo classique reste disponible sur /refonte/.';
  throw err;
}

// ============================================================ état de l'application
const S = {
  sel: null, hover: null,
  acks: {}, ackOpen: null, comment: '',
  replay: null,          // { t, playing, speed }
  frozen: null,          // gel simulé du flux de données
  storm: null,           // tempête simulée (touche T)
  search: null, help: false,
  stratum: null,         // strate isolée
  focusEvent: null,      // panne mise en avant
  pendingFrame: null,    // recadrage proposé (Entrée)
  boardFocus: -1,
  mur: false,
  explode: 0, explodeTarget: 0,
  seenP1: new Set(),
  lastP1Resolved: null,
  scars: new Map(),      // objet rétabli → instant de résolution (cicatrice de 30 min)
};
const currentT = () => (S.frozen ? S.frozen.t : S.replay ? S.replay.t : nowT());
let state = stateAt(0, S.acks);
let glob = globalAt(0);
const lcFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
function announce(msg) { live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 30); }

// ============================================================ moteur
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(P.bg, 1);
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -200, 300);
scene.add(new THREE.HemisphereLight(0xDDE1E6, 0x0A0C0F, 1.3));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-3, 8, 6); scene.add(sun);
const fillL = new THREE.DirectionalLight(0x9fb3c8, 0.35); fillL.position.set(6, 3, -8); scene.add(fillL);

const K = buildMaquette(THREE);
scene.add(K.world);
for (const t of K.titles) t.visible = false; // la légende reprend le titre de la salle
const { deviceMeshes, racks, rackWorldPos, edges, textPlane } = K;
const pickables = [...K.pickables];

// ------------------------------------------------------------ petits outils de dessin
function canvasTexture(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return { c, t, g: c.getContext('2d') };
}
function dashTexture(color = '#DDE1E6') {
  const { t, g } = canvasTexture(32, 4);
  g.fillStyle = color; g.fillRect(0, 0, 18, 4);
  t.wrapS = THREE.RepeatWrapping; return t;
}
function rectPoints(x0, z0, x1, z1, y) { return [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]].map(([x, z]) => new THREE.Vector3(x, y, z)); }
/** Contour doublé : double = redondance tenue ; extérieur tireté = mince ; simple = perdue. */
function doubleOutline(parent, x0, z0, x1, z1, y, { gap = 0.05, color = '#8A94A0' } = {}) {
  const g = new THREE.Group(); parent.add(g);
  const inner = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rectPoints(x0 + gap, z0 + gap, x1 - gap, z1 - gap, y)), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  const outerMat = new THREE.LineDashedMaterial({ color, dashSize: 1, gapSize: 0, transparent: true, opacity: 0.9 });
  const outer = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rectPoints(x0, z0, x1, z1, y)), outerMat);
  outer.computeLineDistances(); g.add(inner, outer);
  return {
    group: g,
    set(niveau, col = color) {
      inner.material.color.set(col); outerMat.color.set(col);
      outer.visible = niveau !== 'perdue';
      outerMat.dashSize = niveau === 'mince' ? 0.08 : 1; outerMat.gapSize = niveau === 'mince' ? 0.06 : 0; outerMat.needsUpdate = true;
    },
  };
}

// ============================================================ strates
const FOOT = { x0: -0.7, x1: 4.9, z0: ROW_B_FRONT - 0.4, z1: ROW_A_FRONT + 0.45 };
const FOOT_C = { x: (FOOT.x0 + FOOT.x1) / 2, z: (FOOT.z0 + FOOT.z1) / 2 };
const STRATA = [
  { id: 'physique', label: 'PHYSIQUE', calm: 0, spread: 0 },
  { id: 'reseau', label: 'RÉSEAU', calm: 2.75, spread: 3.35 },
  { id: 'virtualisation', label: 'VIRTUALISATION', calm: 3.35, spread: 4.95 },
  { id: 'services', label: 'SERVICES', calm: 3.95, spread: 6.55 },
];
const SBY = Object.fromEntries(STRATA.map((s) => [s.id, s]));
const strataY = (id, e = S.explode) => SBY[id].calm + (SBY[id].spread - SBY[id].calm) * e;
const layers = {};
for (const s of STRATA.slice(1)) {
  const g = new THREE.Group(); scene.add(g);
  // contour et nom seulement : des plans translucides empilés feraient du moiré sur les baies
  const sheetMat = new THREE.MeshBasicMaterial({ color: '#C9D3DC', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(FOOT.x1 - FOOT.x0, FOOT.z1 - FOOT.z0), sheetMat);
  sheet.rotation.x = -Math.PI / 2; sheet.position.set(FOOT_C.x, 0, FOOT_C.z); g.add(sheet);
  const rim = edges(new THREE.BoxGeometry(FOOT.x1 - FOOT.x0, 0.0001, FOOT.z1 - FOOT.z0), '#C9D3DC', 0.4);
  rim.position.set(FOOT_C.x, 0, FOOT_C.z); g.add(rim);
  const lab = textPlane(s.label, { size: 0.19, color: '#8A94A0', spacing: 10 });
  lab.rotation.x = -Math.PI / 2; lab.position.set(FOOT.x0 + 0.05, 0.004, FOOT.z1 + 0.2);
  lab.userData = { id: `strate:${s.id}` }; g.add(lab); pickables.push(lab);
  layers[s.id] = { group: g, sheetMat, lab };
}
{
  const lab = textPlane('PHYSIQUE', { size: 0.19, color: '#8A94A0', spacing: 10 });
  lab.rotation.x = -Math.PI / 2; lab.position.set(FOOT.x0 + 0.05, 0.005, FOOT.z1 + 0.62);
  lab.userData = { id: 'strate:physique' }; scene.add(lab); pickables.push(lab);
  layers.physique = { lab };
}

// ------------------------------------------------------------ strate réseau
const NET_TYPES = new Set(['switch', 'router', 'firewall', 'loadbalancer']);
const netNodes = new Map();
const A01_ORDER = ['rtr-par-1', 'rtr-par-2', 'fw-par-1', 'fw-par-2', 'core-par-1', 'core-par-2', 'lb-par-1', 'lb-par-2'];
const netDevices = [];
for (const row of WORLD.room.rows) for (const r of row.racks) for (const d of r.devices) if (NET_TYPES.has(d.type)) netDevices.push({ ...d, rack: r.id });
function netNodePos(d) {
  const c = rackWorldPos(d.rack);
  if (d.rack === 'A01') { const k = A01_ORDER.indexOf(d.id); return new THREE.Vector3(c.x + (k % 2 ? 0.13 : -0.13), 0, c.z - 0.45 + Math.floor(k / 2) * 0.3); }
  return new THREE.Vector3(c.x + (d.id.endsWith('-2') ? 0.13 : -0.13), 0, c.z);
}
const netMat = (color = '#3B434E') => new THREE.MeshStandardMaterial({ color, roughness: 0.8, emissive: new THREE.Color(0x000000) });
for (const d of netDevices) {
  const m = netMat(); const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.1), m);
  const pos = netNodePos(d); mesh.position.copy(pos).setY(0.025); mesh.userData = { id: d.id };
  layers.reseau.group.add(mesh); pickables.push(mesh);
  netNodes.set(d.id, { mesh, mat: m, pos });
}
const EXT = [{ id: 'ext-internet', name: 'Internet', pos: new THREE.Vector3(-1.9, 0, -1.05) }, { id: 'ext-mpls', name: 'WAN MPLS', pos: new THREE.Vector3(-1.9, 0, -0.45) }];
for (const e of EXT) {
  const m = netMat('#2F363F'); const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.04, 24), m);
  mesh.position.copy(e.pos).setY(0.02); mesh.userData = { id: e.id }; layers.reseau.group.add(mesh); pickables.push(mesh);
  const lab = textPlane(e.name, { size: 0.11, color: '#8A94A0', font: "500 64px 'IBM Plex Mono', monospace" });
  lab.rotation.x = -Math.PI / 2; lab.position.set(e.pos.x - 0.2, 0.004, e.pos.z + 0.24); layers.reseau.group.add(lab);
  netNodes.set(e.id, { mesh, mat: m, pos: e.pos });
}
for (const id of ['core-par-1', 'fw-par-1', 'rtr-par-1']) {
  const n = netNodes.get(id);
  const lab = textPlane(id.replace('-1', '-1/2'), { size: 0.075, color: '#8A94A0', font: "500 64px 'IBM Plex Mono', monospace" });
  lab.rotation.x = -Math.PI / 2; lab.position.set(n.pos.x + 0.26, 0.004, n.pos.z + 0.04); layers.reseau.group.add(lab);
}
// voies : l'épaisseur dit la capacité nominale (dessin, jamais un état) ; le double trait dit la redondance
const TRUNK_Z = (ROW_A_FRONT - RACK.d + ROW_B_FRONT + RACK.d) / 2;
const dashMap = dashTexture();
function ribbon(parent, x1, z1, x2, z2, w, color, { dashed = false, off = 0 } = {}) {
  const len = Math.hypot(x2 - x1, z2 - z1) + w;
  const ang = Math.atan2(z2 - z1, x2 - x1);
  const nx = -Math.sin(ang) * off; const nz = Math.cos(ang) * off;
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false });
  if (dashed) { m.map = dashMap.clone(); m.map.needsUpdate = true; m.map.repeat.set(len / 0.1, 1); }
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, 0.004, w), m);
  mesh.position.set((x1 + x2) / 2 + nx, 0.003, (z1 + z2) / 2 + nz); mesh.rotation.y = -ang;
  parent.add(mesh);
  return mesh;
}
const tracks = []; // { id, a, b, w, redundant, group }
function drawTrack(t, niveau = 'tenue', color = '#4A535E') {
  if (t.group) { layers.reseau.group.remove(t.group); t.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); }); }
  const g = new THREE.Group(); layers.reseau.group.add(g); t.group = g;
  const [x1, z1] = t.a; const [x2, z2] = t.b;
  if (!t.redundant || niveau === 'perdue') { ribbon(g, x1, z1, x2, z2, t.redundant ? t.w * 0.55 : t.w, color); return; }
  const lane = t.w * 0.42; const gap = t.w * 0.3;
  ribbon(g, x1, z1, x2, z2, lane, color, { off: -(gap / 2 + lane / 2) });
  ribbon(g, x1, z1, x2, z2, lane, color, { off: gap / 2 + lane / 2, dashed: niveau === 'mince' });
}
{
  const torRacks = [...new Set(netDevices.filter((d) => d.id.startsWith('tor-')).map((d) => d.rack))];
  const coreX = rackWorldPos('A01').x;
  for (const rk of torRacks) { const c = rackWorldPos(rk); tracks.push({ id: `bundle:${rk}`, a: [c.x, c.z], b: [c.x, TRUNK_Z], w: 0.08, redundant: true }); }
  const xs = [...new Set(torRacks.map((rk) => Math.round(rackWorldPos(rk).x * 100) / 100))].sort((a, b) => b - a);
  let acc = 0;
  for (let i = 0; i < xs.length; i++) {
    acc += torRacks.filter((rk) => Math.abs(rackWorldPos(rk).x - xs[i]) < 0.01).length;
    const nx = i + 1 < xs.length ? xs[i + 1] : coreX;
    if (nx !== xs[i]) tracks.push({ id: `bus-${i}`, a: [xs[i], TRUNK_Z], b: [nx, TRUNK_Z], w: 0.06 + acc * 0.012, redundant: true });
  }
  const core = netNodes.get('core-par-1').pos;
  tracks.push({ id: 'bus-core', a: [coreX, TRUNK_Z], b: [coreX, core.z], w: 0.2, redundant: true });
  const hop = (a, b, id, w = 0.03) => { const A = netNodes.get(a).pos; const B = netNodes.get(b).pos; tracks.push({ id, a: [A.x, A.z], b: [B.x, B.z], w, redundant: false }); };
  hop('core-par-1', 'fw-par-1', 'c-f1'); hop('core-par-2', 'fw-par-2', 'c-f2'); hop('fw-par-1', 'rtr-par-1', 'f-r1'); hop('fw-par-2', 'rtr-par-2', 'f-r2');
  const R = netNodes.get('rtr-par-1').pos; const I = EXT[0].pos; const M = EXT[1].pos; const R2 = netNodes.get('rtr-par-2').pos;
  tracks.push({ id: 'transit', a: [R.x, R.z], b: [I.x, I.z], w: 0.08, redundant: true });
  tracks.push({ id: 'mpls', a: [R2.x, R2.z], b: [M.x, M.z], w: 0.025, redundant: false });
  for (const t of tracks) drawTrack(t);
}
// défilement 0,5 Hz : trafic sorti de son régime (seul mouvement autorisé avec le clignotement P1)
const chevronTex = (() => { const { t, g } = canvasTexture(64, 32); g.strokeStyle = '#DDE1E6'; g.lineWidth = 5; g.beginPath(); g.moveTo(18, 6); g.lineTo(34, 16); g.lineTo(18, 26); g.stroke(); t.wrapS = THREE.RepeatWrapping; return t; })();
const scrolls = new Map(); // id de voie -> mesh
function setScroll(trackId, on) {
  let m = scrolls.get(trackId);
  if (!on) { if (m) { layers.reseau.group.remove(m); scrolls.delete(trackId); } return; }
  if (m) return;
  const t = tracks.find((x) => x.id === trackId); if (!t) return;
  const [x1, z1] = t.a; const [x2, z2] = t.b; const len = Math.hypot(x2 - x1, z2 - z1);
  const tex = chevronTex.clone(); tex.needsUpdate = true; tex.repeat.set(len / 0.14, 1);
  m = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.rotation.z = -Math.atan2(z1 - z2, x1 - x2) + Math.PI; // du bus vers la baie
  m.position.set((x1 + x2) / 2, 0.012, (z1 + z2) / 2);
  layers.reseau.group.add(m); scrolls.set(trackId, m);
}
const serverLinks = WORLD.links.filter((l) => /^tor-/.test(l.a) && deviceMeshes.has(l.b) && !NET_TYPES.has(describe(l.b)?.device?.type));

// ------------------------------------------------------------ strate virtualisation
const hostTiles = new Map(); const vmTiles = new Map(); const clusterObjs = [];
const hatchMat = new THREE.MeshBasicMaterial({ map: K.hatchTex, transparent: true, depthWrite: false });
function hostPos(id) { const dm = deviceMeshes.get(id); const c = rackWorldPos(dm.rack); return new THREE.Vector3(c.x, 0, c.z + (dm.u >= 12 ? -0.26 : 0.26)); }
for (const h of WORLD.hosts) {
  if (!deviceMeshes.has(h.id)) continue;
  const pos = hostPos(h.id);
  const mat = new THREE.MeshBasicMaterial({ color: '#262C34', transparent: true, opacity: 0.94, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.44), mat);
  mesh.rotation.x = -Math.PI / 2; mesh.position.copy(pos).setY(0.002); mesh.userData = { id: h.id };
  layers.virtualisation.group.add(mesh); pickables.push(mesh);
  const rim = edges(new THREE.BoxGeometry(0.5, 0.0001, 0.44), '#5A636E', 0.8); rim.position.copy(pos).setY(0.003); layers.virtualisation.group.add(rim);
  hostTiles.set(h.id, { mesh, mat, rim, pos });
}
for (const cl of ['CL-PROD-PAR', 'HVCL-PAR']) {
  const pts = WORLD.hosts.filter((h) => h.cluster === cl && hostTiles.has(h.id)).map((h) => hostTiles.get(h.id).pos);
  const xs = pts.map((p) => p.x); const zs = pts.map((p) => p.z);
  const box = { x0: Math.min(...xs) - 0.36, x1: Math.max(...xs) + 0.36, z0: Math.min(...zs) - 0.32, z1: Math.max(...zs) + 0.32 };
  const outline = doubleOutline(layers.virtualisation.group, box.x0, box.z0, box.x1, box.z1, 0.004, { color: '#8A94A0' });
  const rowB = pts.every((p) => p.z < -2);
  const lab = textPlane(cl, { size: 0.14, color: '#DDE1E6', spacing: 8 });
  lab.rotation.x = -Math.PI / 2; lab.position.set(box.x0 + 0.02, 0.005, rowB ? box.z0 - 0.12 : box.z1 + 0.16); lab.userData = { id: cl };
  layers.virtualisation.group.add(lab); pickables.push(lab);
  clusterObjs.push({ id: cl, outline, lab, box });
}
function layoutVms() {
  for (const t of vmTiles.values()) { layers.virtualisation.group.remove(t.mesh); t.mesh.geometry.dispose(); }
  vmTiles.clear();
  for (const [hid, ht] of hostTiles) {
    WORLD.vms.filter((v) => state.vmHost.get(v.name) === hid).forEach((v, k) => {
      const unreach = state.obj.get(v.name) === 'unreach';
      const mat = unreach ? hatchMat.clone() : new THREE.MeshBasicMaterial({ color: v.powered === false ? '#20252C' : '#4A535E', transparent: true, opacity: 0.95, depthWrite: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.095, 0.085), mat);
      mesh.rotation.x = -Math.PI / 2;
      const pos = new THREE.Vector3(ht.pos.x - 0.18 + (k % 4) * 0.12, 0.005, ht.pos.z - 0.13 + Math.floor(k / 4) * 0.105);
      mesh.position.copy(pos); mesh.userData = { id: v.name };
      layers.virtualisation.group.add(mesh); pickables.push(mesh);
      vmTiles.set(v.name, { mesh, mat, pos, base: mat.color?.clone() });
    });
  }
}

// ------------------------------------------------------------ strate services
const APP_SERVICE = { 'Portail clients': 'svc:portail', Kubernetes: 'svc:k8s', 'Bureaux à distance': 'svc:rds', CRM: 'svc:crm', ERP: 'svc:erp', Messagerie: 'svc:mail', 'Annuaire AD/DNS': 'svc:ad', Fichiers: 'svc:dfs', API: 'svc:api', Intranet: 'svc:intranet' };
const EXTRA_NAMES = { 'svc:api': 'API', 'svc:intranet': 'Intranet' };
const USER_IMPACT = { 'svc:crm': 'CRM : 100 % des connexions en échec', 'svc:pki': 'PKI : émission de certificats impossible' };
const svcName = (id) => SERVICE_NAMES[id] || EXTRA_NAMES[id] || id;
const svcMembers = new Map();
for (const v of WORLD.vms) { const sid = v.name === 'pki-01' ? 'svc:pki' : APP_SERVICE[v.app]; if (sid) { if (!svcMembers.has(sid)) svcMembers.set(sid, []); svcMembers.get(sid).push(v.name); } }
svcMembers.set('svc:sql', ['sql-par-01', 'sql-par-02']);
const vmToSvc = new Map();
for (const [sid, ms] of svcMembers) for (const m of ms) vmToSvc.set(m, [...(vmToSvc.get(m) || []), sid]);
const svcPads = new Map();
const PAD = { w: 1.15, d: 0.5 };
function memberXZ(m) { const vt = vmTiles.get(m); if (vt) return vt.pos; const dm = deviceMeshes.get(m); if (dm) { const c = rackWorldPos(dm.rack); return new THREE.Vector3(c.x, 0, c.z); } return null; }
function buildServices() {
  const items = [];
  for (const [sid, ms] of svcMembers) { const pts = ms.map(memberXZ).filter(Boolean); if (pts.length) items.push({ id: sid, x: pts.reduce((a, p) => a + p.x, 0) / pts.length, z: pts.reduce((a, p) => a + p.z, 0) / pts.length }); }
  for (let it = 0; it < 160; it++) {
    for (const a of items) for (const b of items) {
      if (a === b) continue;
      const dx = b.x - a.x; const dz = b.z - a.z; const ox = PAD.w + 0.12 - Math.abs(dx); const oz = PAD.d + 0.1 - Math.abs(dz);
      if (ox > 0 && oz > 0) { if (ox / PAD.w < oz / PAD.d) { const s = Math.sign(dx || 1) * ox / 2; a.x -= s; b.x += s; } else { const s = Math.sign(dz || 1) * oz / 2; a.z -= s; b.z += s; } }
    }
    for (const a of items) { a.x = Math.min(FOOT.x1 - PAD.w / 2, Math.max(FOOT.x0 + PAD.w / 2, a.x)); a.z = Math.min(FOOT.z1 - PAD.d / 2, Math.max(FOOT.z0 + PAD.d / 2, a.z)); }
  }
  for (const it of items) {
    const { c, t } = canvasTexture(460, 200);
    const top = new THREE.MeshBasicMaterial({ map: t, transparent: true });
    const side = new THREE.MeshStandardMaterial({ color: '#232830', roughness: 0.9 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(PAD.w, 0.05, PAD.d), [side, side, top, side, side, side]);
    mesh.position.set(it.x, 0.025, it.z); mesh.userData = { id: it.id };
    layers.services.group.add(mesh); pickables.push(mesh);
    svcPads.set(it.id, { mesh, top, tex: t, canvas: c, pos: new THREE.Vector3(it.x, 0, it.z), sig: '' });
  }
}
const gl = (list, id) => list.find((x) => x.id === id);
function drawPad(id) {
  const p = svcPads.get(id); const st = state.obj.get(id);
  const red = gl(glob.redondance, id)?.niveau || 'tenue';
  const burn = gl(glob.budget, id); const marge = st !== 'down' && burn && burn.vitesse >= 6 ? 2 : 0;
  const chg = gl(glob.changements, id);
  const members = svcMembers.get(id) || [];
  const down = members.filter((m) => state.obj.get(m) === 'unreach').length;
  const sub = id === 'svc:sql' ? 'physique · 2 nœuds' : `${members.length - down}/${members.length} VM`;
  const dim = dimmed(id);
  const sig = `${st}|${red}|${marge}|${sub}|${dim}|${!!chg}`;
  if (sig === p.sig) return; p.sig = sig;
  const g = p.canvas.getContext('2d'); const W = p.canvas.width; const H = p.canvas.height;
  const hue = st === 'down' ? P.critical : null;
  g.clearRect(0, 0, W, H);
  g.fillStyle = st === 'down' ? '#2A1A1C' : marge ? LUMINANCE[marge] : '#1C2128'; g.fillRect(0, 0, W, H);
  if (marge) { g.fillStyle = 'rgba(18,22,28,0.55)'; g.fillRect(0, 0, W, H); }
  // double trait = redondance
  const ink = hue || '#8A94A0';
  g.strokeStyle = ink; g.lineWidth = red === 'perdue' ? 8 : 4;
  if (red !== 'perdue') { g.setLineDash(red === 'mince' ? [16, 12] : []); g.strokeRect(4, 4, W - 8, H - 8); g.setLineDash([]); g.strokeRect(18, 18, W - 36, H - 36); } else g.strokeRect(6, 6, W - 12, H - 12);
  g.fillStyle = hue ? P.ivory : P.inkLight; g.font = `600 50px ${SANS}`; g.textBaseline = 'alphabetic';
  g.fillText(svcName(id), 36, 88, W - 110);
  g.fillStyle = marge ? P.inkLight : P.ink; g.font = `400 34px ${MONO}`; g.fillText(sub, 36, 150, W - 60);
  if (st === 'down') drawGlyph(g, 1, W - 50, 60, 20);
  p.tex.needsUpdate = true;
  p.top.color.set(dim ? '#B3B3B3' : '#FFFFFF');
}

// ------------------------------------------------------------ signaux d'état global dans l'espace
const globalGroup = new THREE.Group(); scene.add(globalGroup);
// plinthe de la salle : synthèse de la redondance, lisible de loin
const plinth = doubleOutline(scene, -2.3, -6.3, 7.3, 2.9, 0.012, { gap: 0.09, color: '#5A636E' });
// pied de la baie B08 (onduleurs, voies électriques)
const b08 = rackWorldPos('B08');
const upsPlinth = doubleOutline(scene, b08.x - 0.36, b08.z - 0.66, b08.x + 0.36, b08.z + 0.66, 0.014, { gap: 0.04, color: '#5A636E' });
const margeRackTops = new Map();
const hatchOverlays = new Map();
function keySprite() {
  const { t, g } = canvasTexture(96, 96);
  g.strokeStyle = '#DDE1E6'; g.lineWidth = 7; g.lineCap = 'round';
  g.beginPath(); g.arc(34, 34, 16, 0, Math.PI * 2); g.moveTo(46, 46); g.lineTo(80, 80); g.moveTo(66, 66); g.lineTo(74, 58); g.moveTo(74, 74); g.lineTo(82, 66); g.stroke();
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false })); s.scale.set(0.3, 0.3, 1); s.renderOrder = 15; return s;
}
const maintenanceKey = keySprite(); globalGroup.add(maintenanceKey);
// échafaudage : changement en cours, avancement par instance
const scaffold = new THREE.Group(); layers.services.group.add(scaffold);
function buildScaffold(id, avancement) {
  scaffold.clear();
  const p = svcPads.get(id); if (!p) return;
  const x0 = p.pos.x - PAD.w / 2 - 0.04; const x1 = p.pos.x + PAD.w / 2 + 0.04; const z0 = p.pos.z - PAD.d / 2 - 0.04; const z1 = p.pos.z + PAD.d / 2 + 0.04; const h = 0.42;
  const pts = [];
  for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) pts.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, h, z));
  for (const y of [h * 0.5, h]) for (const [a, b] of [[[x0, z0], [x1, z0]], [[x1, z0], [x1, z1]], [[x1, z1], [x0, z1]], [[x0, z1], [x0, z0]]]) pts.push(new THREE.Vector3(a[0], y, a[1]), new THREE.Vector3(b[0], y, b[1]));
  scaffold.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#DDE1E6', transparent: true, opacity: 0.8 })));
  const n = 10; const done = Math.round(avancement * n);
  for (let i = 0; i < n; i++) {
    const tick = new THREE.Mesh(new THREE.BoxGeometry((x1 - x0) / n - 0.025, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: i < done ? '#DDE1E6' : '#2A313B' }));
    tick.position.set(x0 + ((i + 0.5) * (x1 - x0)) / n, h + 0.02, z1); scaffold.add(tick);
  }
}

// ------------------------------------------------------------ racines, fils à plomb et traçage
const faintMat = new THREE.LineBasicMaterial({ color: '#8A94A0', transparent: true, opacity: 0.1, depthWrite: false });
const faintLines = new THREE.LineSegments(new THREE.BufferGeometry(), faintMat); scene.add(faintLines);
const hiLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: P.ivory, transparent: true, opacity: 0.85, depthWrite: false })); scene.add(hiLines);
const traceLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: P.ivory, transparent: true, opacity: 0.6, depthWrite: false })); scene.add(traceLines);

function worldOfDevice(id) { const dm = deviceMeshes.get(id); if (!dm) return null; const v = new THREE.Vector3(); dm.anchor.getWorldPosition(v); return v; }
function worldOf(id) {
  if (svcPads.has(id)) { const p = svcPads.get(id).pos; return new THREE.Vector3(p.x, strataY('services') + 0.05, p.z); }
  if (vmTiles.has(id)) { const p = vmTiles.get(id).pos; return new THREE.Vector3(p.x, strataY('virtualisation') + 0.01, p.z); }
  if (netNodes.has(id)) { const p = netNodes.get(id).pos; return new THREE.Vector3(p.x, strataY('reseau') + 0.03, p.z); }
  if (deviceMeshes.has(id)) return worldOfDevice(id);
  if (racks.has(id)) { const v = new THREE.Vector3(); racks.get(id).anchor.getWorldPosition(v); return v; }
  const cl = clusterObjs.find((c) => c.id === id); if (cl) return new THREE.Vector3(cl.box.x0, strataY('virtualisation'), cl.box.z1);
  return null;
}
function hostTileWorld(id) { const p = hostTiles.get(id)?.pos; return p ? new THREE.Vector3(p.x, strataY('virtualisation') + 0.004, p.z) : null; }
function chainOf(id) {
  const ids = new Set([id]); const segs = [];
  const seg = (a, b) => { if (a && b) segs.push(a, b); };
  const hostDown = (host) => {
    ids.add(host); const t = hostTileWorld(host); const d = worldOfDevice(host);
    if (t && d) { seg(t, d.clone().setY(RACK.h + 0.05)); seg(d.clone().setY(RACK.h + 0.05), d); }
    for (const l of serverLinks) if (l.b === host) { ids.add(l.a); seg(worldOf(l.a), d); }
  };
  const vmUp = (vm, withSvc = true) => { ids.add(vm); const host = state.vmHost.get(vm); if (host) { seg(worldOf(vm), hostTileWorld(host)); hostDown(host); } if (withSvc) for (const s of vmToSvc.get(vm) || []) { ids.add(s); seg(worldOf(s), worldOf(vm)); } };
  const d = describe(id);
  if (id.startsWith('svc:')) { for (const m of svcMembers.get(id) || []) { if (vmTiles.has(m)) { seg(worldOf(id), worldOf(m)); vmUp(m, false); } else if (deviceMeshes.has(m)) { ids.add(m); seg(worldOf(id), worldOf(m)); } } }
  else if (d?.vm) vmUp(id);
  else if (d?.host) { hostDown(id); for (const v of WORLD.vms) if (state.vmHost.get(v.name) === id) { ids.add(v.name); seg(worldOf(v.name), hostTileWorld(id)); for (const s of vmToSvc.get(v.name) || []) { ids.add(s); seg(worldOf(s), worldOf(v.name)); } } }
  else if (netNodes.has(id) && !id.startsWith('ext-')) { for (const l of serverLinks) if (l.a === id) { ids.add(l.b); seg(worldOf(id), worldOfDevice(l.b)); } if (deviceMeshes.has(id)) seg(worldOf(id), worldOfDevice(id)); }
  else if (d?.device) { for (const s of vmToSvc.get(id) || []) { ids.add(s); seg(worldOf(s), worldOf(id)); } for (const l of serverLinks) if (l.b === id) { ids.add(l.a); seg(worldOf(l.a), worldOf(id)); } }
  else if (d?.kind === 'rack') { for (const dv of WORLD.room.rows.flatMap((r) => r.racks).find((r) => r.id === id)?.devices || []) ids.add(dv.id); }
  else if (d?.kind === 'cluster') { for (const h of d.hosts) if (hostTiles.has(h.id)) hostDown(h.id); }
  return { ids, segs };
}
function setLines(line, pts) {
  const arr = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => { arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z; });
  line.geometry.dispose(); line.geometry = new THREE.BufferGeometry(); line.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
}
function rebuildFaint() {
  const pts = [];
  for (const sid of svcPads.keys()) for (const m of svcMembers.get(sid) || []) { const w = worldOf(m); if (w) pts.push(worldOf(sid), w); }
  for (const hid of hostTiles.keys()) { const t = hostTileWorld(hid); const d = worldOfDevice(hid); if (t && d) pts.push(t, new THREE.Vector3(d.x, RACK.h + 0.36, d.z)); }
  for (const [id, n] of netNodes) if (!id.startsWith('ext-') && deviceMeshes.has(id)) pts.push(new THREE.Vector3(n.pos.x, strataY('reseau'), n.pos.z), new THREE.Vector3(n.pos.x, RACK.h + 0.36, n.pos.z));
  setLines(faintLines, pts);
}

// ============================================================ cartels, épingles et légende
const cards = new Set();
class Card {
  constructor({ w = 360, h = 120, anchor, offset = [40, 70], leader = P.ivory, id = null, prio = 5, screen = false }) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas = document.createElement('canvas');
    this.w = w; this.h = h; this.id = id; this.prio = prio; this.screen = screen; this.dy = 0;
    this.canvas.width = w * this.dpr; this.canvas.height = h * this.dpr;
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false }));
    this.mesh.renderOrder = 20 + (10 - prio); this.mesh.userData = { card: this };
    this.lineMat = new THREE.LineBasicMaterial({ color: leader, transparent: true, opacity: 0.8, depthTest: false });
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), this.lineMat);
    this.line.renderOrder = 19; this.line.visible = !screen;
    this.anchor = anchor; this.offset = offset; this.hits = [];
    scene.add(this.mesh); if (!screen) scene.add(this.line); cards.add(this);
  }
  resize(w, h) { if (w === this.w && h === this.h) return; this.w = w; this.h = h; this.canvas.width = w * this.dpr; this.canvas.height = h * this.dpr; this.tex.dispose(); this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.mesh.material.map = this.tex; }
  draw(fn) { const g = this.canvas.getContext('2d'); g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); g.clearRect(0, 0, this.w, this.h); this.hits = []; fn(g, this.w, this.h, this); this.tex.needsUpdate = true; invalidate(); }
  anchorPoint() { return typeof this.anchor === 'function' ? this.anchor() : this.anchor; }
  remove() { scene.remove(this.mesh, this.line); this.tex.dispose(); cards.delete(this); invalidate(); }
}
/** Place les cartels à taille d'écran constante et évite qu'ils se chevauchent (le plus prioritaire reste en place). */
function layoutCards(pxPerWorld, right, up) {
  const W = canvas.clientWidth; const H = canvas.clientHeight; const k = (S.mur ? 1.7 : 1) / pxPerWorld; const sc = S.mur ? 1.7 : 1;
  const placed = [];
  const list = [...cards].sort((a, b) => a.prio - b.prio);
  for (const c of list) {
    const a = c.anchorPoint();
    if (!a) { c.mesh.visible = c.line.visible = false; continue; }
    const s = a.clone().project(camera); const sx = (s.x + 1) / 2 * W; const sy = (1 - s.y) / 2 * H;
    let rx = sx + c.offset[0] * sc; let ry = sy - (c.offset[1] * sc) - c.h * sc; // rectangle écran (y vers le bas)
    let dy = 0;
    if (!c.screen) {
      for (let guard = 0; guard < 12; guard++) {
        const hit = placed.find((r) => rx < r.x + r.w + 4 && rx + c.w * sc + 4 > r.x && ry - dy < r.y + r.h + 4 && ry - dy + c.h * sc + 4 > r.y);
        if (!hit) break;
        dy += (ry - dy + c.h * sc) - hit.y + 6;
      }
      if (c.optional && dy > 0) { c.mesh.visible = c.line.visible = false; continue; }
    }
    c.mesh.visible = true; c.line.visible = !c.screen;
    placed.push({ x: rx, y: ry - dy, w: c.w * sc, h: c.h * sc });
    const cx = c.offset[0] * sc + (c.w * sc) / 2; const cy = c.offset[1] * sc + dy + (c.h * sc) / 2;
    const center = a.clone().addScaledVector(right, cx / sc * k).addScaledVector(up, cy / sc * k);
    c.mesh.position.copy(center); c.mesh.quaternion.copy(camera.quaternion); c.mesh.scale.set(c.w * k, c.h * k, 1);
    if (!c.screen) {
      const corner = a.clone().addScaledVector(right, c.offset[0] * k).addScaledVector(up, (c.offset[1] * sc + dy) / sc * k);
      const pos = c.line.geometry.attributes.position; pos.setXYZ(0, a.x, a.y, a.z); pos.setXYZ(1, corner.x, corner.y, corner.z); pos.needsUpdate = true;
    }
  }
}
// clignotement : luminance 100 % ↔ 45 %, jamais éteint ; le contour seul reste réservé à « pris en charge »
function drawGlyph(g, prio, x, y, s, { ack = false, dim = false } = {}) {
  g.save(); g.lineWidth = 2; if (dim) g.globalAlpha = 0.45;
  if (prio === 1) { g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s, y); g.lineTo(x, y + s); g.lineTo(x - s, y); g.closePath(); if (ack) { g.strokeStyle = P.critical; g.stroke(); } else { g.fillStyle = P.critical; g.fill(); } }
  else if (prio === 2) { g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s, y + s * 0.8); g.lineTo(x - s, y + s * 0.8); g.closePath(); if (ack) { g.strokeStyle = P.major; g.stroke(); } else { g.fillStyle = P.major; g.fill(); } }
  else if (prio === 3) { g.beginPath(); g.arc(x, y, s * 0.72, 0, Math.PI * 2); g.strokeStyle = P.minor; g.stroke(); }
  g.restore();
}
function panel(g, w, h, border = '#3B434E') { g.fillStyle = 'rgba(16,19,24,0.95)'; g.fillRect(0, 0, w, h); g.strokeStyle = border; g.lineWidth = 1.5; g.strokeRect(0.75, 0.75, w - 1.5, h - 1.5); }
function halo(g, text, x, y, color) { g.lineWidth = 4; g.strokeStyle = 'rgba(18,22,28,0.9)'; g.lineJoin = 'round'; g.strokeText(text, x, y); g.fillStyle = color; g.fillText(text, x, y); }
function button(card, g, x, y, w, h, label, action, { primary = false } = {}) {
  g.fillStyle = primary ? P.ivory : 'transparent'; g.fillRect(x, y, w, h);
  g.strokeStyle = primary ? P.ivory : '#4A535E'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  g.fillStyle = primary ? '#12161C' : P.inkLight; g.font = `${primary ? 600 : 400} 12.5px ${SANS}`; g.textBaseline = 'middle';
  g.fillText(label, x + 10, y + h / 2 + 0.5, w - 16); g.textBaseline = 'alphabetic';
  card.hits.push({ x, y, w, h, action });
}

// légende du plan : seul élément fixé au coin de la vue (heure, fraîcheur, P1/P2 non pris) — exception
// unanime du conseil : la vérité des données ne doit pas dépendre de l'endroit où regarde la caméra
const legend = new Card({ w: 900, h: 64, anchor: () => new THREE.Vector3(-1 + 20 / (canvas.clientWidth / 2), -1 + 18 / (canvas.clientHeight / 2), 0).unproject(camera), offset: [0, 0], screen: true, prio: 0 });
function drawLegend() {
  const extra = (S.search != null ? 1 : 0) + (S.help ? 5 : 0);
  legend.resize(900, 64 + extra * 24);
  legend.draw((g, w, h) => {
    let y = 20;
    g.textBaseline = 'alphabetic';
    if (S.help) {
      for (const t of ['glisser : tourner · clic droit : déplacer · molette : zoom · clic : ouvrir', '1 à 4 : isoler une strate · 0 : toutes · E : écarter les strates · H : vue globale', 'Tab : parcourir les pannes · Entrée : cadrer ou ouvrir · A : prendre en charge', 'R : rejouer l’incident · L : direct · G : simuler un gel des données', 'T : simuler une tempête · M : mode mur · / : chercher · Échap : revenir']) { g.font = `400 13px ${SANS}`; halo(g, t, 2, y, '#8A94A0'); y += 24; }
    }
    if (S.search != null) { g.font = `500 15px ${MONO}`; halo(g, `RECHERCHE › ${S.search}_   ${searchHits.length} résultat${searchHits.length > 1 ? 's' : ''} · Entrée : aller · Échap : annuler`, 2, y, P.ivory); y += 24; }
    let x = 2;
    g.font = `600 14px ${COND}`; g.letterSpacing = '2px'; halo(g, 'SALLE A — PRODUCTION · PARIS DC1', x, y + 4, '#8A94A0'); x += g.measureText('SALLE A — PRODUCTION · PARIS DC1').width + 22; g.letterSpacing = '0px';
    g.font = `500 17px ${MONO}`;
    const clock = S.frozen ? fmtClock(S.frozen.t) : S.replay ? fmtClock(S.replay.t) : fmtClock(nowT());
    halo(g, clock, x, y + 4, S.frozen ? P.major : S.replay ? P.temporal : P.ivory); x += g.measureText(clock).width + 16;
    g.font = `400 14px ${MONO}`;
    const fresh = S.frozen ? `DONNÉES FIGÉES depuis ${fmtAge(nowT() - S.frozen.since)}` : S.replay ? 'RELECTURE' : `données il y a ${dataAge} s`;
    halo(g, fresh, x, y + 4, S.frozen ? P.major : S.replay ? P.temporal : '#8A94A0'); x += g.measureText(fresh).width + 22;
    for (const p of [1, 2]) { drawGlyph(g, p, x + 7, y - 1, 7); g.font = `500 17px ${MONO}`; halo(g, String(state.counters[p]), x + 18, y + 4, state.counters[p] ? P.ivory : '#8A94A0'); x += 44; }
    g.font = `400 13px ${SANS}`; halo(g, 'non pris en charge', x, y + 4, '#8A94A0');
    y += 26;
    g.font = `400 13px ${SANS}`;
    const hint = S.pendingFrame ? 'Nouvelle panne : Entrée pour la cadrer' : S.storm ? 'Tempête : animations suspendues, causes agrégées' : S.mur ? 'Mode mur : caméra fixe, aucune animation · M pour revenir' : '? aide · / chercher · Tab pannes · R rejouer l’incident';
    halo(g, hint, 2, y + 4, S.pendingFrame ? P.ivory : '#5A636E');
  });
}

// ============================================================ totem des pannes (dans la salle)
const BOARD = { w: 1100, h: 700, worldW: 2.8 };
const boardCanvas = document.createElement('canvas'); boardCanvas.width = BOARD.w; boardCanvas.height = BOARD.h;
const boardTex = new THREE.CanvasTexture(boardCanvas); boardTex.colorSpace = THREE.SRGBColorSpace; boardTex.anisotropy = 8;
const board = new THREE.Group(); scene.add(board);
const boardH = BOARD.worldW * BOARD.h / BOARD.w;
const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(BOARD.worldW, boardH), new THREE.MeshBasicMaterial({ map: boardTex }));
boardMesh.userData = { id: 'board' }; board.add(boardMesh); pickables.push(boardMesh);
board.position.set(-2.35, 1.35 + boardH / 2, -3.5);
const boardStand = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.35, 0.06), new THREE.MeshStandardMaterial({ color: '#2B3139' })); boardStand.position.set(-2.35, 0.675, -3.5); scene.add(boardStand);
let boardRows = [];
function alarmList() {
  // pannes P1 et P2 seulement (P3 absent du mur), non prises en charge d'abord, puis par ancienneté
  const roots = state.roots.filter((r) => r.prio === 1 || r.prio === 2);
  return [...roots.filter((r) => !r.ackNow).sort((a, b) => a.prio - b.prio || a.start - b.start), ...roots.filter((r) => r.ackNow)];
}
function drawBoard() {
  const g = boardCanvas.getContext('2d'); const W = BOARD.w; const H = BOARD.h;
  g.fillStyle = '#12161C'; g.fillRect(0, 0, W, H);
  g.strokeStyle = S.replay ? P.temporal : S.frozen ? P.major : '#3B434E'; g.lineWidth = 5; g.strokeRect(2.5, 2.5, W - 5, H - 5);
  g.textBaseline = 'alphabetic';
  g.fillStyle = P.ink; g.font = `600 34px ${COND}`; g.letterSpacing = '4px'; g.fillText('PANNES', 44, 74); g.letterSpacing = '0px';
  [1, 2].forEach((p, i) => { drawGlyph(g, p, 250 + i * 150, 62, 17); g.fillStyle = state.counters[p] ? P.ivory : P.ink; g.font = `500 56px ${MONO}`; g.fillText(String(state.counters[p]), 280 + i * 150, 82); });
  g.fillStyle = P.ink; g.font = `400 24px ${SANS}`; g.fillText('non pris en charge', 560, 74);
  g.fillStyle = '#2A313B'; g.fillRect(40, 110, W - 80, 2);
  const list = alarmList().slice(0, 5);
  boardRows = [];
  if (S.storm) { g.fillStyle = P.major; g.font = `600 30px ${SANS}`; g.fillText(`Tempête : ${S.storm.count} alarmes en ${Math.round(S.storm.window)} s`, 44, 160); g.fillStyle = P.inkLight; g.font = `400 26px ${SANS}`; g.fillText(`cause commune probable : ${S.storm.cause}`, 44, 198); }
  const top = S.storm ? 232 : 132;
  list.forEach((r, i) => {
    const y = top + i * 108;
    const focus = i === S.boardFocus; const sel = S.focusEvent === r.id;
    if (focus || sel) { g.fillStyle = '#1F252E'; g.fillRect(28, y, W - 56, 100); if (focus) { g.strokeStyle = P.ivory; g.lineWidth = 4; g.strokeRect(30, y + 2, W - 60, 96); } }
    g.fillStyle = r.ackNow ? P.ink : P.inkLight; g.font = `500 30px ${MONO}`; g.fillText(String(i + 1), 50, y + 48);
    const blinking = r.prio === 1 && !r.ackNow && !S.replay && !S.storm;
    drawGlyph(g, r.prio, 104, y + 38, 16, { ack: !!r.ackNow, dim: blinking && !blinkOn });
    g.fillStyle = r.ackNow ? P.ink : P.ivory; g.font = `500 38px ${MONO}`; g.fillText(r.obj.startsWith('svc:') ? svcName(r.obj) : r.obj, 140, y + 50, 340);
    g.fillStyle = r.ackNow ? P.ink : P.inkLight; g.font = `500 34px ${SANS}`; g.fillText(r.title, 500, y + 50, W - 540);
    g.fillStyle = P.ink; g.font = `400 26px ${MONO}`; g.fillText(`${fmtAge(r.age)} · ${r.ackNow ? `pris : ${r.ackNow.by}` : 'non pris'}${r.children?.length ? ` · ${r.children.length} conséquences` : ''}`, 140, y + 88, W - 180);
    boardRows.push({ y0: y, y1: y + 100, ev: r });
  });
  if (!list.length) { g.fillStyle = P.ink; g.font = `400 34px ${SANS}`; g.fillText('Aucune panne P1 ou P2.', 44, 180); }
  boardTex.needsUpdate = true; invalidate();
}

// ============================================================ règle du temps au sol (relecture)
const RULE = { x0: 0.9, x1: 7.1, z: 2.55, span: 86400 };
const ruleX = (age) => RULE.x1 - (RULE.x1 - RULE.x0) * Math.log1p(Math.max(0, age) / 60) / Math.log1p(RULE.span / 60);
const ruleAge = (x) => Math.expm1(((RULE.x1 - Math.min(RULE.x1, Math.max(RULE.x0, x))) / (RULE.x1 - RULE.x0)) * Math.log1p(RULE.span / 60)) * 60;
const rule = new THREE.Group(); scene.add(rule);
const ruleMat = new THREE.MeshStandardMaterial({ color: '#2A313B' });
const ruleBar = new THREE.Mesh(new THREE.BoxGeometry(RULE.x1 - RULE.x0, 0.01, 0.07), ruleMat);
ruleBar.position.set((RULE.x0 + RULE.x1) / 2, 0.005, RULE.z); ruleBar.userData = { id: 'rule' }; rule.add(ruleBar); pickables.push(ruleBar);
for (const [age, label] of [[0, 'maintenant'], [300, '−5 min'], [3600, '−1 h'], [21600, '−6 h'], [86400, '−24 h']]) {
  const x = ruleX(age);
  const tick = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.16), new THREE.MeshBasicMaterial({ color: '#5A636E' })); tick.position.set(x, 0.008, RULE.z); rule.add(tick);
  const lab = textPlane(label, { size: 0.1, color: '#5A636E', font: "400 64px 'IBM Plex Mono', monospace" }); lab.rotation.x = -Math.PI / 2; lab.position.set(x - 0.04, 0.006, RULE.z + 0.2); rule.add(lab);
}
// repères d'événements à l'encre : une couleur d'alarme au sol imiterait une alarme active
for (const e of EVENT_BY_ID.values()) {
  if (e.group || e.start < -RULE.span) continue;
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.02, 0.09), new THREE.MeshBasicMaterial({ color: '#8A94A0' })); m.position.set(ruleX(-e.start), 0.012, RULE.z - 0.1); rule.add(m);
}
const knob = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.22), new THREE.MeshStandardMaterial({ color: P.inkLight }));
knob.position.set(RULE.x1, 0.035, RULE.z); knob.userData = { id: 'knob' }; rule.add(knob); pickables.push(knob);
const replayFrame = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(rectPoints(-2.35, -6.35, 7.35, 2.95, 0.02).slice(0, 4)), new THREE.LineBasicMaterial({ color: P.temporal }));
replayFrame.visible = false; scene.add(replayFrame);
function placeKnob() { knob.position.x = ruleX(S.replay ? nowT() - S.replay.t : 0); knob.material.color.set(S.replay ? P.temporal : P.inkLight); ruleMat.color.set(S.replay ? '#3A2E52' : '#2A313B'); replayFrame.visible = !!S.replay; }

// ============================================================ onde, tiroir
const pulses = [];
const ringGeo = new THREE.RingGeometry(0.92, 1, 64);
function pulseAt(pos, color, { maxR = 5, dur = CH.ondeMs } = {}) {
  const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2; m.position.set(pos.x, 0.02, pos.z); scene.add(m);
  pulses.push({ m, t0: performance.now(), dur, maxR }); invalidate();
}
const drawers = new Map();
function setDrawer(id, out) { const dm = deviceMeshes.get(id); if (!dm) return; const d = drawers.get(id) || { cur: 0, target: 0, base: dm.mesh.position.z }; d.target = out ? 1 : 0; drawers.set(id, d); invalidate(); }

// ============================================================ caméra
const view = { target: new THREE.Vector3(2.2, 1.6, -1.6), theta: -0.62, phi: 0.62, zoom: 1, base: 5.4 };
const HOME = { theta: view.theta, phi: view.phi };
let anim = null;
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
function applyCamera() {
  const r = 60;
  camera.position.set(view.target.x + r * Math.cos(view.phi) * Math.sin(view.theta), view.target.y + r * Math.sin(view.phi), view.target.z + r * Math.cos(view.phi) * Math.cos(view.theta));
  camera.lookAt(view.target);
  const w = canvas.clientWidth || 1; const h = canvas.clientHeight || 1; const half = view.base / view.zoom;
  camera.left = -half * (w / h); camera.right = half * (w / h); camera.top = half; camera.bottom = -half;
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
}
function animateTo(to, ms = CH.recadrageMs) { anim = { from: { target: view.target.clone(), theta: view.theta, phi: view.phi, zoom: view.zoom }, to, t0: performance.now(), ms: reduceMotion || S.mur ? 0 : ms }; invalidate(); }
/** Cadre une boîte sans changer l'orientation (aucune rotation automatique). */
function frameBox(b3, { theta = view.theta, phi = view.phi, margin = 1.06, ms } = {}) {
  const c = new THREE.Vector3(); b3.getCenter(c);
  const cam = new THREE.Object3D(); cam.position.copy(c).add(new THREE.Vector3(Math.cos(phi) * Math.sin(theta), Math.sin(phi), Math.cos(phi) * Math.cos(theta))); cam.lookAt(c); cam.updateMatrixWorld();
  const inv = cam.matrixWorld.clone().invert(); let mx = 0; let my = 0;
  for (const x of [b3.min.x, b3.max.x]) for (const y of [b3.min.y, b3.max.y]) for (const z of [b3.min.z, b3.max.z]) { const p = new THREE.Vector3(x, y, z).applyMatrix4(inv); mx = Math.max(mx, Math.abs(p.x)); my = Math.max(my, Math.abs(p.y)); }
  const aspect = (canvas.clientWidth || 1) / (canvas.clientHeight || 1);
  animateTo({ target: c, theta, phi, zoom: view.base / (Math.max(my, mx / aspect) * margin) }, ms);
}
const ROOM_BOX = new THREE.Box3(new THREE.Vector3(-3.8, 0, -6.4), new THREE.Vector3(7.4, 2.2, 3.0));
function home(ms) { const b = ROOM_BOX.clone(); b.max.y = strataY('services', S.explodeTarget) + 0.4; frameBox(b, { theta: HOME.theta, phi: HOME.phi, margin: 1.02, ms }); }

// ============================================================ commandes souris et tactile
let drag = null; const pointers = new Map();
let lastInteraction = -Infinity;
const touched = () => { lastInteraction = performance.now(); if (S.pendingFrame) { S.pendingFrame = null; drawLegend(); } };
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  if (S.mur) return;
  touched(); canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const hit = pick(e);
  if (hit?.id === 'knob' || hit?.id === 'rule') { drag = { mode: 'rule' }; scrub(hit.point); return; }
  drag = { x: e.clientX, y: e.clientY, moved: 0, pan: e.button === 2 || e.button === 1 || e.shiftKey, pinch: pointers.size === 2 ? dist() : 0 };
});
function dist() { const [a, b] = [...pointers.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; }
canvas.addEventListener('pointermove', (e) => {
  if (S.mur) return;
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (drag?.mode === 'rule') { const hit = pickPlaneY(e, 0.01); if (hit) scrub(hit); return; }
  if (drag) {
    if (pointers.size === 2 && drag.pinch) { const d = dist(); view.zoom = Math.min(8, Math.max(0.45, view.zoom * d / drag.pinch)); drag.pinch = d; anim = null; invalidate(); return; }
    const dx = e.clientX - drag.x; const dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY;
    if (drag.moved < 4) return;
    if (drag.pan) { const k = (2 * view.base / view.zoom) / (canvas.clientHeight || 1); const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0); const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1); view.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k); }
    else { view.theta -= dx * 0.006; view.phi = Math.min(1.4, Math.max(0.18, view.phi + dy * 0.005)); }
    anim = null; invalidate(); return;
  }
  queueHover(e);
});
canvas.addEventListener('pointerup', (e) => { pointers.delete(e.pointerId); const d = drag; drag = null; if (d?.mode === 'rule') return; if (d && d.moved < 5) onClick(e); });
canvas.addEventListener('pointerleave', () => setHover(null));
canvas.addEventListener('dblclick', (e) => { if (S.mur) return; const h = pick(e); if (h?.id && !h.card) focusObject(h.id); });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); if (S.mur) return; touched(); view.zoom = Math.min(8, Math.max(0.45, view.zoom * Math.exp(-e.deltaY * 0.0012))); anim = null; invalidate(); }, { passive: false });

const ray = new THREE.Raycaster();
function ndc(e) { const r = canvas.getBoundingClientRect(); return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); }
function visibleDeep(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }
function pick(e) {
  ray.setFromCamera(ndc(e), camera);
  const ch = ray.intersectObjects([...cards].filter((c) => c.mesh.visible).map((c) => c.mesh), false).sort((a, b) => a.object.userData.card.prio - b.object.userData.card.prio)[0];
  if (ch) { const card = ch.object.userData.card; const px = ch.uv.x * card.w; const py = (1 - ch.uv.y) * card.h; const hit = card.hits.find((h) => px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h); if (hit || !card.screen) return { card, action: hit?.action, id: card.id }; }
  const hits = ray.intersectObjects(pickables.filter(visibleDeep), false);
  if (!hits.length) return null;
  const best = hits.find((h) => !racks.has(h.object.userData.id)) || hits[0];
  const id = best.object.userData.id;
  if (id === 'board') { const py = (1 - best.uv.y) * BOARD.h; const row = boardRows.find((r) => py >= r.y0 && py <= r.y1); return { id: row ? row.ev.obj : null, board: row?.ev, point: best.point }; }
  return { id, point: best.point };
}
function pickPlaneY(e, y) { ray.setFromCamera(ndc(e), camera); const pt = new THREE.Vector3(); return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), pt) ? pt : null; }
let hoverQ = null;
function queueHover(e) { if (hoverQ) { hoverQ = e; return; } hoverQ = e; requestAnimationFrame(() => { const ev = hoverQ; hoverQ = null; const h = pick(ev); setHover(h && !h.card && h.id && !h.id.startsWith('strate:') && !['rule', 'knob', 'board'].includes(h.id) ? h.id : null); canvas.style.cursor = h?.action || h?.id || h?.board ? 'pointer' : 'grab'; }); }
function onClick(e) {
  const h = pick(e);
  if (h?.card) { if (h.action) runAction(h.action); return; }
  if (h?.board) { focusEvent(h.board.id, { fromUser: true }); return; }
  if (!h?.id) { if (S.sel) select(null); else if (S.focusEvent || S.stratum) { S.focusEvent = null; S.stratum = null; applyFocus(); refreshHighlight(); home(); } return; }
  if (h.id.startsWith('strate:')) { isolate(h.id.slice(7)); return; }
  if (['rule', 'knob'].includes(h.id)) return;
  select(h.id === S.sel ? null : h.id);
}

// ============================================================ sélection, survol, mise en avant
let hoverCard = null; let selCard = null; const alarmCards = new Map(); const svcLabels = new Map();
function labelOf(id) { return id.startsWith('svc:') ? svcName(id) : id.startsWith('ext-') ? EXT.find((e) => e.id === id)?.name || id : id; }
function stateWord(st) { return { root: 'cause racine', critical: 'critique', down: 'interrompu', unreach: 'injoignable', major: 'majeur', degraded: 'sans réserve', minor: 'mineur', maint: 'maintenance' }[st] || 'nominal'; }
function kindOf(id) { const d = describe(id); if (id.startsWith('svc:')) return 'service'; if (id.startsWith('ext-')) return 'sortie réseau'; return { host: 'hôte', vm: 'VM', rack: 'baie', cluster: 'cluster', device: d?.device?.type || 'équipement' }[d?.kind] || 'objet'; }
function setHover(id) {
  if (id === S.hover) return;
  S.hover = id;
  if (hoverCard) { hoverCard.remove(); hoverCard = null; }
  if (id && id !== S.sel) {
    hoverCard = new Card({ w: 260, h: 50, anchor: () => worldOf(id), offset: [16, 18], prio: 3 });
    hoverCard.draw((g, w, h) => { panel(g, w, h); g.fillStyle = P.ivory; g.font = `500 14px ${MONO}`; g.fillText(labelOf(id), 12, 21, w - 24); g.fillStyle = P.ink; g.font = `400 12px ${SANS}`; g.fillText(`${kindOf(id)} · ${globalWord(id) || stateWord(state.obj.get(id))}`, 12, 39, w - 24); });
  }
  refreshHighlight();
}
function globalWord(id) {
  if (glob.perimes.includes(id)) return 'aucune donnée récente';
  const r = gl(glob.redondance, id); if (r && r.niveau !== 'tenue') return `redondance ${r.niveau}`;
  const m = gl(glob.marge, id); if (m) return 'marge mince';
  return null;
}
function select(id, { frame = false } = {}) {
  S.sel = id; if (!id) S.ackOpen = null;
  if (selCard) { selCard.remove(); selCard = null; }
  if (id) { selCard = new Card({ w: 340, h: 200, anchor: () => worldOf(id), offset: [34, 40], id, prio: 1 }); drawSelCard(); announce(`Sélection : ${labelOf(id)}, ${kindOf(id)}, ${stateWord(state.obj.get(id))}.`); if (S.pendingFrame) S.pendingFrame = null; }
  if (hoverCard && S.hover === id) { hoverCard.remove(); hoverCard = null; }
  for (const sid of svcPads.keys()) drawPad(sid);
  refreshHighlight(); updateAlarmCards(); drawBoard();
  if (frame && id) focusObject(id);
}
function rootEventFor(id) { const ev = state.events.find((e) => e.obj === id); if (!ev) return null; return ev.group ? state.roots.find((r) => r.id === ev.group) : state.roots.find((r) => r.id === ev.id); }
function drawSelCard() {
  if (!selCard) return;
  const id = S.sel; const d = describe(id); const st = state.obj.get(id);
  const ev = state.events.filter((e) => e.obj === id).sort((a, b) => (a.prio || 9) - (b.prio || 9))[0];
  const root = rootEventFor(id); const isCause = root && ev && !ev.group;
  const facts = [];
  if (d?.device) facts.push(['Emplacement', `baie ${d.device.rack} · U${d.device.u}`], ['Modèle', `${d.device.vendor} ${d.device.model}`]);
  if (d?.host) facts.push(['Cluster', d.host.cluster], ['VM', String(WORLD.vms.filter((v) => state.vmHost.get(v.name) === id).length)]);
  if (d?.vm) facts.push(['Hôte', state.vmHost.get(id)], ['Application', d.vm.app], ['Adresse', `${d.vm.ip} · VLAN ${d.vm.vlan}`]);
  if (id.startsWith('svc:')) { const ms = svcMembers.get(id) || []; facts.push(['Membres', `${ms.length} (${ms.slice(0, 3).join(', ')}${ms.length > 3 ? '…' : ''})`]); }
  if (d?.kind === 'rack') facts.push(['Équipements', String(WORLD.room.rows.flatMap((r) => r.racks).find((r) => r.id === id)?.devices.length)]);
  if (d?.kind === 'cluster') facts.push(['Hôtes', String(d.hosts.length)]);
  // état global de l'objet : ce que la scène encode, en toutes lettres
  const redo = gl(glob.redondance, id); if (redo) facts.push(['Redondance', `${redo.niveau} · ${redo.detail}`]);
  const marge = gl(glob.marge, id); if (marge) facts.push(['Marge', marge.detail]);
  const burn = gl(glob.budget, id); if (burn && burn.vitesse >= 6 && st !== 'down') facts.push(['Budget', burn.detail]);
  const chg = gl(glob.changements, id); if (chg) facts.push(['Intervention', chg.detail]);
  const hr = gl(glob.horsRegime, id); if (hr) facts.push(['Trafic', hr.detail]);
  if (glob.perimes.includes(id)) facts.push(['Données', 'aucune mesure depuis 3 intervalles']);
  const ms = metricsFor(id);
  const ackMode = S.ackOpen && root && S.ackOpen === root.id;
  const h = 64 + (ev ? 40 : 18) + facts.length * 19 + (ms.length ? 62 : 0) + (root && root.prio > 0 ? (ackMode ? 120 : 44) : 0) + 10;
  selCard.resize(360, h);
  selCard.draw((g, w, hh, card) => {
    panel(g, w, hh, P.ivory); g.textBaseline = 'alphabetic';
    if (ev) drawGlyph(g, ev.prio, 20, 27, 7, { ack: !!ev.ackNow });
    g.fillStyle = P.ivory; g.font = `500 17px ${MONO}`; g.fillText(labelOf(id), ev ? 36 : 14, 32, w - 50);
    g.fillStyle = P.ink; g.font = `400 12px ${SANS}`; g.fillText(kindOf(id), 14, 52);
    let y = 64;
    if (ev) {
      g.fillStyle = ev.prio === 1 ? P.critical : ev.prio === 2 ? P.major : P.inkLight; g.font = `600 13px ${SANS}`;
      g.fillText(`${USER_IMPACT[id] && st === 'down' ? USER_IMPACT[id] : ev.title}${ev.prio ? ` · ${fmtAge(ev.age)}` : ''}`, 14, y + 14, w - 28);
      g.fillStyle = P.ink; g.font = `400 11.5px ${SANS}`; g.fillText(ev.group ? `conséquence de ${state.roots.find((r) => r.id === ev.group)?.obj}` : ev.ackNow ? `pris en charge par ${ev.ackNow.by}` : ev.detail, 14, y + 31, w - 28); y += 40;
    } else { g.fillStyle = P.ink; g.font = `400 12px ${SANS}`; g.fillText(globalWord(id) || 'nominal', 14, y + 12); y += 18; }
    for (const [k, v] of facts) { g.fillStyle = P.ink; g.font = `400 12px ${SANS}`; g.fillText(k, 14, y + 14); g.fillStyle = P.inkLight; g.font = `400 12px ${MONO}`; g.fillText(v, 106, y + 14, w - 120); y += 19; }
    if (ms.length) {
      const sr = series(id, ms[0], '24h', Math.floor(currentT() / 300) * 300); const max = { cpu: 100, mem: 100, net: 100, temp: 35 }[ms[0]];
      const x0 = 14; const cw = w - 28; const chh = 38; const y0 = y + 8;
      g.fillStyle = '#161A20'; g.fillRect(x0, y0, cw, chh);
      g.beginPath(); let pen = false; let gap = null;
      sr.v.forEach((v, i) => { const X = x0 + (i / (sr.v.length - 1)) * cw; if (v == null) { pen = false; if (gap == null) gap = X; return; } const Y = y0 + chh - (v / max) * chh; if (pen) g.lineTo(X, Y); else g.moveTo(X, Y); pen = true; });
      g.strokeStyle = '#9CC3EA'; g.lineWidth = 1.3; g.stroke();
      if (gap != null) { g.fillStyle = 'rgba(90,99,110,0.35)'; g.fillRect(gap, y0, x0 + cw - gap, chh); }
      g.fillStyle = P.disabled; g.font = `400 10px ${MONO}`; g.fillText(`${{ cpu: 'CPU', mem: 'mémoire', net: 'réseau', temp: 'T° entrée' }[ms[0]]} · 24 h`, x0, y0 + chh + 12);
      y += 62;
    }
    if (root && root.prio > 0) {
      if (!isCause) button(card, g, 14, y + 6, 220, 30, `Ouvrir la cause : ${root.obj}`, `open:${root.id}`);
      else if (root.ackNow) { g.fillStyle = P.ink; g.font = `400 12px ${SANS}`; g.fillText(`Pris en charge par ${root.ackNow.by}${root.ackNow.comment ? ` · « ${root.ackNow.comment} »` : ''}`, 14, y + 22, w - 28); }
      else if (S.replay || S.frozen) { g.fillStyle = S.frozen ? P.major : P.temporal; g.font = `400 12px ${SANS}`; g.fillText(S.frozen ? 'Données figées : action suspendue' : 'Relecture : revenir au direct (L) pour agir', 14, y + 22); }
      else if (!ackMode) button(card, g, 14, y + 6, 190, 30, 'Prendre en charge · A', `ack-open:${root.id}`, { primary: true });
      else {
        g.fillStyle = P.ink; g.font = `600 10.5px ${COND}`; g.fillText('COMMENTAIRE (taper au clavier)', 14, y + 16);
        g.strokeStyle = P.ivory; g.strokeRect(14.5, y + 22.5, w - 29, 26); g.fillStyle = S.comment ? P.inkLight : P.disabled; g.font = `400 12.5px ${SANS}`; g.fillText(S.comment ? `${S.comment}_` : 'ex. intervention salle A_', 22, y + 40, w - 44);
        ACK_TEMPLATES.slice(0, 3).forEach((t, i) => button(card, g, 14 + i * 110, y + 56, 106, 24, `${i + 1} ${t}`, `tpl:${t}`));
        button(card, g, 14, y + 88, 130, 26, 'Valider · Entrée', `ack:${root.id}`, { primary: true });
      }
    }
  });
}

/** Mise en avant : traçage ivoire de la chaîne ; les objets nominaux hors chaîne perdent 30 % de luminance au plus. */
let hl = { sel: new Set(), red: new Set(), hover: new Set() };
const dimmed = (id) => !S.mur && !!(S.sel || S.focusEvent) && !hl.sel.has(id) && !hl.red.has(id) && !hl.hover.has(id) && !state.obj.has(id) && !globalWord(id);
function refreshHighlight() {
  const selC = S.sel ? chainOf(S.sel) : { ids: new Set(), segs: [] };
  const hovC = S.hover ? chainOf(S.hover) : { ids: new Set(), segs: [] };
  const focus = S.focusEvent ? state.roots.find((r) => r.id === S.focusEvent) : null;
  const redC = focus ? chainOf(focus.obj) : { ids: new Set(), segs: [] };
  hl = { sel: selC.ids, red: redC.ids, hover: hovC.ids };
  setLines(hiLines, [...selC.segs, ...hovC.segs]);
  setLines(traceLines, redC.segs);
  for (const [id, t] of vmTiles) if (t.base) t.mat.color.copy(t.base).multiplyScalar(dimmed(id) ? 0.7 : 1);
  for (const [id, t] of hostTiles) if (!gl(glob.marge, id) && state.obj.get(id) !== 'root') t.mat.color.set(dimmed(id) ? '#1B1F25' : '#262C34');
  for (const [id, n] of netNodes) if (!state.obj.has(id) && !gl(glob.marge, id)) n.mat.color.set(dimmed(id) ? '#2A2F37' : id.startsWith('ext-') ? '#2F363F' : '#3B434E');
  for (const id of svcPads.keys()) drawPad(id);
  hoverBox.visible = false;
  const ht = S.hover && deviceMeshes.get(S.hover)?.mesh; if (ht) { placeBox(hoverBox, new THREE.Box3().setFromObject(ht), 0.012); hoverBox.visible = true; }
  selBox.visible = false;
  const stO = S.sel && (deviceMeshes.get(S.sel)?.mesh || racks.get(S.sel)?.body); if (stO) { placeBox(selBox, new THREE.Box3().setFromObject(stO), 0.02); selBox.visible = true; }
  invalidate();
}
const hoverBox = edges(new THREE.BoxGeometry(1, 1, 1), P.ivory, 0.8); hoverBox.visible = false; scene.add(hoverBox);
const selBox = edges(new THREE.BoxGeometry(1, 1, 1), P.ivory, 1); selBox.visible = false; scene.add(selBox);
const stateBoxes = new THREE.Group(); scene.add(stateBoxes);
function placeBox(o, b3, pad) { const s = new THREE.Vector3(); const c = new THREE.Vector3(); b3.getSize(s); b3.getCenter(c); o.position.copy(c); o.scale.set(s.x + pad, s.y + pad, s.z + pad); }

function isolate(id) {
  S.stratum = S.stratum === id || id === 'tout' ? null : id;
  applyFocus();
  if (!S.stratum) { home(); return; }
  S.explodeTarget = 1;
  const y = strataY(S.stratum, 1);
  frameBox(new THREE.Box3(new THREE.Vector3(FOOT.x0, y - 0.2, FOOT.z0), new THREE.Vector3(FOOT.x1, y + 0.5, FOOT.z1)), { phi: S.stratum === 'physique' ? 0.62 : 0.95, margin: 1.15 });
  announce(`Strate ${SBY[S.stratum].label.toLowerCase()} isolée.`);
}
function applyFocus() {
  for (const s of STRATA.slice(1)) { layers[s.id].group.visible = !S.stratum || S.stratum === s.id; layers[s.id].sheetMat.opacity = S.stratum === s.id ? 0.05 : 0; }
  faintLines.visible = !S.stratum; invalidate();
}
function focusObject(id) { const w = worldOf(id); if (!w) return; const b = ROOM_BOX.clone(); b.expandByPoint(w); b.max.y = Math.max(b.max.y, w.y + 0.6); frameBox(b, { margin: 1.02 }); }

// ============================================================ chorégraphie de panne (conseil de production)
// Bouge une fois puis se tait : onde unique, strates écartées, tiroir, traçage ivoire. La caméra ne tourne
// jamais d'elle-même et ne recadre (salle entière + colonne) que si personne ne la manipule depuis 60 s.
function incidentBox(r) {
  const w = worldOfDevice(r.obj) || (racks.has(r.obj) ? rackWorldPos(r.obj) : worldOf(r.obj));
  const b = ROOM_BOX.clone(); if (w) b.expandByPoint(new THREE.Vector3(w.x, strataY('services', 1) + 1.1, w.z));
  b.max.y = Math.max(b.max.y, strataY('services', 1) + 1.1);
  return { b, w };
}
function frameIncident(r) { frameBox(incidentBox(r).b, { margin: 1.03 }); S.pendingFrame = null; }
function focusEvent(evId, { choreo = false, fromUser = false } = {}) {
  const r = state.roots.find((x) => x.id === evId); if (!r) return;
  S.focusEvent = evId; S.explodeTarget = 1;
  const { w } = incidentBox(r);
  if (r.prio === 1 && deviceMeshes.has(r.obj) && !S.mur && !S.storm && !r.ackNow) setDrawer(r.obj, true);
  const idle = performance.now() - lastInteraction > CH.recadrageApresInactiviteS * 1000;
  if (S.mur) S.pendingFrame = null;
  else if (fromUser || (idle && !S.sel)) frameIncident(r);
  else S.pendingFrame = evId;
  if (choreo && w && r.prio === 1 && !S.mur && !S.storm) pulseAt(w, P.critical);
  refreshHighlight(); updateAlarmCards(); drawBoard(); drawLegend();
  announce(`${r.prio === 1 ? 'Panne critique' : 'Panne'} : ${labelOf(r.obj)}, ${lcFirst(r.title)}${r.children?.length ? `, ${r.children.length} conséquences regroupées` : ''}.`);
}
function checkNewIncidents() {
  for (const r of state.roots) if (r.prio === 1 && !r.ackNow && !S.seenP1.has(r.id)) { S.seenP1.add(r.id); if (!S.storm) focusEvent(r.id, { choreo: true }); }
}

// cartel de la panne mise en avant et épingles numérotées pour les autres : un seul cartel ouvert à la fois
function updateAlarmCards() {
  const list = alarmList().filter((r) => !r.ackNow && (deviceMeshes.has(r.obj) || racks.has(r.obj))).slice(0, 5);
  const numbered = alarmList();
  const primary = !S.sel && !S.storm ? (list.find((r) => r.id === S.focusEvent) || list.find((r) => r.prio === 1)) : null;
  const keep = new Set(list.map((r) => r.id));
  for (const [id, c] of alarmCards) if (!keep.has(id) || c.mode !== (primary?.id === id ? 'full' : 'pin')) { c.remove(); alarmCards.delete(id); }
  for (const r of list) {
    const mode = primary?.id === r.id ? 'full' : 'pin';
    let c = alarmCards.get(r.id);
    const col = r.prio === 1 ? P.critical : P.major;
    const anchor = () => { const w = worldOfDevice(r.obj) || rackWorldPos(r.obj); return w ? new THREE.Vector3(w.x, strataY('services') + 0.8, w.z) : null; };
    if (!c) { c = mode === 'full' ? new Card({ w: 360, h: 76, anchor, offset: [18, 10], leader: '#8A94A0', id: r.obj, prio: 2 }) : new Card({ w: 56, h: 30, anchor, offset: [8, 6], leader: '#5A636E', id: r.obj, prio: 4 }); c.mode = mode; alarmCards.set(r.id, c); }
    const n = numbered.indexOf(r) + 1;
    const blinkOff = r.prio === 1 && !S.replay && !S.storm && !blinkOn;
    if (mode === 'pin') { c.draw((g, w, h, card) => { panel(g, w, h, col); drawGlyph(g, r.prio, 16, 15, 7, { dim: blinkOff }); g.fillStyle = P.ivory; g.font = `500 14px ${MONO}`; g.fillText(String(n), 30, 20); card.hits.push({ x: 0, y: 0, w, h, action: `open:${r.id}` }); }); continue; }
    const vms = r.children?.filter((x) => x.id.startsWith('vm-')).length || 0;
    const down = r.children?.filter((x) => x.id.startsWith('svc-') && x.prio === 1).map((x) => svcName(x.obj)) || [];
    const sub = r.id === 'esx08' ? `${down.length ? `${down.join(' et ')} : 100 % des accès en échec · ` : ''}${vms} VM injoignables` : r.detail;
    c.draw((g, w, h, card) => {
      panel(g, w, h, col);
      drawGlyph(g, r.prio, 20, 24, 8, { dim: blinkOff });
      g.fillStyle = P.ivory; g.font = `500 15px ${MONO}`; g.fillText(`${n} ${labelOf(r.obj)}`, 38, 29, 170);
      const nw = Math.min(170, g.measureText(`${n} ${labelOf(r.obj)}`).width);
      g.font = `600 14px ${SANS}`; g.fillText(` · ${lcFirst(r.title)} · ${fmtAge(r.age)}`, 38 + nw, 29, w - 50 - nw);
      g.fillStyle = P.inkLight; g.font = `400 12px ${SANS}`; g.fillText(sub, 14, 54, w - 28);
      g.fillStyle = P.ink; g.font = `400 11px ${SANS}`; g.fillText(S.pendingFrame === r.id ? 'Entrée : cadrer · A : prendre en charge' : 'A : prendre en charge · clic : ouvrir', 14, 70, w - 28);
      card.hits.push({ x: 0, y: 0, w, h, action: `open:${r.id}` });
    });
  }
}
// étiquettes des services, à taille constante (masquées si elles gênent un cartel)
function updateSvcLabels() {
  for (const [id] of svcPads) {
    let c = svcLabels.get(id);
    if (!c) { c = new Card({ w: 150, h: 22, anchor: () => worldOf(id), offset: [-75, 6], id, prio: 6 }); c.optional = true; c.line.visible = false; scene.remove(c.line); svcLabels.set(id, c); }
    const st = state.obj.get(id);
    c.draw((g) => { g.font = `500 13px ${SANS}`; g.textAlign = 'center'; halo(g, svcName(id), 75, 16, st === 'down' ? P.ivory : '#8A94A0'); g.textAlign = 'left'; });
  }
}

// ============================================================ prise en charge et actions
function runAction(a) {
  const i = a.indexOf(':'); const kind = a.slice(0, i); const arg = a.slice(i + 1);
  if (kind === 'open') { const r = state.roots.find((x) => x.id === arg); if (r) { focusEvent(r.id, { fromUser: true }); select(r.obj); } return; }
  if (kind === 'ack-open') { S.ackOpen = arg; S.comment = ''; drawSelCard(); return; }
  if (kind === 'tpl') { S.comment = arg; drawSelCard(); return; }
  if (kind === 'ack') acknowledge(arg);
}
function acknowledge(evId) {
  if (S.replay || S.frozen) return;
  const e = EVENT_BY_ID.get(evId); if (!e) return;
  S.acks[evId] = { by: 'Vous · N1', comment: S.comment.trim(), at: nowT() };
  S.ackOpen = null; S.comment = '';
  // la scène se calme d'un cran : le clignotement cesse, le serveur rentre, la caméra ne bouge pas
  if (deviceMeshes.has(e.obj)) setDrawer(e.obj, false);
  announce(`Pris en charge : ${labelOf(e.obj)}.`);
  update(true);
}

// ============================================================ tempête simulée (touche T)
// Au-delà de 3 nouvelles causes en 60 s : animations suspendues, cause commune probable désignée,
// au-delà de 7 causes ouvertes : agrégation par rangée. Les conséquences sont retenues 15 s.
const STORM_OBJ = ['tor-a03-1', 'tor-a04-1', 'tor-a05-1', 'tor-a06-1', 'tor-a07-1', 'tor-a08-1', 'tor-b01-1', 'tor-b02-1', 'tor-b03-1', 'tor-b05-1', 'lb-par-1', 'fw-par-1'];
function toggleStorm() {
  if (S.storm) { S.storm = null; update(true); announce('Fin de la tempête simulée.'); return; }
  S.storm = { t0: currentT(), cause: 'core-par-1', count: STORM_OBJ.length, window: 42 };
  update(true);
  announce(`Tempête : ${STORM_OBJ.length} alarmes en 42 secondes, cause commune probable core-par-1. Animations suspendues.`);
}
function injectStorm(st) {
  if (!S.storm) return;
  const age = st.t - S.storm.t0;
  STORM_OBJ.forEach((obj, i) => {
    const start = S.storm.t0 + i * 3.5;
    if (st.t < start) return;
    const ev = { id: `storm-${obj}`, prio: 2, obj, title: 'Lien amont vers core-par-1 down', detail: 'Eth1/49', start, age: st.t - start, end: Infinity, group: null, ackNow: null, children: [] };
    st.events.push(ev); st.roots.push(ev); st.obj.set(obj, st.obj.get(obj) || 'major'); st.counters[2]++;
  });
  if (age >= 0) { st.obj.set('core-par-1', 'root'); }
}

// ============================================================ mise à jour de l'état
let dataAge = 4; let sig = ''; let prevRoots = null;
function update(force = false) {
  state = stateAt(currentT(), S.acks);
  injectStorm(state);
  glob = globalAt(currentT());
  const s = state.events.map((e) => `${e.id}${e.ackNow ? '+' : ''}`).join() + (state.afterHA ? 'H' : '') + (S.storm ? 'T' : '') + (S.frozen ? 'F' : '');
  const changed = force || s !== sig; sig = s;
  if (changed) {
    // cicatrice : un objet rétabli garde un contour gris clair 30 min (« ça recommence » se voit)
    const live = !S.replay && !S.frozen;
    const roots = new Set(state.roots.filter((r) => r.prio === 1 || r.prio === 2).map((r) => r.obj));
    if (live && prevRoots) for (const o of prevRoots) if (!roots.has(o)) S.scars.set(o, nowT());
    for (const o of roots) S.scars.delete(o);
    prevRoots = live ? roots : null;
    applyStateVisuals(); applyGlobalVisuals(); checkNewIncidents();
    if (S.focusEvent && !state.roots.some((r) => r.id === S.focusEvent)) S.focusEvent = null;
    // strates refermées 5 min après la dernière résolution d'une cause P1
    const anyP1 = state.roots.some((r) => r.prio === 1);
    if (anyP1) S.lastP1Resolved = null; else if (S.lastP1Resolved == null && S.explodeTarget > 0) S.lastP1Resolved = nowT();
    updateSvcLabels();
  }
  if (S.lastP1Resolved != null && nowT() - S.lastP1Resolved > CH.refermerStratesApresS && !S.stratum) { S.explodeTarget = 0; S.lastP1Resolved = null; }
  let healed = false;
  for (const [o, t] of S.scars) if (nowT() - t > CH.cicatriceMin * 60) { S.scars.delete(o); healed = true; }
  if (healed && !changed) applyStateVisuals();
  drawBoard(); drawLegend(); placeKnob(); updateAlarmCards();
  if (selCard) drawSelCard();
}
function applyStateVisuals() {
  for (const [id, dm] of deviceMeshes) {
    const st = state.obj.get(id);
    dm.material.emissive.set(st === 'root' ? P.critical : 0x000000); dm.material.emissiveIntensity = st === 'root' ? 0.3 : 0;
    dm.material.color.set(st === 'maint' ? '#8A94A0' : '#ffffff');
  }
  stateBoxes.clear();
  for (const [id, st] of state.obj) {
    const col = { root: P.critical, critical: P.critical, major: P.major, minor: P.minor }[st];
    if (!col || glob.perimes.includes(id)) continue; // l'inconnu se dit en hachure, pas en couleur
    const o = deviceMeshes.get(id)?.mesh || racks.get(id)?.body; if (!o) continue;
    const e = edges(new THREE.BoxGeometry(1, 1, 1), col, st === 'minor' ? 0.7 : 1); placeBox(e, new THREE.Box3().setFromObject(o), racks.has(id) ? 0.02 : 0.012); stateBoxes.add(e);
  }
  if (!S.replay) for (const id of S.scars.keys()) {
    const o = deviceMeshes.get(id)?.mesh || racks.get(id)?.body; if (!o || state.obj.has(id)) continue;
    const e = edges(new THREE.BoxGeometry(1, 1, 1), '#B8BFC7', 0.55); placeBox(e, new THREE.Box3().setFromObject(o), racks.has(id) ? 0.02 : 0.012); stateBoxes.add(e);
  }
  layoutVms();
  for (const [id, t] of hostTiles) { const root = state.obj.get(id) === 'root'; t.mat.color.set(root ? '#3A2022' : '#262C34'); t.rim.material.color.set(root ? P.critical : '#5A636E'); }
  for (const [id, n] of netNodes) { const st = state.obj.get(id); n.mat.color.set(st === 'root' ? '#5A2A26' : st === 'major' ? '#5A4A2A' : id.startsWith('ext-') ? '#2F363F' : '#3B434E'); }
  if (!svcPads.size) buildServices();
  rebuildFaint(); refreshHighlight();
}
function applyGlobalVisuals() {
  // redondance : double trait (tenue), tireté (mince), simple (perdue)
  for (const c of clusterObjs) { const r = gl(glob.redondance, c.id)?.niveau || 'tenue'; c.outline.set(r, state.obj.get(c.id) === 'major' ? P.major : '#8A94A0'); }
  const tr = gl(glob.redondance, 'transit')?.niveau || 'tenue';
  const trHot = state.events.some((e) => e.id === 'transit');
  for (const t of tracks) drawTrack(t, t.id === 'transit' ? tr : 'tenue', t.id === 'transit' && trHot ? P.major : '#4A535E');
  upsPlinth.set(gl(glob.redondance, 'ups-par-2')?.niveau || 'tenue', '#8A94A0');
  const levels = glob.redondance.map((r) => r.niveau);
  const worst = levels.includes('perdue') ? 'perdue' : levels.includes('mince') ? 'mince' : 'tenue';
  plinth.set(worst, '#8A94A0'); // la forme dit la redondance ; la teinte reste à l'objet en alarme
  // marge consommée : luminance en deux paliers de bleu
  for (const [id, dm] of deviceMeshes) { const m = gl(glob.marge, id); if (m && state.obj.get(id) !== 'root') { dm.material.emissive.set(LUMINANCE[m.niveau]); dm.material.emissiveIntensity = m.niveau === 2 ? 0.55 : 0.35; } }
  for (const [rid] of racks) {
    const m = gl(glob.marge, rid); let top = margeRackTops.get(rid);
    if (!m) { if (top) top.visible = false; continue; }
    if (!top) { const c = rackWorldPos(rid); top = new THREE.Mesh(new THREE.PlaneGeometry(RACK.w - 0.04, RACK.d - 0.04), new THREE.MeshBasicMaterial({ color: LUMINANCE[m.niveau], transparent: true, opacity: 0.85 })); top.rotation.x = -Math.PI / 2; top.position.set(c.x, RACK.h + 0.006, c.z); globalGroup.add(top); margeRackTops.set(rid, top); }
    top.material.color.set(LUMINANCE[m.niveau]); top.visible = true;
  }
  for (const [id, t] of hostTiles) { const m = gl(glob.marge, id); if (m && state.obj.get(id) !== 'root') t.mat.color.set(m.niveau === 2 ? '#4F7FAE' : '#2F4E6E'); }
  for (const [id, n] of netNodes) { const m = gl(glob.marge, id); if (m && !state.obj.has(id)) n.mat.color.set(LUMINANCE[m.niveau]); }
  // inconnu : hachure sur l'équipement dont les mesures ne viennent plus
  for (const [id, ov] of hatchOverlays) if (!glob.perimes.includes(id)) { ov.visible = false; }
  for (const id of glob.perimes) {
    const dm = deviceMeshes.get(id); if (!dm) continue;
    let ov = hatchOverlays.get(id);
    if (!ov) { const b = new THREE.Box3().setFromObject(dm.mesh); const s = new THREE.Vector3(); b.getSize(s); ov = new THREE.Mesh(new THREE.BoxGeometry(s.x + 0.01, s.y + 0.004, s.z + 0.01), hatchMat.clone()); b.getCenter(ov.position); globalGroup.add(ov); hatchOverlays.set(id, ov); }
    ov.visible = true;
  }
  // interventions : clé (maintenance déclarée) et échafaudage (changement en cours, avancement par instance)
  const maint = state.events.find((e) => e.prio === 0);
  maintenanceKey.visible = !!maint;
  if (maint) { const c = rackWorldPos(deviceMeshes.get(maint.obj).rack); maintenanceKey.position.set(c.x, RACK.h + 0.32, c.z); }
  const chg = glob.changements.find((c) => c.id.startsWith('svc:') && c.avancement != null);
  if (chg) buildScaffold(chg.id, chg.avancement); else scaffold.clear();
  // trafic sorti de son régime : défilement 0,5 Hz, 10 min au plus, jamais pendant une tempête ni au mur
  const hr = glob.horsRegime.filter((h) => currentT() - (h.debut ?? currentT()) < 600);
  for (const t of tracks) setScroll(t.id, !S.storm && !S.mur && hr.some((h) => `bundle:${h.id}` === t.id));
  for (const id of svcPads.keys()) drawPad(id);
}

// ============================================================ clavier
let searchHits = [];
const searchBoxes = new THREE.Group(); scene.add(searchBoxes);
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); startSearch(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (S.ackOpen) {
    if (e.key === 'Escape') { S.ackOpen = null; S.comment = ''; drawSelCard(); return; }
    if (e.key === 'Enter') { e.preventDefault(); acknowledge(S.ackOpen); return; }
    if (e.key === 'Backspace') { S.comment = S.comment.slice(0, -1); drawSelCard(); return; }
    if (/^[1-4]$/.test(e.key) && !S.comment) { S.comment = ACK_TEMPLATES[Number(e.key) - 1]; drawSelCard(); return; }
    if (e.key.length === 1) { S.comment += e.key; drawSelCard(); e.preventDefault(); }
    return;
  }
  if (S.search != null) {
    if (e.key === 'Escape') { S.search = null; refreshSearch(); drawLegend(); return; }
    if (e.key === 'Enter') { e.preventDefault(); const first = searchHits[0]; S.search = null; refreshSearch(); drawLegend(); if (first) select(first, { frame: true }); return; }
    if (e.key === 'Backspace') { S.search = S.search.slice(0, -1); refreshSearch(); drawLegend(); return; }
    if (e.key.length === 1) { S.search += e.key; refreshSearch(); drawLegend(); e.preventDefault(); }
    return;
  }
  const k = e.key; const kl = k.toLowerCase();
  if (S.mur && !['m', 'escape'].includes(kl)) return;
  if (k === '/') { e.preventDefault(); startSearch(); return; }
  if (k === 'Tab') { e.preventDefault(); touched(); const n = boardRows.length; if (!n) return; S.boardFocus = (S.boardFocus + (e.shiftKey ? -1 : 1) + n) % n; focusEvent(boardRows[S.boardFocus].ev.id, { fromUser: true }); return; }
  if (k === 'Enter') {
    if (S.pendingFrame) { const r = state.roots.find((x) => x.id === S.pendingFrame); if (r) frameIncident(r); drawLegend(); return; }
    if (S.boardFocus >= 0) { const ev = boardRows[S.boardFocus]?.ev; if (ev) select(ev.obj); return; }
    const r = state.roots.find((x) => x.id === S.focusEvent) || alarmList()[0]; if (r) frameIncident(r); return;
  }
  if (k === 'Escape') {
    if (S.mur) { toggleMur(); return; }
    if (S.help) { S.help = false; drawLegend(); return; }
    if (S.sel) { select(null); return; }
    if (S.focusEvent || S.stratum || S.boardFocus >= 0) { S.focusEvent = null; S.stratum = null; S.boardFocus = -1; applyFocus(); refreshHighlight(); updateAlarmCards(); drawBoard(); home(); }
    return;
  }
  if (kl === 'a') { const r = S.sel ? rootEventFor(S.sel) : (state.roots.find((x) => x.id === S.focusEvent) || state.roots.find((x) => x.prio === 1 && !x.ackNow)); if (r && !r.ackNow && !S.replay && !S.frozen) { if (S.sel !== r.obj) select(r.obj); S.ackOpen = r.id; S.comment = ''; drawSelCard(); } return; }
  if (k >= '1' && k <= '4') { touched(); isolate(STRATA[Number(k) - 1].id); return; }
  if (k === '0') { isolate('tout'); return; }
  if (kl === 'e') { S.explodeTarget = S.explodeTarget > 0.5 ? 0 : 1; invalidate(); return; }
  if (kl === 'h') { S.focusEvent = null; S.stratum = null; applyFocus(); refreshHighlight(); home(); return; }
  if (kl === 'r') { replayIncident(); return; }
  if (kl === 'l') { stopReplay(); return; }
  if (kl === 'g') { toggleFreeze(); return; }
  if (kl === 'm') { toggleMur(); return; }
  if (kl === 't') { toggleStorm(); return; }
  if (k === ' ' && S.replay) { e.preventDefault(); S.replay.playing = !S.replay.playing; return; }
  if ((k === 'ArrowLeft' || k === 'ArrowRight') && S.replay) { S.replay.t = Math.min(nowT(), Math.max(nowT() - RULE.span, S.replay.t + (k === 'ArrowLeft' ? -60 : 60))); update(true); return; }
  if (k === '?') { S.help = !S.help; drawLegend(); }
});
function startSearch() { S.search = ''; S.help = false; drawLegend(); announce('Recherche : tapez un nom, une adresse IP ou une application.'); }
function refreshSearch() {
  searchBoxes.clear();
  searchHits = S.search ? searchObjects(S.search).map((x) => x.id).filter((id) => deviceMeshes.has(id) || vmTiles.has(id) || svcPads.has(id)) : [];
  for (const id of searchHits.slice(0, 12)) { const o = deviceMeshes.get(id)?.mesh || vmTiles.get(id)?.mesh || svcPads.get(id)?.mesh; if (o) { const e = edges(new THREE.BoxGeometry(1, 1, 1), P.ivory, 0.9); placeBox(e, new THREE.Box3().setFromObject(o), 0.03); searchBoxes.add(e); } }
  invalidate();
}

// ============================================================ relecture, gel des données, mur
function scrub(pt) { const age = ruleAge(pt.x); if (age < 2) { stopReplay(); return; } if (!S.replay) S.replay = { t: nowT() - age, playing: false, speed: 10 }; S.replay.t = nowT() - age; S.replay.playing = false; update(true); }
function replayIncident() {
  S.acks = {}; S.seenP1 = new Set(); S.focusEvent = null; S.storm = null; select(null);
  for (const id of drawers.keys()) setDrawer(id, false);
  S.explodeTarget = 0; S.replay = { t: T0 - 110, playing: true, speed: 10 };
  lastInteraction = -Infinity; home(); update(true);
  announce('Relecture de l’incident, dix fois plus vite.');
}
function stopReplay() { if (!S.replay) return; S.replay = null; update(true); announce('Retour au direct.'); }
// une scène figée et calme est le pire mensonge : toute la salle se hachure, l'horloge s'arrête en ambre
const veils = [];
{
  // hachure fine à 45°, fond transparent, répétée tous les 0,3 m : la salle reste lisible sous le voile
  const veilTex = K.canvasTex('veil', 64, 64, (g) => {
    g.clearRect(0, 0, 64, 64); g.strokeStyle = 'rgba(138,148,160,0.55)'; g.lineWidth = 2;
    for (let i = -64; i < 128; i += 16) { g.beginPath(); g.moveTo(i, 64); g.lineTo(i + 64, 0); g.stroke(); }
  }, { repeat: true });
  const veil = (w, d) => { const t = veilTex.clone(); t.needsUpdate = true; t.repeat.set(w / 0.3, d / 0.3); return new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false })); };
  const v0 = veil(9.6, 9.2);
  v0.rotation.x = -Math.PI / 2; v0.position.set(2.5, 2.1, -1.7); v0.visible = false; scene.add(v0); veils.push(v0);
  for (const s of STRATA.slice(1)) { const v = veil(FOOT.x1 - FOOT.x0, FOOT.z1 - FOOT.z0); v.rotation.x = -Math.PI / 2; v.position.set(FOOT_C.x, 0.02, FOOT_C.z); v.visible = false; layers[s.id].group.add(v); veils.push(v); }
}
function toggleFreeze() {
  S.frozen = S.frozen ? null : { t: currentT(), since: nowT() };
  for (const v of veils) v.visible = !!S.frozen;
  announce(S.frozen ? 'Données figées : plus aucune mesure ne parvient, la scène n’est plus fiable.' : 'Flux de données rétabli.');
  update(true);
}
function toggleMur() {
  S.mur = !S.mur; select(null); S.stratum = null; applyFocus();
  if (S.mur) { S.explodeTarget = 0.85; anim = null; canvas.style.cursor = 'default'; }
  home(0); update(true);
  announce(S.mur ? 'Mode mur : caméra fixe, aucune animation.' : 'Mode poste.');
}

// ============================================================ rendu à la demande
let dirty = true; let blinkOn = true; let frames = 0;
function invalidate() { dirty = true; }
function tick(now) {
  let animating = false;
  if (anim) {
    const k = anim.ms ? Math.min(1, (now - anim.t0) / anim.ms) : 1; const e = 1 - Math.pow(1 - k, 3);
    view.target.lerpVectors(anim.from.target, anim.to.target, e);
    view.theta = anim.from.theta + (anim.to.theta - anim.from.theta) * e; view.phi = anim.from.phi + (anim.to.phi - anim.from.phi) * e; view.zoom = anim.from.zoom + (anim.to.zoom - anim.from.zoom) * e;
    if (k >= 1) anim = null; animating = true;
  }
  if (Math.abs(S.explode - S.explodeTarget) > 0.001) {
    const step = reduceMotion || S.mur ? 1 : Math.min(1, (now - (tick.last || now)) / CH.stratesMs * 2.2);
    S.explode += (S.explodeTarget - S.explode) * step; if (Math.abs(S.explode - S.explodeTarget) < 0.003) S.explode = S.explodeTarget;
    for (const s of STRATA.slice(1)) layers[s.id].group.position.y = strataY(s.id);
    rebuildFaint(); refreshHighlight(); animating = true;
  }
  for (const [id, d] of drawers) {
    if (Math.abs(d.cur - d.target) > 0.001) {
      const step = reduceMotion ? 1 : Math.min(1, (now - (tick.last || now)) / CH.tiroirMs * 2.2);
      d.cur += (d.target - d.cur) * step; if (Math.abs(d.cur - d.target) < 0.003) d.cur = d.target;
      deviceMeshes.get(id).mesh.position.z = d.base - 0.36 * d.cur; animating = true; refreshHighlight();
    }
  }
  for (let i = pulses.length - 1; i >= 0; i--) {
    const p = pulses[i]; const k = (now - p.t0) / p.dur;
    if (k >= 1) { scene.remove(p.m); p.m.material.dispose(); pulses.splice(i, 1); continue; }
    const r = 0.2 + p.maxR * k; p.m.scale.set(r, r, r); p.m.material.opacity = 0.8 * (1 - k); animating = true;
  }
  if (S.replay?.playing) {
    const dt = (now - (tick.last || now)) / 1000 * S.replay.speed;
    S.replay.t = Math.min(nowT(), S.replay.t + dt);
    if (S.replay.t >= nowT() - 0.5) stopReplay(); else if (Math.floor(S.replay.t) !== Math.floor(S.replay.t - dt)) update();
    animating = true;
  }
  tick.last = now;
  if (dirty || animating) {
    dirty = false;
    applyCamera();
    boardMesh.quaternion.copy(camera.quaternion); // le totem fait face à l'opérateur
    const pxPerWorld = (canvas.clientHeight || 1) / (2 * view.base / view.zoom);
    layoutCards(pxPerWorld, new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1));
    renderer.render(scene, camera);
    frames++;
  }
  requestAnimationFrame(tick);
}
function resize() { renderer.setSize(canvas.clientWidth, canvas.clientHeight, false); invalidate(); }
new ResizeObserver(resize).observe(canvas);

// deux rythmes seulement : clignotement 1 Hz (cause P1 non prise en charge) et défilement 0,5 Hz (trafic hors régime)
// phase calée sur l'horloge murale : deux postes et le mur clignotent ensemble
(function blinkTick() {
  const any = state.roots.some((r) => r.prio === 1 && !r.ackNow) && !S.replay && !S.storm && !reduceMotion;
  blinkOn = any ? Math.floor(Date.now() / 500) % 2 === 0 : true;
  if (any) { drawBoard(); updateAlarmCards(); }
  setTimeout(blinkTick, 500 - (Date.now() % 500) + 4);
})();
setInterval(() => { if (!scrolls.size || reduceMotion) return; for (const m of scrolls.values()) m.material.map.offset.x -= 0.5 / 12; invalidate(); }, 1000 / 12);
setInterval(() => { if (S.replay?.playing) return; if (!S.frozen) dataAge = dataAge >= 9 ? 1 : dataAge + 1; update(); }, 1000);

// ============================================================ démarrage
resize();
layoutVms();
buildServices();
applyStateVisuals();
applyGlobalVisuals();
update(true);
S.seenP1 = new Set();
home(0);
applyCamera();
requestAnimationFrame(tick);
// la panne en cours est présentée à l'ouverture : la scène se meut vers elle sans perdre la salle
setTimeout(() => checkNewIncidents(), 900);
window.__spatial = { S, get frames() { return frames; }, focusEvent, select, isolate, toggleStorm, toggleFreeze, toggleMur };
