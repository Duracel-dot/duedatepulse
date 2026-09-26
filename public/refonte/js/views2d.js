// Vues logiques 2D « au trait sur calque ». Chaque élément sélectionnable porte data-id :
// la sélection est partagée avec la vue physique, l'inspecteur et la console.
import { WORLD, P, T0, series, METRICS, PERIODS, metricsFor, fmtClock, fmtDay } from './data.js';

const SANS = "'IBM Plex Sans', 'Segoe UI', sans-serif";
const COND = "'IBM Plex Sans Condensed', 'Segoe UI', sans-serif";
const MONO = "'IBM Plex Mono', Consolas, monospace";
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const T = (x, y, txt, { size = 12, fill = P.inkLight, font = SANS, weight = 400, anchor = 'start', ls = 0, extra = '' } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-family="${font}" font-weight="${weight}" text-anchor="${anchor}" letter-spacing="${ls}" ${extra}>${esc(txt)}</text>`;

export function glyph(kind, x, y, size = 7, { ack = false } = {}) {
  if (kind === 'critical' || kind === 1) return ack ? `<path d="M${x} ${y - size} L${x + size} ${y} L${x} ${y + size} L${x - size} ${y} Z" fill="none" stroke="${P.critical}" stroke-width="1.6"/>` : `<path d="M${x} ${y - size} L${x + size} ${y} L${x} ${y + size} L${x - size} ${y} Z" fill="${P.critical}"/>`;
  if (kind === 'major' || kind === 2) return ack ? `<path d="M${x} ${y - size} L${x + size} ${y + size * 0.8} L${x - size} ${y + size * 0.8} Z" fill="none" stroke="${P.major}" stroke-width="1.6"/>` : `<path d="M${x} ${y - size} L${x + size} ${y + size * 0.8} L${x - size} ${y + size * 0.8} Z" fill="${P.major}"/>`;
  if (kind === 'minor' || kind === 3) return `<circle cx="${x}" cy="${y}" r="${size * 0.75}" fill="none" stroke="${P.minor}" stroke-width="1.8"/>`;
  return '';
}
const hatchDef = (id) => `<pattern id="${id}" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><rect width="6" height="6" fill="${P.surface}"/><line x1="0" y1="0" x2="0" y2="6" stroke="${P.disabled}" stroke-width="1.3"/></pattern>`;
const dots = (id, w, h) => `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.7" fill="${P.hairline}"/></pattern><rect width="${w}" height="${h}" fill="url(#${id})"/>`;
function cartouche(x, y, title, lines) {
  let s = `<g transform="translate(${x},${y})">${T(0, 0, title, { size: 12, font: COND, weight: 600, ls: 1.4 })}`;
  lines.forEach((l, i) => { s += T(0, 18 + i * 15, l, { size: 10.5, font: MONO, fill: P.ink }); });
  return `${s}</g>`;
}
const selRect = (x, y, w, h) => `<rect x="${x - 4}" y="${y - 4}" width="${w + 8}" height="${h + 8}" fill="none" stroke="${P.ivory}" stroke-width="2.2" pointer-events="none"/>`;

// ============================================================ services et impacts
const COLS = [{ x: 36, title: 'USAGERS' }, { x: 214, title: 'FRONTAUX' }, { x: 392, title: 'APPLICATIONS' }, { x: 570, title: 'DONNÉES' }, { x: 748, title: 'SOCLE' }];
const NW = 156; const NH = 50;
const SVC_NODES = [
  { id: 'usr:internet', c: 0, y: 150, name: 'Internet', sub: 'clients publics' },
  { id: 'usr:agences', c: 0, y: 250, name: 'Agences (3)', sub: 'MPLS · 1 000 postes' },
  { id: 'usr:vpn', c: 0, y: 350, name: 'Nomades VPN', sub: '240 sessions' },
  { id: 'usr:siege', c: 0, y: 450, name: 'Postes siège', sub: '1 800 postes' },
  { id: 'lb-par-1', c: 1, y: 150, name: 'VIP portail', sub: 'lb-par-1/2 · A/P' },
  { id: 'fe:rdsgw', c: 1, y: 290, name: 'Passerelles RDS', sub: '2/2' },
  { id: 'fe:proxy', c: 1, y: 420, name: 'Proxy web', sub: '2/2' },
  { id: 'svc:portail', c: 2, y: 120, name: 'Portail clients', sub: '10/10 VM', subInc: '9/10 VM · N+1 tenu', subHA: '10/10 VM · sans réserve' },
  { id: 'svc:k8s', c: 2, y: 215, name: 'Kubernetes', sub: '12/12 VM', subInc: '11/12 VM · N+1 tenu', subHA: '12/12 VM · sans réserve' },
  { id: 'svc:rds', c: 2, y: 310, name: 'Bureaux à distance', sub: '10/10 VM', subInc: '9/10 VM · N+1 tenu', subHA: '10/10 VM · sans réserve' },
  { id: 'svc:crm', c: 2, y: 405, name: 'CRM', sub: 'crm-db-01', subInc: 'dépend de crm-db-01' },
  { id: 'svc:erp', c: 2, y: 500, name: 'ERP', sub: '5/5 VM' },
  { id: 'svc:mail', c: 2, y: 595, name: 'Messagerie', sub: '2/2 VM' },
  { id: 'svc:sql', c: 3, y: 150, name: 'SQL Always On', sub: 'sql-par-01/02' },
  { id: 'svc:redis', c: 3, y: 245, name: 'Cache Redis', sub: '2/2' },
  { id: 'crm-db-01', c: 3, y: 405, name: 'crm-db-01', sub: 'PostgreSQL · unique' },
  { id: 'erp-db-01', c: 3, y: 500, name: 'erp-db-01', sub: 'SQL Server' },
  { id: 'svc:dfs', c: 3, y: 595, name: 'Fichiers DFS', sub: '2/2' },
  { id: 'svc:ad', c: 4, y: 150, name: 'Annuaire AD/DNS', sub: 'dc-par-01/02' },
  { id: 'svc:pki', c: 4, y: 245, name: 'PKI', sub: 'pki-01 · unique' },
  { id: 'CL-PROD-PAR', c: 4, y: 360, name: 'CL-PROD-PAR', sub: '10/10 hôtes', subInc: '9/10 · N+1 consommé' },
  { id: 'esx-par-08', c: 4, y: 455, name: 'esx-par-08', sub: 'membre de CL-PROD-PAR' },
  { id: 'stor-par-1', c: 4, y: 560, name: 'stor-par-1', sub: 'NFS · 81 % utilisé' },
  { id: 'HVCL-PAR', c: 4, y: 655, name: 'HVCL-PAR', sub: '4/4 hôtes' },
];
const SVC_EDGES = [
  ['usr:internet', 'lb-par-1'], ['usr:agences', 'fe:rdsgw'], ['usr:vpn', 'fe:rdsgw'], ['usr:siege', 'svc:crm'], ['usr:siege', 'svc:erp'], ['usr:siege', 'svc:mail'], ['usr:agences', 'svc:erp'], ['usr:siege', 'fe:proxy'],
  ['lb-par-1', 'svc:portail'], ['lb-par-1', 'svc:k8s'], ['fe:rdsgw', 'svc:rds'],
  ['svc:portail', 'svc:sql'], ['svc:portail', 'svc:redis'], ['svc:k8s', 'svc:redis'], ['svc:crm', 'crm-db-01', 'imp'], ['svc:erp', 'erp-db-01'], ['svc:rds', 'svc:dfs'],
  ['svc:sql', 'svc:ad'], ['crm-db-01', 'CL-PROD-PAR', 'imp'], ['erp-db-01', 'CL-PROD-PAR'], ['svc:dfs', 'HVCL-PAR'],
];
export const SERVICE_GRAPH = { nodes: SVC_NODES, edges: SVC_EDGES };

export function relatedServices(id) {
  const out = new Set([id]);
  const walk = (cur, dir) => {
    for (const [a, b] of SVC_EDGES) {
      const next = dir > 0 ? (a === cur ? b : null) : (b === cur ? a : null);
      if (next && !out.has(next)) { out.add(next); walk(next, dir); }
    }
  };
  walk(id, 1); walk(id, -1);
  if (out.has('CL-PROD-PAR') || id === 'esx-par-08') { out.add('CL-PROD-PAR'); out.add('esx-par-08'); }
  return out;
}

function svcState(state, id) {
  const st = state.obj.get(id);
  if (st) return st;
  return null;
}

export function renderServices(state, sel) {
  const W = 940; const H = 864;
  let s = `<svg viewBox="0 0 ${W} ${H}" class="v-svg" role="img" aria-label="Graphe des services et de leurs dépendances"><defs>${hatchDef('h-svc')}</defs>${dots('d-svc', W, H)}`;
  for (const c of COLS) {
    s += T(c.x, 66, c.title, { size: 11, font: COND, weight: 600, ls: 1.6, fill: P.ink });
    s += `<line x1="${c.x}" y1="76" x2="${c.x + NW}" y2="76" stroke="${P.hairline}"/>`;
  }
  const pos = new Map(SVC_NODES.map((n) => [n.id, { x: COLS[n.c].x, y: n.y }]));
  const incident = state.incident && state.t >= T0 + 12;
  for (const [a, b, kind] of SVC_EDGES) {
    const A = pos.get(a); const B = pos.get(b);
    const x1 = A.x + NW; const y1 = A.y + NH / 2; const x2 = B.x; const y2 = B.y + NH / 2; const mx = (x1 + x2) / 2;
    const imp = kind === 'imp' && incident;
    const col = imp ? P.critical : '#3B434E';
    s += `<g class="edge" data-a="${a}" data-b="${b}"><path d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" fill="none" stroke="${col}" stroke-width="${imp ? 1.8 : 1.2}"/><path d="M${x2 - 6} ${y2 - 3.5} L${x2} ${y2} L${x2 - 6} ${y2 + 3.5}" fill="none" stroke="${col}" stroke-width="1.2"/></g>`;
  }
  // appartenance esx-par-08 -> CL-PROD-PAR
  const root = state.obj.get('esx-par-08') === 'root';
  { const x = COLS[4].x + NW / 2; s += `<line x1="${x}" y1="455" x2="${x}" y2="${360 + NH}" stroke="${root ? P.critical : '#3B434E'}" stroke-width="${root ? 1.8 : 1.2}"/>`; }
  for (const n of SVC_NODES) {
    const { x, y } = pos.get(n.id);
    const st = svcState(state, n.id);
    const kind = st === 'root' || st === 'down' || st === 'critical' ? 'critical' : st === 'major' ? 'major' : st === 'degraded' || st === 'minor' ? 'minor' : st === 'unreach' ? 'unreach' : null;
    const stroke = kind === 'critical' ? P.critical : kind === 'major' ? P.major : kind === 'minor' ? P.minor : kind === 'unreach' ? P.disabled : '#3B434E';
    const fill = kind === 'unreach' ? 'url(#h-svc)' : st === 'root' ? 'rgba(255,90,71,0.14)' : P.surface;
    let sub = n.sub;
    if (incident && n.subInc) sub = state.afterHA && n.subHA ? n.subHA : n.subInc;
    if (n.id === 'esx-par-08' && root) sub = `injoignable · ${fmtAgeShort(state.t - T0)}`;
    s += `<g class="node" data-id="${n.id}" tabindex="0" role="button" aria-label="${esc(n.name)}">`;
    s += `<rect x="${x}" y="${y}" width="${NW}" height="${NH}" fill="${P.surface}"/><rect x="${x}" y="${y}" width="${NW}" height="${NH}" fill="${fill}" stroke="${stroke}" stroke-width="${kind ? 1.4 : 1}" ${kind === 'unreach' ? 'stroke-dasharray="4 3"' : ''}/>`;
    if (kind && kind !== 'unreach') s += `<rect x="${x}" y="${y}" width="4" height="${NH}" fill="${stroke}"/>`;
    s += T(x + 14, y + 21, n.name, { size: 13, weight: 500, font: n.name.includes('-') ? MONO : SANS });
    s += T(x + 14, y + 38, sub, { size: 10, font: MONO, fill: kind === 'unreach' ? P.inkLight : P.ink });
    if (kind && kind !== 'unreach') s += glyph(kind, x + NW - 14, y + 17, 6);
    if (sel === n.id) s += selRect(x, y, NW, NH);
    s += '</g>';
  }
  const title = incident ? 'MODE IMPACT · esx-par-08' : 'MODE IMPACT · aucun incident en cours';
  const l1 = incident ? '2 services interrompus · 3 dégradés' : 'tous les services nominaux';
  s += cartouche(36, 760, title, [l1, 'règles de redondance · dépendances + flux observés']);
  s += `<g transform="translate(560,752)">${glyph('critical', 6, 6, 6)}${T(20, 10, 'interrompu', { size: 11 })}${glyph('major', 126, 6, 6)}${T(140, 10, 'majeur', { size: 11 })}${glyph('minor', 222, 6, 6)}${T(236, 10, 'dégradé', { size: 11 })}`
    + `<rect x="0" y="24" width="14" height="12" fill="url(#h-svc)" stroke="${P.disabled}" stroke-dasharray="3 2"/>${T(20, 34, 'injoignable (conséquence)', { size: 11 })}</g>`;
  return `${s}</svg>`;
}
function fmtAgeShort(s) { s = Math.max(0, Math.round(s)); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }

// ============================================================ réseau L2 en plan de métro
const VLANS = [
  { id: 20, name: 'VLAN 20 · infra', color: '#86B59A' }, { id: 30, name: 'VLAN 30 · DMZ web', color: '#6E9CC0' },
  { id: 40, name: 'VLAN 40 · applis', color: '#8E97CF' }, { id: 50, name: 'VLAN 50 · données', color: '#A9BCD0' }, { id: 80, name: 'VLAN 80 · sauvegarde', color: '#5FAFA8' },
];
const TOR_VLANS = { A03: [30, 40, 20], A04: [30, 40, 50], A05: [40, 50, 20], A06: [30, 40, 50, 20], A07: [40, 20], A08: [80, 20], B01: [20, 40], B02: [40, 50, 80], B03: [50, 20], B05: [20] };

export function renderMetro(state, sel) {
  const W = 1556; const H = 864; const cx = W / 2;
  let s = `<svg viewBox="0 0 ${W} ${H}" class="v-svg" role="img" aria-label="Réseau L2 en plan de métro">${dots('d-met', W, H)}`;
  const station = (id, x, y, name, sub, { w = 150, st = null } = {}) => {
    const stroke = st === 'critical' ? P.critical : st === 'major' ? P.major : '#4A535E';
    let o = `<g class="node" data-id="${id}" tabindex="0" role="button" aria-label="${esc(name)}"><rect x="${x - w / 2}" y="${y - 18}" width="${w}" height="36" rx="18" fill="${P.surface}" stroke="${stroke}" stroke-width="${st ? 1.8 : 1.4}"/>`;
    o += T(x, y - 1, name, { size: 12.5, anchor: 'middle', font: MONO, weight: 500 });
    if (sub) o += T(x, y + 12, sub, { size: 9.5, anchor: 'middle', font: MONO, fill: st === 'critical' ? P.inkLight : P.ink });
    if (st) o += glyph(st, x + w / 2 - 16, y - 1, 5.5);
    if (sel === id) o += `<rect x="${x - w / 2 - 4}" y="${y - 22}" width="${w + 8}" height="44" rx="22" fill="none" stroke="${P.ivory}" stroke-width="2.2"/>`;
    return `${o}</g>`;
  };
  const track = (x1, y1, x2, y2, width, { color = '#4A535E', mid = null } = {}) => {
    if (x1 === x2 || y1 === y2) return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
    const my = mid ?? (y1 + y2) / 2; const sx = Math.sign(x2 - x1);
    return `<path d="M${x1} ${y1} L${x1} ${my - 10} Q${x1} ${my} ${x1 + sx * 10} ${my} L${x2 - sx * 10} ${my} Q${x2} ${my} ${x2} ${my + 10} L${x2} ${y2}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
  };
  const yW = 90; const yR = 190; const yF = 290; const yC = 390; const yBus = 470; const yT = 600; const yS = 740;
  const transit = state.events.some((e) => e.id === 'transit');
  s += track(cx + 330, yW, cx + 110, yR, 3, { mid: 150 }) + track(cx + 330, yW, cx - 110, yR, 3, { mid: 150 });
  s += track(cx - 330, yW, cx + 110, yR, 5, { mid: 128 }) + track(cx - 330, yW, cx - 110, yR, 5, { mid: 128, color: transit ? P.major : '#4A535E' });
  for (const rx of [cx - 110, cx + 110]) for (const fx of [cx - 110, cx + 110]) s += track(rx, yR, fx, yF, 4);
  for (const fx of [cx - 110, cx + 110]) for (const c of [cx - 110, cx + 110]) s += track(fx, yF, c, yC, 6);
  s += track(cx - 110, yC, cx + 110, yC, 9);
  s += T(cx, yC + 30, 'vPC peer-link 2×100G', { size: 10, anchor: 'middle', font: MONO, fill: P.ink });
  s += track(cx + 110, yC, W - 150, yC, 8);
  s += `<path d="M${W - 150} ${yC - 14} L${W - 130} ${yC} L${W - 150} ${yC + 14}" fill="none" stroke="${P.ink}" stroke-width="2"/>`;
  s += T(W - 120, yC - 4, 'DWDM → Lyon DC2', { size: 12, font: COND, weight: 600 });
  s += T(W - 120, yC + 12, '2×100G · p95 12 %', { size: 10, font: MONO, fill: P.ink });
  const tors = Object.keys(TOR_VLANS);
  const x0 = 150; const x1 = W - 150; const tx = (i) => x0 + i * ((x1 - x0) / (tors.length - 1));
  s += track(cx - 110, yC, cx - 110, yBus, 10) + track(cx + 110, yC, cx + 110, yBus, 10);
  VLANS.forEach((v, k) => { s += `<line x1="${x0}" y1="${yBus + k * 7}" x2="${x1}" y2="${yBus + k * 7}" stroke="${v.color}" stroke-width="3.2" stroke-linecap="round"/>`; });
  const linkDown = state.links.size > 0;
  const rackDevices = new Map();
  for (const row of WORLD.room.rows) for (const r of row.racks) rackDevices.set(r.id, r.devices);
  tors.forEach((t, i) => {
    const x = tx(i);
    const vs = VLANS.filter((v) => TOR_VLANS[t].includes(v.id));
    vs.forEach((v, k) => { const off = (k - (vs.length - 1) / 2) * 6; s += `<line x1="${x + off}" y1="${yBus + VLANS.indexOf(v) * 7}" x2="${x + off}" y2="${yT - 18}" stroke="${v.color}" stroke-width="3.2" stroke-linecap="round"/>`; });
    const torId = `tor-${t.toLowerCase()}-1`;
    const down = t === 'A06' && linkDown;
    s += station(torId, x, yT, `tor-${t.toLowerCase()}`, down ? 'Eth1/2 down (×2)' : '2×100G amont', { w: 128, st: down ? 'critical' : null });
    const servers = (rackDevices.get(t) || []).filter((d) => d.type !== 'switch' && d.type !== 'ups');
    servers.forEach((sv, k) => {
      const sx = x + (k - (servers.length - 1) / 2) * 60;
      const st = state.obj.get(sv.id);
      const bad = st === 'root';
      const col = bad ? P.critical : st === 'major' ? P.major : st === 'maint' ? P.disabled : P.ink;
      s += `<g class="node" data-id="${sv.id}" tabindex="0" role="button" aria-label="${esc(sv.id)}"><line x1="${x}" y1="${yT + 18}" x2="${sx}" y2="${yS - 12}" stroke="${bad ? P.critical : '#4A535E'}" stroke-width="2" ${bad ? 'stroke-dasharray="4 4"' : ''}/>`;
      s += `<rect x="${sx - 7}" y="${yS - 14}" width="14" height="14" fill="${col}"/>`;
      if (sel === sv.id) s += `<rect x="${sx - 11}" y="${yS - 18}" width="22" height="22" fill="none" stroke="${P.ivory}" stroke-width="2"/>`;
      s += T(sx, yS + 14, sv.id, { size: 9.5, anchor: 'middle', font: MONO, fill: bad ? P.critical : P.ink, extra: `transform="rotate(35 ${sx} ${yS + 14})"` });
      s += '</g>';
    });
  });
  s += station('ext-internet', cx - 330, yW, 'Internet', 'transit 2×10G', { w: 130 }) + station('ext-mpls', cx + 330, yW, 'WAN MPLS', 'agences · 1G', { w: 130 });
  s += station('rtr-par-1', cx - 110, yR, 'rtr-par-1', 'ASR 1001-HX', { st: transit ? 'major' : null }) + station('rtr-par-2', cx + 110, yR, 'rtr-par-2', 'ASR 1001-HX');
  s += station('fw-par-1', cx - 110, yF, 'fw-par-1', 'actif · 38 % CPU') + station('fw-par-2', cx + 110, yF, 'fw-par-2', 'passif');
  s += station('core-par-1', cx - 110, yC, 'core-par-1', 'Nexus 9336C') + station('core-par-2', cx + 110, yC, 'core-par-2', 'Nexus 9336C');
  if (transit) s += `<g transform="translate(${cx - 316},154)">${glyph('major', 0, 0, 6)}${T(12, 4, 'transit 1 · p95 81 %', { size: 10.5, font: MONO, fill: P.major })}</g>`;
  s += `<g transform="translate(40,${H - 70})">${VLANS.map((v, k) => `<line x1="${k * 170}" y1="0" x2="${k * 170 + 28}" y2="0" stroke="${v.color}" stroke-width="3.2" stroke-linecap="round"/>${T(k * 170 + 36, 4, v.name, { size: 11 })}`).join('')}</g>`;
  s += T(40, H - 36, 'Épaisseur = débit nominal · couleur d’état seulement hors seuil (p95) · placement orthogonal automatique', { size: 10.5, font: MONO, fill: P.ink });
  s += cartouche(40, 220, 'RÉSEAU L2 · PARIS DC1', ['source : LLDP (snmp-reseau) · 18 équipements · 42 liens', 'période : 24 h · agrégat p95']);
  return `${s}</svg>`;
}

// ============================================================ virtualisation : treemap mémoire et réserve N+1
function squarify(items, x, y, w, h) {
  const out = [];
  const total = items.reduce((a, b) => a + b.v, 0) || 1;
  const scale = (w * h) / total;
  let rest = items.map((i) => ({ ...i, a: i.v * scale })).sort((a, b) => b.a - a.a);
  let rx = x; let ry = y; let rw = w; let rh = h;
  while (rest.length) {
    const short = Math.min(rw, rh);
    let row = []; let best = Infinity;
    for (let k = 1; k <= rest.length; k++) {
      const r = rest.slice(0, k); const sum = r.reduce((a, b) => a + b.a, 0); const side = sum / short;
      const worst = Math.max(...r.map((it) => Math.max(side / (it.a / side), (it.a / side) / side)));
      if (worst <= best) { best = worst; row = r; } else break;
    }
    const sum = row.reduce((a, b) => a + b.a, 0); const side = sum / short;
    let off = 0;
    for (const it of row) {
      const len = it.a / side;
      if (rw >= rh) out.push({ ...it, x: rx, y: ry + off, w: side, h: len }); else out.push({ ...it, x: rx + off, y: ry, w: len, h: side });
      off += len;
    }
    if (rw >= rh) { rx += side; rw -= side; } else { ry += side; rh -= side; }
    rest = rest.slice(row.length);
  }
  return out;
}

export function renderTreemap(state, sel) {
  const W = 1556; const H = 864;
  let s = `<svg viewBox="0 0 ${W} ${H}" class="v-svg" role="img" aria-label="Capacité mémoire des clusters"><defs>${hatchDef('h-tm')}</defs>${dots('d-tm', W, H)}`;
  const clusters = ['CL-PROD-PAR', 'HVCL-PAR', 'CL-PRA-LYO', 'PVE-LYO'];
  const cap = (c) => WORLD.hosts.filter((h) => h.cluster === c).reduce((a, h) => a + h.memGB, 0);
  const boxes = squarify(clusters.map((c) => ({ id: c, v: cap(c) })), 40, 120, W - 80, H - 230);
  const ramp = P.metric;
  const rampAt = (t) => ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(t * (ramp.length - 1))))];
  for (const b of boxes) {
    const hosts = WORLD.hosts.filter((h) => h.cluster === b.id);
    const maxHost = Math.max(...hosts.map((h) => h.memGB));
    const target = { 'CL-PROD-PAR': 0.74, 'HVCL-PAR': 0.66, 'CL-PRA-LYO': 0.38, 'PVE-LYO': 0.58 }[b.id] || 0.6;
    const vmSum = WORLD.vms.filter((v) => v.cluster === b.id && v.powered).reduce((a, v) => a + v.memGB, 0) || 1;
    const k = (target * hosts.reduce((a, h) => a + h.memGB, 0)) / vmSum;
    const items = hosts.map((h) => ({ id: h.id, v: h.memGB, host: h }));
    items.push({ id: '__n1__', v: maxHost });
    const inner = squarify(items, b.x + 10, b.y + 38, b.w - 20, b.h - 48);
    const clSt = state.obj.get(b.id);
    const consumed = b.id === 'CL-PROD-PAR' && state.n1Consumed;
    s += `<g class="node" data-id="${b.id}"><rect x="${b.x + 3}" y="${b.y + 3}" width="${b.w - 6}" height="${b.h - 6}" fill="none" stroke="${clSt === 'major' ? P.major : '#4A535E'}" stroke-width="1.2"/>`;
    s += T(b.x + 12, b.y + 24, b.id, { size: 13, font: COND, weight: 600, ls: 1 });
    if (sel === b.id) s += selRect(b.x + 3, b.y + 3, b.w - 6, b.h - 6);
    s += '</g>';
    s += T(b.x + b.w - 12, b.y + 24, `${hosts.length} hôtes · ${cap(b.id)} Go`, { size: 10.5, anchor: 'end', font: MONO, fill: P.ink });
    if (consumed) s += `${glyph('major', b.x + 146, b.y + 19, 6)}${T(b.x + 158, b.y + 24, 'réserve N+1 consommée', { size: 11, fill: P.major })}`;
    for (const r of inner) {
      if (r.id === '__n1__') {
        s += `<rect x="${r.x + 2}" y="${r.y + 2}" width="${r.w - 4}" height="${r.h - 4}" fill="url(#h-tm)" stroke="${consumed ? P.major : '#5A636E'}" stroke-dasharray="4 3"/>`;
        s += T(r.x + 10, r.y + 20, 'réserve N+1', { size: 11, font: COND, weight: 600, fill: consumed ? P.major : P.ink });
        (consumed ? ['consommée · 9/10', 'une panne de plus', 'ne passe pas'] : [`${maxHost} Go`, 'à garder libres']).forEach((l, j) => { s += T(r.x + 10, r.y + 36 + j * 14, l, { size: 10, font: MONO, fill: consumed ? P.inkLight : P.ink }); });
        continue;
      }
      const h = r.host;
      const hst = state.obj.get(h.id);
      const down = hst === 'root';
      s += `<g class="node" data-id="${h.id}"><rect x="${r.x + 2}" y="${r.y + 2}" width="${r.w - 4}" height="${r.h - 4}" fill="${P.surface}" stroke="${down ? P.critical : '#3B434E'}" ${down ? 'stroke-dasharray="4 3" stroke-width="1.6"' : ''}/>`;
      s += T(r.x + 8, r.y + 16, h.id, { size: 10.5, font: MONO, weight: 500, fill: down ? P.critical : P.inkLight });
      if (down) s += glyph('critical', r.x + r.w - 14, r.y + 12, 5);
      if (sel === h.id) s += selRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
      s += '</g>';
      const vms = WORLD.vms.filter((v) => state.vmHost.get(v.name) === h.id && v.powered);
      const vitems = vms.map((v) => ({ id: v.name, v: v.memGB * k, vm: v }));
      const free = Math.max(0, h.memGB - vitems.reduce((a, x) => a + x.v, 0));
      if (free > 0) vitems.push({ id: '__free__', v: free });
      for (const v of squarify(vitems, r.x + 6, r.y + 22, Math.max(4, r.w - 12), Math.max(4, r.h - 28))) {
        if (v.id === '__free__') continue;
        const vst = state.obj.get(v.id);
        const unreach = vst === 'unreach';
        const moved = state.afterHA && ['app-portail-02', 'rds-sh-03', 'k8s-worker-04'].includes(v.id);
        const use = 0.35 + ((v.vm.memBase || 50) / 100) * 0.6;
        s += `<g class="node" data-id="${v.id}"><rect x="${v.x + 1}" y="${v.y + 1}" width="${Math.max(0, v.w - 2)}" height="${Math.max(0, v.h - 2)}" fill="${unreach ? 'url(#h-tm)' : rampAt(use)}" ${unreach ? `stroke="${P.disabled}" stroke-dasharray="2 2"` : moved ? `stroke="${P.ink}" stroke-width="1.4"` : ''}/>`;
        if (v.w > v.id.length * 5.8 + 10 && v.h > 16) s += T(v.x + 5, v.y + 13, v.id, { size: 9.5, font: MONO, fill: unreach ? P.inkLight : '#12161C' });
        if (sel === v.id) s += selRect(v.x + 1, v.y + 1, v.w - 2, v.h - 2);
        s += '</g>';
      }
    }
  }
  s += cartouche(40, 60, 'VIRTUALISATION · CAPACITÉ MÉMOIRE', ['surface = mémoire allouée · remplissage = mémoire active (p95 24 h)', 'réserve N+1 hachurée = capacité du plus gros hôte, à ne pas consommer']);
  if (state.afterHA) s += T(40, H - 62, 'contour clair : VM redémarrées par HA depuis esx-par-08', { size: 10.5, font: MONO, fill: P.ink });
  s += `<g transform="translate(${W - 360},${H - 58})">${T(0, -8, 'mémoire active', { size: 10.5, font: MONO, fill: P.ink })}${ramp.map((c, j) => `<rect x="${j * 56}" y="0" width="56" height="10" fill="${c}"/>`).join('')}${T(0, 26, '0 %', { size: 10, font: MONO, fill: P.ink })}${T(280, 26, '100 %', { size: 10, font: MONO, fill: P.ink, anchor: 'end' })}</g>`;
  return `${s}</svg>`;
}

// ============================================================ flux : matrice est-ouest et Sankey nord-sud
const APPS = ['Portail', 'Kubernetes', 'RDS', 'CRM', 'ERP', 'Messagerie', 'Fichiers', 'SQL AO', 'Annuaire', 'PKI', 'Sauvegarde', 'Stockage'];
const PAIRS = [[0, 7, 3], [0, 8, 1], [1, 3, 2], [1, 8, 1], [2, 6, 2], [2, 8, 1], [3, 8, 1], [4, 7, 3], [4, 8, 1], [5, 8, 2], [6, 11, 3], [7, 11, 3], [10, 11, 4], [0, 9, 1], [1, 9, 1], [7, 8, 1], [2, 3, 1], [4, 6, 1]];
const MBPS = ['', '≈ 5 Mb/s', '≈ 40 Mb/s', '≈ 300 Mb/s', '≈ 2 Gb/s'];

export function renderFlux(state, sel) {
  const W = 1556; const H = 864;
  let s = `<svg viewBox="0 0 ${W} ${H}" class="v-svg" role="img" aria-label="Flux applicatifs">${dots('d-fx', W, H)}`;
  const cell = 34; const mx = 150; const my = 170; const n = APPS.length;
  const crmCut = state.incident && state.t >= T0 + 12;
  s += cartouche(40, 60, 'FLUX EST-OUEST · MATRICE APPLICATIVE', ['débit moyen 1 h · échelle logarithmique', 'source : NetFlow v9 (pare-feu, cœurs) · 612 conversations']);
  const val = (i, j) => { for (const [a, b, v] of PAIRS) if ((a === i && b === j) || (a === j && b === i)) return v; return 0; };
  APPS.forEach((a, i) => {
    s += T(mx - 10, my + i * cell + cell / 2 + 4, a, { size: 11, anchor: 'end' });
    s += T(mx + i * cell + cell / 2, my - 10, a, { size: 11, extra: `transform="rotate(-40 ${mx + i * cell + cell / 2} ${my - 10})"` });
    for (let j = 0; j < n; j++) {
      const v = val(i, j);
      const cut = crmCut && (APPS[i] === 'CRM' || APPS[j] === 'CRM') && v;
      const tip = v ? `${APPS[i]} ↔ ${APPS[j]} · ${MBPS[v]}${cut ? ' · interrompu' : ''}` : `${APPS[i]} ↔ ${APPS[j]} · aucun flux`;
      s += `<rect class="cell" data-tip="${esc(tip)}" x="${mx + j * cell + 1}" y="${my + i * cell + 1}" width="${cell - 2}" height="${cell - 2}" fill="${v ? P.metric[Math.min(4, v)] : P.surface}" ${cut ? `stroke="${P.critical}" stroke-width="1.6"` : ''}/>`;
    }
  });
  s += T(mx, my + n * cell + 28, crmCut ? 'cadre rouge : conversation avec CRM interrompue (crm-db-01 injoignable)' : 'survoler une case pour lire le débit', { size: 10.5, font: MONO, fill: P.ink });
  const sx = 700; const colsX = [sx, sx + 190, sx + 380, sx + 570, sx + 760];
  s += cartouche(sx, 60, 'FLUX NORD-SUD · SANKEY', ['entrées → pare-feu → frontaux → applications → données', 'épaisseur = débit p95 1 h']);
  const crmV = crmCut ? 4 : 40;
  const nodes = [
    [['Internet', 420], ['Agences', 160], ['VPN', 60], ['Siège', 240]],
    [['fw-par-1', 880]],
    [['VIP portail', 420], ['Passerelles RDS', 220], ['LAN direct', 240]],
    [['Portail', 300], ['Kubernetes', 120], ['RDS', 220], ['Messagerie', 110], ['ERP', 90], ['CRM', 40]],
    [['SQL AO', 220], ['Redis', 80], ['Files MQ', 120], ['Fichiers', 220], ['Annuaire', 110], ['erp-db-01', 90], ['crm-db-01', 40]],
  ];
  const scale = 0.6; const gap = 12; const top = 170;
  const lay = nodes.map((col, c) => { let y = top; return col.map(([name, v]) => { const h = v * scale; const o = { name, v, x: colsX[c], y, h }; y += h + gap; return o; }); });
  const links = [
    [0, 0, 1, 0, 420], [0, 1, 1, 0, 160], [0, 2, 1, 0, 60], [0, 3, 1, 0, 240],
    [1, 0, 2, 0, 420], [1, 0, 2, 1, 220], [1, 0, 2, 2, 240],
    [2, 0, 3, 0, 300], [2, 0, 3, 1, 120], [2, 1, 3, 2, 220], [2, 2, 3, 3, 110], [2, 2, 3, 4, 90], [2, 2, 3, 5, 40],
    [3, 0, 4, 0, 220], [3, 0, 4, 1, 80], [3, 1, 4, 2, 120], [3, 2, 4, 3, 220], [3, 3, 4, 4, 110], [3, 4, 4, 5, 90], [3, 5, 4, 6, 40],
  ];
  const outOff = new Map(); const inOff = new Map();
  for (const [c1, i1, c2, i2, v] of links) {
    const a = lay[c1][i1]; const b = lay[c2][i2]; const w = v * scale;
    const ao = outOff.get(a) || 0; const bo = inOff.get(b) || 0;
    outOff.set(a, ao + w); inOff.set(b, bo + w);
    const x1 = a.x + 14; const x2 = b.x; const y1 = a.y + ao + w / 2; const y2 = b.y + bo + w / 2;
    const imp = crmCut && (b.name === 'crm-db-01' || b.name === 'CRM');
    const obs = imp ? crmV * scale : w;
    s += `<path class="cell" data-tip="${esc(`${a.name} → ${b.name} · p95 ${imp ? `${crmV} Mb/s observés sur ${v} attendus` : `${v} Mb/s`}`)}" d="M${x1} ${y1} C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}" fill="none" stroke="${imp ? P.critical : P.flow.web}" stroke-opacity="${imp ? 0.6 : 0.26}" stroke-width="${Math.max(1, (imp ? w : obs) - 1)}" ${imp ? 'stroke-dasharray="6 5"' : ''}/>`;
  }
  for (const col of lay) for (const nd of col) {
    const crm = crmCut && (nd.name === 'CRM' || nd.name === 'crm-db-01');
    s += `<rect x="${nd.x}" y="${nd.y}" width="14" height="${Math.max(2, nd.h)}" fill="${crm ? P.critical : P.ink}"/>`;
    s += T(nd.x + 20, nd.y + Math.min(nd.h / 2 + 4, 14), nd.name, { size: 11, font: nd.name.includes('-') ? MONO : SANS });
  }
  if (crmCut) s += T(colsX[3], H - 40, 'tirets rouges : débit attendu, non observé depuis la coupure de crm-db-01', { size: 10.5, font: MONO, fill: P.ink });
  void sel;
  return `${s}</svg>`;
}

// ============================================================ métrologie : petits multiples
const CW = 260; const CH = 92;

/** Construit les données de la vue (mises en cache par l'appelant). */
export function metroData(ids, periodKey, end) {
  return ids.map((id) => ({ id, metrics: Object.fromEntries(Object.keys(METRICS).map((m) => [m, metricsFor(id).includes(m) ? series(id, m, periodKey, end) : null])) }));
}

function chartSvg(d, m, { compare, cursorT }) {
  const def = METRICS[m];
  if (!d) return `<svg viewBox="0 0 ${CW} ${CH}" class="chart empty" aria-hidden="true"><rect x="0.5" y="0.5" width="${CW - 1}" height="${CH - 1}" fill="none" stroke="#20252C" stroke-dasharray="3 3"/>${T(CW / 2, CH / 2 + 4, 'non mesuré', { size: 10.5, anchor: 'middle', font: MONO, fill: P.disabled })}</svg>`;
  const n = d.v.length; const X = (i) => (i / (n - 1)) * CW; const Y = (v) => CH - (v / def.max) * CH;
  let s = `<svg viewBox="0 0 ${CW} ${CH}" class="chart" data-metric="${m}" preserveAspectRatio="none">`;
  s += `<rect width="${CW}" height="${CH}" fill="#161A20"/>`;
  for (let k = 1; k < 7; k++) s += `<line x1="${(k / 7) * CW}" y1="0" x2="${(k / 7) * CW}" y2="${CH}" stroke="#20252C"/>`;
  const up = d.hi.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join('');
  const dn = d.lo.map((v, i) => [i, v]).reverse().map(([i, v]) => `L${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join('');
  s += `<path d="${up}${dn}Z" fill="${P.ink}" fill-opacity="0.13"/>`;
  s += `<line x1="0" y1="${Y(def.thr)}" x2="${CW}" y2="${Y(def.thr)}" stroke="${P.major}" stroke-width="0.9" stroke-dasharray="4 3" stroke-opacity="0.8"/>`;
  if (compare) s += `<path d="${d.prev.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join('')}" fill="none" stroke="${P.temporal}" stroke-width="1" stroke-dasharray="3 3" stroke-opacity="0.85"/>`;
  let path = ''; let pen = false; let gapFrom = null;
  d.v.forEach((v, i) => {
    if (v == null) { pen = false; if (gapFrom == null) gapFrom = i; return; }
    path += `${pen ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`; pen = true;
  });
  // aire légère sous la courbe
  s += `<path d="${path}" fill="none" stroke="${P.metric[4]}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
  d.v.forEach((v, i) => { if (v != null && v >= def.thr) s += `<rect x="${X(i) - 1}" y="${CH - 3}" width="3" height="3" fill="${P.major}"/>`; });
  if (gapFrom != null) s += `<rect x="${X(gapFrom)}" y="0" width="${CW - X(gapFrom)}" height="${CH}" fill="url(#h-mt)"/>`;
  if (cursorT != null && cursorT >= d.t[0] && cursorT <= d.t[n - 1]) {
    const i = Math.round(((cursorT - d.t[0]) / (d.t[n - 1] - d.t[0])) * (n - 1));
    s += `<line x1="${X(i)}" y1="0" x2="${X(i)}" y2="${CH}" stroke="${P.temporal}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
  }
  s += `<line class="xh" x1="-10" y1="0" x2="-10" y2="${CH}" stroke="${P.ivory}" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
  return `${s}</svg>`;
}

export function renderMetrologie(rows, { period, compare, cursorT, labels = {}, states }) {
  const lastVal = (d, m) => { if (!d) return ''; for (let i = d.v.length - 1; i >= 0; i--) if (d.v[i] != null) return i === d.v.length - 1 ? fmtVal(d.v[i], m) : '—'; return '—'; };
  let h = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${hatchDef('h-mt')}</defs></svg>`;
  h += '<div class="mt-grid"><div class="mt-head"></div>';
  for (const m of Object.keys(METRICS)) h += `<div class="mt-head">${METRICS[m].label} <span>${METRICS[m].unit}</span></div>`;
  for (const row of rows) {
    const st = states.get(row.id);
    const bad = st === 'root' ? 'critical' : st === 'major' ? 'major' : null;
    h += `<button type="button" class="mt-obj${bad ? ` is-${bad}` : ''}" data-id="${row.id}"><b>${esc(row.id)}</b><small>${esc(labels[row.id] || '')}</small>${st === 'root' ? '<em>injoignable, collecte interrompue</em>' : row.id === 'lic-par-01' && st ? '<em>aucune donnée depuis 15 min</em>' : ''}</button>`;
    for (const m of Object.keys(METRICS)) {
      const d = row.metrics[m];
      h += `<div class="mt-cell" data-id="${row.id}" data-metric="${m}">${chartSvg(d, m, { compare, cursorT })}<span class="mt-val" data-last="${lastVal(d, m)}">${lastVal(d, m)}</span></div>`;
    }
  }
  h += '</div>';
  const first = rows[0]?.metrics.cpu || rows[0]?.metrics.net || rows[0]?.metrics.temp;
  if (first) {
    const n = first.t.length; const ticks = [];
    for (let k = 0; k <= 2; k++) { const i = Math.round((k / 2) * (n - 1)); ticks.push(period === '24h' ? fmtClock(first.t[i], false) : fmtDay(first.t[i])); }
    h += `<div class="mt-axis"><span></span>${Object.keys(METRICS).map(() => `<span class="ticks">${ticks.map((t) => `<i>${t}</i>`).join('')}</span>`).join('')}</div>`;
  }
  return h;
}

export function fmtVal(v, m) {
  if (v == null) return '—';
  return m === 'temp' ? v.toFixed(1).replace('.', ',') : String(Math.round(v));
}

export function metroSide() {
  // colonne droite : projection, carte horaire, disponibilité
  const pw = 206; const ph = 110;
  let s = '<div class="mt-side">';
  s += '<section><h3>Projection de capacité</h3>';
  s += `<svg viewBox="0 0 ${pw} ${ph}" class="side-chart" role="img" aria-label="Projection de remplissage du volume vm_nfs01"><rect width="${pw}" height="${ph}" fill="#161A20"/>`;
  const hist = Array.from({ length: 40 }, (_, i) => 62 + i * 0.48 + Math.sin(i) * 1.5);
  s += `<path d="${hist.map((v, i) => `${i ? 'L' : 'M'}${(i * 3).toFixed(1)} ${(ph - (v / 100) * ph).toFixed(1)}`).join('')}" fill="none" stroke="${P.metric[4]}" stroke-width="1.5"/>`;
  const x0 = 39 * 3; const y0 = ph - (81 / 100) * ph;
  s += `<path d="M${x0} ${y0} L${pw} ${-8} L${pw} ${ph - 0.9 * ph} Z" fill="${P.metric[3]}" fill-opacity="0.18"/><line x1="${x0}" y1="${y0}" x2="${pw}" y2="4" stroke="${P.metric[3]}" stroke-dasharray="4 3"/><line x1="0" y1="2" x2="${pw}" y2="2" stroke="${P.major}" stroke-dasharray="4 3" stroke-width="0.9"/></svg>`;
  s += '<p class="mono">stor-par-1 · volume vm_nfs01</p><p class="big mono">plein estimé le 14/11 (± 6 j)</p></section>';
  s += '<section><h3>CPU p95 · heure × jour · 12 sem.</h3><div class="heat" role="img" aria-label="Carte horaire du CPU au p95">';
  const days = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
  for (let d = 0; d < 7; d++) for (let hh = 0; hh < 24; hh++) {
    const v = (d < 5 ? 0.25 + 0.7 * Math.max(0, Math.sin((hh - 7) / 12 * Math.PI)) : 0.15) + (hh === 2 ? 0.5 : 0);
    const pct = Math.min(99, Math.round(v * 80));
    s += `<i class="cell" style="background:${P.metric[Math.min(4, Math.floor(v * 5))]}" data-tip="${days[d]} ${String(hh).padStart(2, '0')} h · CPU p95 ${pct} %"></i>`;
  }
  s += '</div><p class="mono">pic de 02 h = sauvegarde SQL</p></section>';
  s += '<section><h3>Disponibilité · mois en cours</h3><dl class="sla">';
  for (const [nm, v, o] of [['Portail clients', '99,97 %', 'objectif 99,9'], ['CRM', '99,71 %', 'objectif 99,5'], ['ERP', '100 %', 'objectif 99,9'], ['Bureaux à distance', '99,93 %', 'objectif 99,5']]) s += `<div><dt>${nm}</dt><dd class="mono">${v}</dd><dd class="obj mono">${o} · hors maintenances</dd></div>`;
  s += '</dl></section></div>';
  return s;
}

export const PERIOD_LABELS = Object.fromEntries(Object.entries(PERIODS).map(([k, v]) => [k, v.label]));

// ============================================================ mur : WAN simplifié
export function renderWan(state) {
  const transit = state.events.some((e) => e.id === 'transit');
  return `<svg viewBox="0 0 780 438" class="v-svg" role="img" aria-label="Réseau étendu">
${T(26, 36, 'RÉSEAU ÉTENDU · 24 H P95', { size: 15, font: COND, weight: 600, ls: 2, fill: P.ink })}
<path d="M190 120 L190 196" stroke="${transit ? P.major : '#4A535E'}" stroke-width="7" stroke-linecap="round"/>
<path d="M226 120 C 300 150 300 196 300 216" stroke="#4A535E" stroke-width="7" fill="none" stroke-linecap="round"/>
<path d="M270 236 L510 236" stroke="#4A535E" stroke-width="14" stroke-linecap="round"/>
<path d="M560 120 L590 196" stroke="#4A535E" stroke-width="5" stroke-linecap="round"/>
<path d="M200 276 C 200 340 330 360 380 360" stroke="#4A535E" stroke-width="5" fill="none" stroke-linecap="round"/>
<path d="M590 276 C 590 340 470 360 440 360" stroke="#4A535E" stroke-width="4" fill="none" stroke-linecap="round"/>
<rect x="110" y="84" width="170" height="40" rx="20" fill="${P.surface}" stroke="#4A535E" stroke-width="2"/>${T(195, 111, 'Internet', { size: 18, anchor: 'middle', font: MONO })}
<rect x="490" y="84" width="170" height="40" rx="20" fill="${P.surface}" stroke="#4A535E" stroke-width="2"/>${T(575, 111, 'Internet', { size: 18, anchor: 'middle', font: MONO })}
<rect x="110" y="200" width="200" height="72" rx="36" fill="${P.surface}" stroke="${P.inkLight}" stroke-width="2.5"/>${T(210, 233, 'Paris DC1', { size: 22, anchor: 'middle', weight: 600, fill: P.ivory })}${T(210, 256, 'production', { size: 14, anchor: 'middle', font: MONO, fill: P.ink })}
<rect x="490" y="200" width="200" height="72" rx="36" fill="${P.surface}" stroke="${P.inkLight}" stroke-width="2.5"/>${T(590, 233, 'Lyon DC2', { size: 22, anchor: 'middle', weight: 600, fill: P.ivory })}${T(590, 256, 'secours', { size: 14, anchor: 'middle', font: MONO, fill: P.ink })}
<rect x="295" y="340" width="190" height="40" rx="20" fill="${P.surface}" stroke="#4A535E" stroke-width="2"/>${T(390, 366, 'MPLS · 3 agences', { size: 17, anchor: 'middle', font: MONO })}
${T(390, 222, 'DWDM 2×100G · 12 %', { size: 15, anchor: 'middle', font: MONO, fill: P.ink })}
${transit ? `<path d="M18 162 L27 147 L36 162 Z" fill="${P.major}"/>${T(42, 162, 'transit 1 81 %', { size: 15, font: MONO, fill: P.major })}` : ''}
${T(604, 162, '22 %', { size: 15, font: MONO, fill: P.ink })}
</svg>`;
}
