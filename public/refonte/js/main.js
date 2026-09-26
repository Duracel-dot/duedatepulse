// Démo du nouveau front : ossature, console, sélection partagée, relecture, lentille, mur.
import { WORLD, T0, EVENT_BY_ID, ACK_TEMPLATES, stateAt, describe, searchObjects, rackOf, metricsFor, series, fmtAge, fmtClock, nowT, SERVICE_NAMES, PERIODS } from './data.js';
import * as V from './views2d.js';
import { createScene } from './scene3d.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const app = $('#app');

const VIEWS = ['physique', 'services', 'reseau', 'virtualisation', 'flux', 'metrologie'];
const VIEW_NAMES = { physique: 'Vue physique', services: 'Services et impacts', reseau: 'Réseau L2', virtualisation: 'Virtualisation', flux: 'Flux', metrologie: 'Métrologie' };
const DEFAULT_PINNED = ['esx-par-07', 'esx-par-08', 'sql-par-01', 'tor-a06-1', 'stor-par-1'];

const S = {
  view: 'physique',
  console: 'bande',
  sel: null,
  replay: null,            // { t, playing, speed } quand la relecture est active
  acks: {},
  expanded: new Set(),
  ackOpen: null,
  filters: { 1: true, 2: true, 3: true, unacked: false, maint: true },
  calque: true,
  mur: false,
  period: '7j',
  compare: true,
};

let state = stateAt(0, S.acks);
let signature = '';
let scene = null;

const currentT = () => (S.replay ? S.replay.t : nowT());
const prioOf = (e) => (e.prio === 0 ? 0 : e.prio);
const glyphHtml = (prio, { ack = false, blink = false } = {}) => `<span class="glyph g-p${prio}${ack ? ' ack' : ''}${blink ? ' blink' : ''}" aria-hidden="true"></span>`;
const PRIO_LABEL = { 0: 'maintenance', 1: 'P1 critique', 2: 'P2 majeur', 3: 'P3 mineur' };
const lcFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// ============================================================ calcul et rafraîchissement
function recompute() {
  state = stateAt(currentT(), S.acks);
  const sig = state.events.map((e) => `${e.id}${e.ackNow ? '+' : ''}`).join(',') + (state.afterHA ? 'H' : '') + (state.n1Consumed ? 'N' : '');
  const changed = sig !== signature;
  signature = sig;
  return changed;
}

function renderAll() {
  recompute();
  renderHud();
  renderBand();
  renderConsole();
  renderView();
  renderInspector();
  if (scene) { scene.setState(state); scene.setPins(pinsFor()); scene.select(S.sel); }
  if (S.mur) renderMur();
}

// tic d'une seconde : âges, horloge, âge des données ; rendu complet seulement si l'état change
let dataAge = 4;
setInterval(() => {
  if (S.replay?.playing) return;
  dataAge = dataAge >= 9 ? 1 : dataAge + 1;
  const changed = recompute();
  if (changed) renderAll();
  else { renderHud(); renderBand(); updateAges(); refreshInspector(); scene?.setPins(pinsFor()); if (S.mur) renderMur(); }
}, 1000);

// l'inspecteur n'est pas redessiné pendant qu'on y navigue au clavier
function refreshInspector() { if (!$('#inspector').contains(document.activeElement)) renderInspector(); }

// ============================================================ HUD
function renderHud() {
  for (const b of $$('.ctr')) {
    const p = b.dataset.prio; const n = state.counters[p];
    b.querySelector('b').textContent = n;
    b.dataset.count = n;
    b.classList.toggle('hot', p === '1' && n > 0);
    b.setAttribute('aria-label', `${n} alarme${n > 1 ? 's' : ''} P${p} non prise${n > 1 ? 's' : ''} en charge`);
  }
  $('#clock').textContent = fmtClock(nowT());
  const tag = $('#replay-tag');
  tag.hidden = !S.replay;
  if (S.replay) tag.textContent = `RELECTURE · ${fmtClock(S.replay.t)}`;
  const age = $('#age');
  age.hidden = !!S.replay;
  age.querySelector('span').textContent = `données il y a ${dataAge} s`;
  $('#btn-demo').classList.toggle('on', !!S.replay);
  // fil d'Ariane : périmètre + sélection
  const d = S.sel ? describe(S.sel) : null;
  let crumbs = `<span>Paris DC1</span><span aria-hidden="true">›</span><b>${VIEW_NAMES[S.view]}</b>`;
  if (d) {
    const rack = rackOf(S.sel);
    if (rack && d.kind !== 'rack') crumbs += `<span aria-hidden="true">›</span><span>Baie ${rack}</span>`;
    crumbs += `<span aria-hidden="true">›</span><span class="mono">${esc(d.name)}</span>`;
  }
  $('#crumbs').innerHTML = crumbs;
}

// ============================================================ bande d'alarmes / de relecture
function renderBand() {
  const band = $('#band');
  if (S.replay) { renderReplayBand(band); return; }
  const open = state.roots.filter((r) => r.prio > 0 && !r.ackNow);
  const shown = open.slice(0, 3);
  let h = '<div class="band-items">';
  for (const r of shown) {
    const extra = r.children?.length ? ` · ${r.children.length} conséquences regroupées` : '';
    h += `<button type="button" class="band-item" data-id="${esc(r.obj)}" data-ev="${r.id}">${glyphHtml(r.prio, { blink: r.prio === 1 })}<b class="mono">${esc(r.obj)}</b><span>${esc(lcFirst(r.title))} · ${fmtAge(r.age)}${extra}</span></button>`;
  }
  if (!shown.length) h += '<span class="band-item"><span>aucune alarme non prise en charge</span></span>';
  h += '</div>';
  const acked = state.roots.filter((r) => r.ackNow).length;
  const rest = open.length - shown.length;
  h += `<div class="band-r"><span class="mono">${rest > 0 ? `+ ${rest} non pris · ` : ''}${acked} pris en charge</span><button type="button" class="small" data-act="console">Console <kbd>E</kbd></button></div>`;
  band.innerHTML = h;
}

function renderReplayBand(band) {
  const t0 = nowT() - 86400; const t1 = nowT();
  const ticks = [];
  for (const e of EVENT_BY_ID.values()) {
    if (e.start < t0 || e.group) continue;
    const x = ((e.start - t0) / (t1 - t0)) * 100;
    ticks.push(`<i style="left:${x.toFixed(2)}%;background:${e.prio === 1 ? 'var(--p1)' : e.prio === 2 ? 'var(--p2)' : e.prio === 3 ? 'var(--p3)' : 'var(--ink)'}"></i>`);
  }
  const r = S.replay;
  const sp = (v) => `<button type="button" data-speed="${v}" aria-pressed="${r.speed === v}">×${v}</button>`;
  band.innerHTML = `<span class="rp-tag">RELECTURE</span>
    <div class="rp-ctrl">
      <button type="button" data-rp="back" aria-label="Reculer d'une minute"><svg viewBox="0 0 20 20"><path d="M17 4 L9 10 L17 16 Z M9 4 L1 10 L9 16 Z"/></svg></button>
      <button type="button" data-rp="play" aria-label="${r.playing ? 'Pause' : 'Lecture'}"><svg viewBox="0 0 20 20">${r.playing ? '<path d="M6 4 V16 M14 4 V16"/>' : '<path d="M5 3 L17 10 L5 17 Z"/>'}</svg></button>
      <button type="button" data-rp="fwd" aria-label="Avancer d'une minute"><svg viewBox="0 0 20 20"><path d="M3 4 L11 10 L3 16 Z M11 4 L19 10 L11 16 Z"/></svg></button>
    </div>
    <span class="mono">${fmtClock(r.t)}</span>
    <div class="rp-track"><div class="rp-bars">${ticks.join('')}</div><input type="range" id="rp-range" min="${Math.floor(t0)}" max="${Math.ceil(t1)}" step="1" value="${Math.round(r.t)}" aria-label="Instant de relecture"></div>
    <div class="rp-speed" role="group" aria-label="Vitesse">${sp(1)}${sp(10)}${sp(60)}</div>
    <button type="button" class="rp-live" data-rp="live">Revenir au direct</button>`;
}

// ============================================================ console d'événements
function visibleRoots() {
  return state.roots.filter((r) => {
    if (r.prio === 0) return S.filters.maint;
    if (!S.filters[r.prio]) return false;
    if (S.filters.unacked && r.ackNow) return false;
    return true;
  });
}

function renderConsole() {
  const roots = visibleRoots();
  const open = state.roots.filter((r) => r.prio > 0 && !r.ackNow).length;
  $('#con-count').textContent = `${state.roots.length} actifs · ${open} non pris en charge`;
  const counts = { 1: 0, 2: 0, 3: 0, maint: 0 };
  for (const r of state.roots) { if (r.prio === 0) counts.maint++; else counts[r.prio]++; }
  for (const c of $$('#con-filters .chip')) {
    const f = c.dataset.f;
    c.setAttribute('aria-pressed', String(!!S.filters[f]));
    const b = c.querySelector('b'); if (b) b.textContent = counts[f] ?? '';
  }
  const list = $('#con-list');
  if (!roots.length) { list.innerHTML = '<p class="con-empty">Aucun événement ne correspond aux filtres.</p>'; return; }
  let h = '';
  for (const r of roots) {
    const selected = S.sel && (r.obj === S.sel || r.children?.some((c) => c.obj === S.sel));
    const blink = r.prio === 1 && !r.ackNow && !S.replay;
    const who = r.prio === 0 ? esc(r.detail.split(' · ')[0]) : r.ackNow ? esc(r.ackNow.by) : '<span class="open">non pris</span>';
    h += `<div class="ev-group${selected ? ' selected' : ''}" role="listitem">`;
    h += `<button type="button" class="ev${r.ackNow ? ' is-acked' : ''}${r.prio === 0 ? ' is-maint' : ''}" data-ev="${r.id}" data-id="${esc(r.obj)}">${glyphHtml(prioOf(r), { ack: !!r.ackNow, blink })}<span class="age" data-age="${r.start}">${r.prio === 0 ? '→ 18:00' : fmtAge(r.age)}</span><span class="obj">${esc(r.obj)}</span><span class="msg"><b>${esc(r.title)}</b><small>${esc(r.ackNow?.comment ? `« ${r.ackNow.comment} »` : r.detail)}</small></span><span class="who${!r.ackNow && r.prio ? ' open' : ''}">${who}</span></button>`;
    if (r.children?.length) {
      const vms = r.children.filter((c) => c.id.startsWith('vm-')).length;
      const down = r.children.filter((c) => c.id.startsWith('svc-') && c.prio === 1).map((c) => c.detail.split(' · ')[0]);
      const deg = r.children.filter((c) => c.id.startsWith('svc-') && c.prio === 3).length;
      const lnk = r.children.filter((c) => c.id.startsWith('lnk')).length;
      const parts = [vms && `${vms} VM injoignable${vms > 1 ? 's' : ''}`, down.length && `${down.join(' et ')} interrompu${down.length > 1 ? 's' : ''}`, deg && `${deg} service${deg > 1 ? 's' : ''} dégradé${deg > 1 ? 's' : ''}`, lnk && `${lnk} lien${lnk > 1 ? 's' : ''} down`].filter(Boolean);
      const exp = S.expanded.has(r.id);
      h += `<div class="ev-sum"><span>${r.children.length} conséquences : ${parts.join(' · ')}</span><button type="button" data-act="expand" data-ev="${r.id}" aria-expanded="${exp}">${exp ? 'Replier' : 'Déplier'}</button></div>`;
      if (exp) {
        h += '<div class="ev-child">';
        for (const c of r.children) h += `<button type="button" class="ev" data-id="${esc(c.obj)}">${glyphHtml(c.prio)}<span class="age">${fmtAge(c.age)}</span><span class="obj">${esc(c.obj.startsWith('svc:') ? SERVICE_NAMES[c.obj] : c.obj)}</span><span class="msg"><b>${esc(c.title)}</b><small>${esc(c.detail)}</small></span></button>`;
        h += '</div>';
      }
    }
    if (selected && r.prio > 0) h += ackBlock(r);
    h += '</div>';
  }
  list.innerHTML = h;
}

function ackBlock(r) {
  if (r.ackNow) return `<div class="ev-actions"><span class="ack-note">Pris en charge par ${esc(r.ackNow.by)} · ${fmtClock(r.ackNow.at, false)}${r.ackNow.comment ? ` · « ${esc(r.ackNow.comment)} »` : ''}</span></div>`;
  if (S.replay) return '<div class="ev-actions"><span class="ack-note">Relecture : revenir au direct pour prendre en charge.</span></div>';
  if (S.ackOpen !== r.id) return `<div class="ev-actions"><div class="row"><span class="ack-note">Non pris en charge depuis ${fmtAge(r.age)}</span><button type="button" class="primary" data-act="ack-open" data-ev="${r.id}">Prendre en charge</button></div></div>`;
  return `<div class="ev-actions"><label for="ack-comment">COMMENTAIRE DE PRISE EN CHARGE</label>
    <input id="ack-comment" type="text" placeholder="ex. intervention salle A, remplacement des alimentations" data-ev="${r.id}">
    <div class="row"><div class="tpl">${ACK_TEMPLATES.map((t) => `<button type="button" data-tpl="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <button type="button" class="primary" data-act="ack" data-ev="${r.id}">Valider <kbd>Ctrl ↵</kbd></button></div></div>`;
}

function updateAges() {
  for (const el of $$('#con-list .age[data-age]')) {
    const e = EVENT_BY_ID.get(el.closest('[data-ev]')?.dataset.ev);
    if (e && e.prio !== 0) el.textContent = fmtAge(currentT() - e.start);
  }
  for (const b of $$('#band .band-item[data-ev]')) {
    const e = EVENT_BY_ID.get(b.dataset.ev);
    const span = b.querySelector('span');
    if (e && span) span.textContent = span.textContent.replace(/\d\d:\d\d:\d\d/, fmtAge(currentT() - e.start));
  }
}

function acknowledge(evId, comment) {
  const e = EVENT_BY_ID.get(evId);
  if (!e || S.replay) return;
  S.acks[evId] = { by: 'Vous · N1', comment: comment?.trim() || '', at: nowT() };
  S.ackOpen = null;
  toast(`Pris en charge : ${e.obj}`);
  renderAll();
}

// ============================================================ vues
function setView(v, { keepFocus = false } = {}) {
  if (!VIEWS.includes(v)) return;
  S.view = v;
  app.dataset.view = v;
  for (const b of $$('.rail-views button')) b.setAttribute('aria-current', String(b.dataset.view === v));
  for (const id of VIEWS) $(`#view-${id}`).hidden = id !== v;
  if (S.console === 'plein') setConsole('panneau');
  renderHud();
  renderView();
  if (v === 'physique') scene?.invalidate();
  if (!keepFocus) hideTip();
}

function renderView() {
  const v = S.view;
  if (v === 'services') $('#view-services').innerHTML = V.renderServices(state, S.sel);
  else if (v === 'reseau') $('#view-reseau').innerHTML = V.renderMetro(state, S.sel);
  else if (v === 'virtualisation') $('#view-virtualisation').innerHTML = V.renderTreemap(state, S.sel);
  else if (v === 'flux') $('#view-flux').innerHTML = V.renderFlux(state, S.sel);
  else if (v === 'metrologie') renderMetrologie();
}

// ---------------------------------------------------------------- métrologie
const MT_LABELS = {};
function labelFor(id) {
  if (MT_LABELS[id]) return MT_LABELS[id];
  const d = describe(id);
  let l = '';
  if (d.host) l = `${d.host.cluster} · ${rackOf(id)} U${d.device?.u ?? ''}`;
  else if (d.vm) l = `${d.vm.app} · ${state.vmHost.get(id)}`;
  else if (d.device) l = `${d.device.model} · ${d.device.rack}`;
  else if (d.kind === 'rack') l = 'sonde d’entrée haute';
  MT_LABELS[id] = l;
  return l;
}
let mtCache = { key: '', rows: [] };
function renderMetrologie() {
  const ids = [...DEFAULT_PINNED];
  if (S.sel && metricsFor(S.sel).length && !ids.includes(S.sel)) ids.unshift(S.sel);
  const step = PERIODS[S.period].step;
  const end = Math.floor(currentT() / step) * step;
  const key = `${ids.join()}|${S.period}|${end}`;
  if (mtCache.key !== key) mtCache = { key, rows: V.metroData(ids, S.period, end) };
  const labels = Object.fromEntries(ids.map((id) => [id, labelFor(id)]));
  $('#mt-scope').textContent = `${ids.length} objets épinglés · ${PERIODS[S.period].label} · gris : plage normale sur 4 semaines`;
  $('#mt-main').innerHTML = V.renderMetrologie(mtCache.rows, { period: S.period, compare: S.compare, cursorT: S.replay ? S.replay.t : null, labels, states: state.obj });
  if (!$('#mt-side').firstChild) $('#mt-side').innerHTML = V.metroSide();
  for (const b of $$('#mt-period button')) b.setAttribute('aria-pressed', String(b.dataset.p === S.period));
  for (const o of $$('#mt-main .mt-obj')) o.classList.toggle('selected', o.dataset.id === S.sel);
  $('#mt-readout').textContent = '';
}

function metroHover(e) {
  const svg = e.target.closest?.('.mt-cell svg.chart:not(.empty)');
  const rows = mtCache.rows;
  if (!svg || !rows.length) return;
  const r = svg.getBoundingClientRect();
  const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const first = rows[0].metrics.cpu || rows[0].metrics.net || rows[0].metrics.temp;
  const i = Math.round(f * (first.t.length - 1));
  for (const cell of $$('#mt-main .mt-cell')) {
    const row = rows.find((x) => x.id === cell.dataset.id);
    const d = row?.metrics[cell.dataset.metric];
    const line = cell.querySelector('.xh');
    const val = cell.querySelector('.mt-val');
    if (!d || !line) continue;
    const x = (i / (d.v.length - 1)) * 260;
    line.setAttribute('x1', x); line.setAttribute('x2', x);
    val.textContent = V.fmtVal(d.v[i], cell.dataset.metric);
  }
  const t = first.t[i];
  $('#mt-readout').textContent = `${new Date(Date.now() + (t - nowT()) * 1000).toLocaleString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
}
function metroLeave() {
  for (const cell of $$('#mt-main .mt-cell')) {
    const line = cell.querySelector('.xh'); const val = cell.querySelector('.mt-val');
    if (line) { line.setAttribute('x1', -10); line.setAttribute('x2', -10); }
    if (val) val.textContent = val.dataset.last;
  }
  $('#mt-readout').textContent = '';
}

// ============================================================ sélection partagée
function select(id, { frame = false, from = null } = {}) {
  S.sel = id || null;
  if (S.ackOpen && !state.roots.some((r) => r.id === S.ackOpen && (r.obj === S.sel))) S.ackOpen = null;
  renderHud();
  renderConsole();
  renderView();
  renderInspector();
  if (scene) {
    scene.select(S.sel, { frame: frame && S.view === 'physique' });
  }
  if (from !== 'console') {
    const row = $('#con-list .ev-group.selected');
    row?.scrollIntoView({ block: 'nearest' });
  }
}

function pinsFor() {
  // épingles : racines P1/P2 non prises en charge sur des objets physiques (5 au plus)
  const out = [];
  for (const r of state.roots) {
    if (!(r.prio === 1 || r.prio === 2) || r.ackNow) continue;
    if (!scene?.has(r.obj)) continue;
    let sub = `${fmtAge(r.age)} · ${r.detail}`;
    if (r.id === 'esx08') {
      const vms = r.children.filter((c) => c.id.startsWith('vm-')).length;
      const down = r.children.filter((c) => c.id.startsWith('svc-') && c.prio === 1).length;
      sub = `${fmtAge(r.age)} · ${vms ? `${vms} VM injoignables` : 'VM en cours d’évaluation'}${down ? ` · ${down} services interrompus` : ''}`;
    }
    out.push({ id: r.obj, prio: r.prio, blink: r.prio === 1 && !S.replay, title: `<span class="mono">${esc(r.obj)}</span> · ${esc(lcFirst(r.title))}`, sub: esc(sub) });
    if (out.length >= 5) break;
  }
  return out;
}

// ============================================================ inspecteur
function renderInspector() {
  const el = $('#inspector');
  if (!S.sel) { el.hidden = true; return; }
  const d = describe(S.sel);
  el.hidden = false;
  const ev = state.events.filter((e) => e.obj === S.sel).sort((a, b) => (a.prio || 9) - (b.prio || 9))[0];
  const root = ev && (ev.group ? state.roots.find((r) => r.id === ev.group) : state.roots.find((r) => r.id === ev.id));
  const kindLabel = { host: 'Hôte de virtualisation', device: d.device?.type ? `Équipement · ${d.device.type}` : 'Équipement', vm: 'Machine virtuelle', rack: 'Baie 42U', cluster: 'Cluster', service: 'Service', autre: 'Objet' }[d.kind];
  let h = `<div class="in-head"><div><div class="in-name">${ev ? glyphHtml(ev.prio, { ack: !!ev.ackNow }) : ''}<h2>${esc(d.kind === 'service' ? d.name : d.id)}</h2></div><div class="in-sub">${esc(kindLabel)}${d.device ? ` · ${esc(d.device.vendor)} ${esc(d.device.model)}` : ''}</div></div><button type="button" class="in-close" data-act="close-inspector" aria-label="Fermer l'inspecteur">×</button></div>`;
  if (ev) {
    const cls = ev.prio === 1 ? 'p1' : ev.prio === 2 ? 'p2' : ev.prio === 3 ? 'p3' : 'ok';
    h += `<div class="in-state ${cls}"><b>${esc(ev.title)}${ev.prio ? ` depuis ${fmtAge(ev.age)}` : ''}</b><small>${esc(PRIO_LABEL[ev.prio])}${ev.group ? ' · conséquence de esx-par-08' : ev.root ? ' · cause racine probable' : ''} · ${ev.ackNow ? `pris en charge par ${esc(ev.ackNow.by)}` : ev.prio ? 'non pris en charge' : esc(ev.detail)}</small></div>`;
  } else {
    h += `<div class="in-state ok"><b>Nominal</b><small>aucune alarme active${S.replay ? ` à ${fmtClock(S.replay.t)}` : ''}</small></div>`;
  }
  const acts = [];
  if (root && root.prio > 0 && !root.ackNow && !S.replay) acts.push(`<button type="button" class="primary" data-act="ack-from-inspector" data-ev="${root.id}">Prendre en charge</button>`);
  if (scene?.has(S.sel) && S.view !== 'physique') acts.push('<button type="button" data-act="goto-3d">Voir dans la vue physique</button>');
  if (metricsFor(S.sel).length && S.view !== 'metrologie') acts.push('<button type="button" data-act="goto-metro">Métrologie</button>');
  if (d.kind === 'service' || d.vm || d.host) acts.push('<button type="button" data-act="goto-services">Impact services</button>');
  if (acts.length) h += `<div class="in-actions">${acts.join('')}</div>`;

  if (S.sel === 'esx-par-08' && state.incident) {
    h += `<section class="in-sec"><h3>Preuves</h3><dl class="kv">
      <dt class="mono">ping ICMP</dt><dd>échec 5/5</dd>
      <dt class="mono">vcenter-par</dt><dd>notResponding</dd>
      <dt class="mono">redfish</dt><dd>PSU1 et PSU2 en défaut</dd>
      <dt class="mono">snmp-reseau</dt><dd>tor-a06-1 et tor-a06-2 Eth1/2 down</dd></dl></section>`;
  }
  if (d.host || d.device) {
    const dev = d.device; const host = d.host;
    h += `<section class="in-sec"><h3>Identité</h3><dl class="kv">`;
    if (dev) h += `<dt>Emplacement</dt><dd>Salle A · baie ${esc(dev.rack)} · U${dev.u}${dev.height > 1 ? `–${dev.u + dev.height - 1}` : ''}</dd>`;
    if (host) h += `<dt>Cluster</dt><dd>${esc(host.cluster)}</dd><dt>Version</dt><dd>${esc(host.version)}</dd><dt>Ressources</dt><dd>${host.cores} cœurs · ${host.memGB} Go</dd>`;
    if (dev?.ip || host?.ip) h += `<dt>Adresse</dt><dd class="mono">${esc(dev?.ip || host?.ip)}</dd>`;
    h += '</dl></section>';
  }
  if (d.host) {
    const vms = WORLD.vms.filter((v) => state.vmHost.get(v.name) === d.id);
    h += `<section class="in-sec"><h3>VM hébergées · ${vms.length}</h3><ul class="list">`;
    for (const v of vms) {
      const st = state.obj.get(v.name);
      h += `<li>${st === 'unreach' ? '<span class="glyph g-p2" aria-hidden="true"></span>' : '<span></span>'}<button type="button" class="lnk" data-id="${esc(v.name)}">${esc(v.name)}</button><span class="dim">${st === 'unreach' ? 'injoignable' : esc(v.app)}</span></li>`;
    }
    if (S.sel === 'esx-par-08' && state.afterHA) for (const [vm, host] of Object.entries({ 'app-portail-02': 'esx-par-09', 'rds-sh-03': 'esx-par-07', 'k8s-worker-04': 'esx-par-10' })) h += `<li><span></span><button type="button" class="lnk" data-id="${vm}">${vm}</button><span class="dim">redémarrée par HA sur ${host}</span></li>`;
    h += '</ul></section>';
  }
  if (d.vm) {
    h += `<section class="in-sec"><h3>Machine virtuelle</h3><dl class="kv"><dt>Application</dt><dd>${esc(d.vm.app)}</dd><dt>Rôle</dt><dd>${esc(d.vm.role)}</dd><dt>Hôte</dt><dd><button type="button" class="lnk mono" data-id="${esc(state.vmHost.get(d.id))}" style="background:none;border:0;padding:0;color:inherit;cursor:pointer;text-decoration:underline">${esc(state.vmHost.get(d.id))}</button></dd><dt>Système</dt><dd>${esc(d.vm.os)}</dd><dt>Adresse</dt><dd class="mono">${esc(d.vm.ip)} · VLAN ${d.vm.vlan}</dd><dt>Ressources</dt><dd>${d.vm.cores} vCPU · ${d.vm.memGB} Go</dd></dl></section>`;
  }
  if (d.kind === 'rack') {
    const rack = WORLD.room.rows.flatMap((r) => r.racks).find((r) => r.id === d.id);
    h += `<section class="in-sec"><h3>Contenu · ${rack.devices.length} équipements</h3><ul class="list">`;
    for (const dv of [...rack.devices].sort((a, b) => b.u - a.u)) h += `<li><span class="dim mono">${dv.u}</span><button type="button" class="lnk" data-id="${esc(dv.id)}">${esc(dv.id)}</button><span class="dim">${esc(dv.model)}</span></li>`;
    h += '</ul></section>';
  }
  if (d.kind === 'cluster') {
    const mem = d.hosts.reduce((a, x) => a + x.memGB, 0);
    h += `<section class="in-sec"><h3>Capacité</h3><dl class="kv"><dt>Hôtes</dt><dd>${d.hosts.length}${d.id === 'CL-PROD-PAR' && state.incident ? ` (dont 1 injoignable)` : ''}</dd><dt>Mémoire</dt><dd>${mem} Go</dd><dt>Réserve N+1</dt><dd>${d.id === 'CL-PROD-PAR' && state.n1Consumed ? 'consommée : une panne de plus ne passe pas' : `${Math.max(...d.hosts.map((x) => x.memGB))} Go à garder libres`}</dd></dl></section>`;
  }
  if (d.device?.type === 'switch') {
    const links = WORLD.links.filter((l) => l.a === d.id || l.b === d.id).slice(0, 10);
    h += `<section class="in-sec"><h3>Ports raccordés · LLDP</h3><ul class="list">`;
    for (const l of links) {
      const mine = l.a === d.id ? l.aPort : l.bPort; const other = l.a === d.id ? l.b : l.a; const op = l.a === d.id ? l.bPort : l.aPort;
      const down = state.links.get(`${d.id}:${mine}`) === 'down';
      h += `<li>${down ? '<span class="glyph g-p2" aria-hidden="true"></span>' : '<span></span>'}<span class="mono">${esc(mine)}</span><span class="dim"><button type="button" class="lnk" data-id="${esc(other)}" style="display:inline">${esc(other)}</button> ${esc(op || '')} · ${l.speed / 1e9}G${down ? ' · down' : ''}</span></li>`;
    }
    h += '</ul></section>';
  }
  if (d.kind === 'service') {
    const deps = V.SERVICE_GRAPH.edges.filter(([a, b]) => a === d.id || b === d.id).map(([a, b]) => (a === d.id ? b : a));
    h += `<section class="in-sec"><h3>Dépendances</h3><ul class="list">${deps.map((x) => `<li><span></span><button type="button" class="lnk" data-id="${esc(x)}">${esc(SERVICE_NAMES[x] || x)}</button><span class="dim">${esc(state.obj.get(x) ? stateWord(state.obj.get(x)) : 'nominal')}</span></li>`).join('')}</ul></section>`;
  }
  const ms = metricsFor(S.sel);
  if (ms.length) {
    const m = ms[0];
    const sr = series(S.sel, m, '24h', Math.floor(currentT() / 300) * 300);
    h += `<section class="in-sec"><h3>${m === 'temp' ? 'Température d’entrée' : m === 'net' ? 'Réseau' : 'CPU'} · 24 h</h3>${sparkline(sr, m)}</section>`;
  }
  h += `<div class="in-foot">sources : ${esc(ev?.source || 'inventaire · collecteurs')} · ${S.replay ? `relecture ${fmtClock(S.replay.t)}` : `données il y a ${dataAge} s`}</div>`;
  el.innerHTML = h;
}
function stateWord(st) { return { root: 'cause racine', critical: 'critique', down: 'interrompu', unreach: 'injoignable', major: 'majeur', degraded: 'dégradé', minor: 'mineur', maint: 'maintenance' }[st] || st; }
function sparkline(sr, m) {
  const W = 340; const H = 70; const max = m === 'temp' ? 35 : 100; const n = sr.v.length;
  const X = (i) => (i / (n - 1)) * W; const Y = (v) => H - (v / max) * H;
  let d = ''; let pen = false; let gap = null;
  sr.v.forEach((v, i) => { if (v == null) { pen = false; if (gap == null) gap = i; return; } d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`; pen = true; });
  const area = sr.hi.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join('') + sr.lo.map((v, i) => [i, v]).reverse().map(([i, v]) => `L${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join('') + 'Z';
  let last = null; for (let i = n - 1; i >= 0; i--) if (sr.v[i] != null) { last = { i, v: sr.v[i] }; break; }
  return `<svg viewBox="0 0 ${W} ${H + 16}" class="spark" role="img" aria-label="Courbe sur 24 heures"><rect width="${W}" height="${H}" fill="#161A20"/><path d="${area}" fill="#8A94A0" fill-opacity="0.13"/><path d="${d}" fill="none" stroke="#9CC3EA" stroke-width="1.5"/>${gap != null ? `<rect x="${X(gap)}" y="0" width="${W - X(gap)}" height="${H}" fill="url(#h-in)"/>` : ''}${last ? `<circle cx="${X(last.i)}" cy="${Y(last.v)}" r="3" fill="#9CC3EA"/>` : ''}<defs><pattern id="h-in" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#5A636E" stroke-width="1.3"/></pattern></defs><text x="0" y="${H + 13}" font-family="IBM Plex Mono, monospace" font-size="10" fill="#5A636E">-24 h</text><text x="${W}" y="${H + 13}" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="10" fill="#8A94A0">${gap != null ? 'collecte interrompue' : `${V.fmtVal(last?.v, m)} ${m === 'temp' ? '°C' : '%'}`}</text></svg>`;
}

// ============================================================ console : tailles
function setConsole(size) {
  S.console = size;
  app.dataset.console = size;
  $('#btn-console').setAttribute('aria-pressed', String(size !== 'bande'));
  scene?.invalidate();
  renderConsole();
}
function cycleConsole() { setConsole({ bande: 'panneau', panneau: 'plein', plein: 'bande' }[S.console]); }

// ============================================================ relecture et scénario
let playTimer = null;
function startReplay(t = nowT() - 600, { playing = false, speed = 10 } = {}) {
  S.replay = { t, playing, speed };
  app.dataset.replay = '1';
  schedulePlay();
  renderAll();
}
function stopReplay() {
  S.replay = null;
  delete app.dataset.replay;
  clearInterval(playTimer); playTimer = null;
  renderAll();
}
function schedulePlay() {
  clearInterval(playTimer); playTimer = null;
  if (!S.replay?.playing) return;
  let last = performance.now();
  playTimer = setInterval(() => {
    const now = performance.now();
    const dt = ((now - last) / 1000) * S.replay.speed; last = now;
    S.replay.t = Math.min(nowT(), S.replay.t + dt);
    if (S.replay.t >= nowT() - 0.5) { stopReplay(); toast('Retour au direct'); return; }
    const changed = recompute();
    if (changed) renderAll();
    else { renderHud(); renderBand(); updateAges(); refreshInspector(); scene?.setPins(pinsFor()); }
  }, 250);
}
function replayIncident() {
  setView('physique');
  select('esx-par-08');
  startReplay(T0 - 110, { playing: true, speed: 10 });
  toast('Relecture de l’incident à ×10');
}

// ============================================================ lentille
const LENS_VIEWS = VIEWS.map((v) => ({ id: `view:${v}`, kind: 'vue', sub: VIEW_NAMES[v] }));
let lensItems = []; let lensIdx = 0;
function lensSearch(q) {
  const s = q.trim().toLowerCase();
  lensItems = s ? [...LENS_VIEWS.filter((x) => x.sub.toLowerCase().includes(s)), ...searchObjects(s)].slice(0, 12) : [];
  lensIdx = 0;
  const ul = $('#lens-results');
  ul.hidden = !lensItems.length;
  $('#lens-q').setAttribute('aria-expanded', String(!!lensItems.length));
  ul.innerHTML = lensItems.map((it, i) => `<li role="option" data-i="${i}" aria-selected="${i === lensIdx}"><b>${esc(it.kind === 'vue' ? it.sub : it.kind === 'service' ? it.sub : it.id)}</b><span>${esc(it.kind === 'vue' ? 'ouvrir la vue' : `${it.kind} · ${it.sub || ''}`)}</span></li>`).join('');
}
function lensPick(i) {
  const it = lensItems[i];
  if (!it) return;
  $('#lens-q').value = '';
  lensSearch('');
  $('#lens-q').blur();
  if (it.kind === 'vue') { setView(it.id.slice(5)); return; }
  if (scene?.has(it.id)) setView('physique');
  else if (it.kind === 'service') setView('services');
  select(it.id, { frame: true });
}

// ============================================================ mur d'écrans
function setMur(on) {
  S.mur = on;
  $('#mur').hidden = !on;
  if (scene) {
    if (on) { scene.mount($('#mur-scene')); scene.setMode('mur'); } else { scene.mount($('#scene-host')); scene.setMode('standard'); scene.setCalque(S.calque); }
    scene.setPins(pinsFor());
  }
  if (on) { renderMur(); $('#mur-exit').focus(); }
}
function renderMur() {
  const down = state.events.filter((e) => e.obj.startsWith('svc:') && e.prio === 1);
  const deg = state.events.filter((e) => e.obj.startsWith('svc:') && e.prio === 3);
  const total = 44;
  $('#mur-services').innerHTML = `<div class="m-pad"><div class="m-head"><span>SERVICES · PARIS + LYON</span><span class="mono">${fmtClock(currentT(), false)} · ${S.replay ? 'relecture' : `données il y a ${dataAge} s`}</span></div>
    <div class="m-counts"><div class="m-count${down.length ? '' : ' dim'}">${glyphHtml(1)}<div><b>${down.length}</b><span>interrompus</span></div></div><div class="m-count${deg.length ? '' : ' dim'}">${glyphHtml(3)}<div><b>${deg.length}</b><span>dégradés</span></div></div><div class="m-count dim"><span class="glyph" style="border:2px solid #5C646E"></span><div><b>${total - down.length - deg.length}</b><span>nominaux</span></div></div></div>
    <div class="m-rows">${down.map((e) => `<div class="m-row"><b>${esc(SERVICE_NAMES[e.obj])}</b><span>${e.obj === 'svc:crm' ? 'crm-db-01' : 'pki-01'} injoignable</span><em>${fmtAge(e.age)}</em></div>`).join('') || '<p class="m-empty">Aucun service interrompu.</p>'}</div>
    <div class="m-foot">${deg.length ? `Dégradés, redondance tenue : ${deg.map((e) => SERVICE_NAMES[e.obj]).join(' · ')}` : ''}</div></div>`;
  const open = state.roots.filter((r) => (r.prio === 1 || r.prio === 2) && !r.ackNow);
  const acked = state.roots.filter((r) => (r.prio === 1 || r.prio === 2) && r.ackNow);
  $('#mur-console').innerHTML = `<div class="m-pad"><div class="m-head"><span>NON PRIS EN CHARGE · ${open.length}</span><span class="mono">P1 et P2 seulement</span></div>
    ${open.map((r) => `<div class="m-ev${r.prio === 1 ? ' p1' : ''}">${glyphHtml(r.prio, { blink: r.prio === 1 && !S.replay })}<div><b><span class="mono">${esc(r.obj)}</span> · ${esc(lcFirst(r.title))}</b>${r.id === 'esx08' ? '<small>CRM et PKI interrompus · 3 services dégradés</small>' : ''}</div><em>${fmtAge(r.age)}</em></div>`).join('') || '<p class="m-empty">Rien à prendre en charge.</p>'}
    <div class="m-foot">${acked.length ? `Pris en charge : ${acked.map((r) => `${r.obj} (${r.ackNow.by})`).join(' · ')}` : ''}</div></div>`;
  $('#mur-wan').innerHTML = V.renderWan(state);
}

// ============================================================ bulle et toast
function showTip(html, x, y, host = $('#stage')) {
  const tip = $('#tip');
  if (tip.parentElement !== host) host.appendChild(tip);
  tip.innerHTML = html; tip.hidden = false;
  const w = host.clientWidth; const hh = host.clientHeight;
  tip.style.left = `${Math.min(x + 14, w - 290)}px`;
  tip.style.top = `${Math.min(y + 16, hh - 60)}px`;
}
function hideTip() { $('#tip').hidden = true; }
let toastTimer = null;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}
function tipFor(id) {
  const d = describe(id);
  const st = state.obj.get(id);
  const name = d.kind === 'service' ? d.name : id;
  const sub = [d.kind === 'vm' ? `VM · ${d.vm.app}` : d.device ? `${d.device.model} · ${d.device.rack} U${d.device.u}` : d.kind === 'rack' ? `${WORLD.room.rows.flatMap((r) => r.racks).find((r) => r.id === id)?.devices.length} équipements` : d.kind, st ? stateWord(st) : 'nominal'].filter(Boolean).join(' · ');
  return `<b>${esc(name)}</b><small>${esc(sub)}</small>`;
}

// ============================================================ événements DOM
document.addEventListener('click', (e) => {
  const t = e.target.closest('button, [data-id], li[data-i]');
  if (!t) return;
  if (t.matches('.rail-views button')) return setView(t.dataset.view);
  if (t.id === 'btn-console') return setConsole(S.console === 'bande' ? 'panneau' : 'bande');
  if (t.id === 'btn-calque') { S.calque = !S.calque; t.setAttribute('aria-pressed', String(S.calque)); scene?.setCalque(S.calque); return; }
  if (t.id === 'btn-mur') return setMur(true);
  if (t.id === 'mur-exit') return setMur(false);
  if (t.id === 'btn-help') { $('#help').hidden = false; $('#help-close').focus(); return; }
  if (t.id === 'help-close') { $('#help').hidden = true; return; }
  if (t.id === 'btn-demo') return S.replay ? stopReplay() : replayIncident();
  if (t.id === 'btn-home') return scene?.home();
  if (t.id === 'btn-frame') return S.sel && scene?.frame(S.sel);
  if (t.matches('.ctr')) { S.filters = { 1: false, 2: false, 3: false, unacked: true, maint: false }; S.filters[t.dataset.prio] = true; setConsole('panneau'); return; }
  if (t.matches('.con-size button')) return setConsole(t.dataset.size);
  if (t.matches('#con-filters .chip')) { const f = t.dataset.f; S.filters[f] = !S.filters[f]; renderConsole(); return; }
  if (t.matches('[data-tpl]')) { const inp = $('#ack-comment'); if (inp) { inp.value = t.dataset.tpl; inp.focus(); } return; }
  const act = t.dataset.act;
  if (act === 'console') return setConsole('panneau');
  if (act === 'expand') { const id = t.dataset.ev; if (S.expanded.has(id)) S.expanded.delete(id); else S.expanded.add(id); renderConsole(); return; }
  if (act === 'ack-open') { S.ackOpen = t.dataset.ev; renderConsole(); $('#ack-comment')?.focus(); return; }
  if (act === 'ack') return acknowledge(t.dataset.ev, $('#ack-comment')?.value);
  if (act === 'ack-from-inspector') { const r = EVENT_BY_ID.get(t.dataset.ev); if (S.console === 'bande') setConsole('panneau'); S.ackOpen = t.dataset.ev; select(r.obj); $('#ack-comment')?.focus(); return; }
  if (act === 'close-inspector') return select(null);
  if (act === 'goto-3d') { setView('physique'); scene?.select(S.sel, { frame: true }); return; }
  if (act === 'goto-metro') return setView('metrologie');
  if (act === 'goto-services') return setView('services');
  if (t.dataset.rp) {
    const r = S.replay; if (!r) return;
    if (t.dataset.rp === 'live') return stopReplay();
    if (t.dataset.rp === 'play') { r.playing = !r.playing; schedulePlay(); renderBand(); return; }
    r.t = Math.max(nowT() - 86400, Math.min(nowT(), r.t + (t.dataset.rp === 'back' ? -60 : 60)));
    renderAll(); return;
  }
  if (t.dataset.speed) { S.replay.speed = Number(t.dataset.speed); schedulePlay(); renderBand(); return; }
  if (t.matches('li[data-i]')) return lensPick(Number(t.dataset.i));
  if (t.dataset.id) {
    const id = t.dataset.id;
    const fromConsole = !!t.closest('#console');
    select(S.sel === id && !fromConsole ? null : id, { frame: S.view === 'physique' && (fromConsole || !!t.closest('#band, #inspector')), from: fromConsole ? 'console' : null });
    if (t.closest('#band')) setConsole('panneau');
  }
});

// sélection au clavier dans les vues SVG
document.addEventListener('keydown', (e) => {
  const inField = e.target.matches('input, textarea');
  if (e.key === 'Escape') {
    if (!$('#help').hidden) { $('#help').hidden = true; return; }
    if (S.mur) return setMur(false);
    if (inField) { e.target.blur(); if (e.target.id === 'lens-q') { e.target.value = ''; lensSearch(''); } return; }
    if (S.ackOpen) { S.ackOpen = null; renderConsole(); return; }
    if (S.sel) return select(null);
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#lens-q').focus(); return; }
  if (e.target.id === 'ack-comment' && e.key === 'Enter') { e.preventDefault(); acknowledge(e.target.dataset.ev, e.target.value); return; }
  if (e.target.id === 'lens-q') {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); lensIdx = (lensIdx + (e.key === 'ArrowDown' ? 1 : -1) + lensItems.length) % Math.max(1, lensItems.length); for (const li of $$('#lens-results li')) li.setAttribute('aria-selected', String(Number(li.dataset.i) === lensIdx)); }
    if (e.key === 'Enter') { e.preventDefault(); lensPick(lensIdx); }
    return;
  }
  if (inField || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === 'Enter' && e.target.closest?.('#console .ev[data-id]')) { e.preventDefault(); const id = e.target.closest('.ev').dataset.id; setView('physique'); select(id, { frame: true, from: 'console' }); return; }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('.v-svg .node[data-id]')) { e.preventDefault(); select(e.target.closest('.node').dataset.id); return; }
  if (S.mur && e.key.toLowerCase() !== 'm') return;
  const k = e.key.toLowerCase();
  if (k >= '1' && k <= '6') return setView(VIEWS[Number(k) - 1]);
  if (k === 'e') return cycleConsole();
  if (k === 'c') return $('#btn-calque').click();
  if (k === 'm') return setMur(!S.mur);
  if (k === 'r') return S.replay ? stopReplay() : startReplay(nowT() - 600);
  if (k === 'f' && S.sel) { setView('physique'); scene?.frame(S.sel); return; }
  if (k === 'h') { setView('physique'); scene?.home(); return; }
  if (k === '/' ) { e.preventDefault(); $('#lens-q').focus(); return; }
  if (k === '?') { $('#help').hidden = false; return; }
  if (k === ' ' && S.replay) { e.preventDefault(); S.replay.playing = !S.replay.playing; schedulePlay(); renderBand(); }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'lens-q') lensSearch(e.target.value);
  if (e.target.id === 'rp-range' && S.replay) { S.replay.t = Number(e.target.value); S.replay.playing = false; schedulePlay(); recompute(); renderHud(); renderConsole(); renderView(); renderInspector(); if (scene) { scene.setState(state); scene.setPins(pinsFor()); } }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'mt-compare') { S.compare = e.target.checked; renderView(); }
  if (e.target.id === 'rp-range') renderBand();
});
$('#mt-period').addEventListener('click', (e) => { const b = e.target.closest('button[data-p]'); if (b) { S.period = b.dataset.p; renderView(); } });
$('#lens-q').addEventListener('blur', () => setTimeout(() => { $('#lens-results').hidden = true; }, 150));
$('#lens-q').addEventListener('focus', (e) => { if (e.target.value) lensSearch(e.target.value); });

// survol : bulles, chaîne de dépendances des services, réticule de métrologie
const stage = $('#stage');
stage.addEventListener('mousemove', (e) => {
  if (S.view === 'metrologie') metroHover(e);
  const r = stage.getBoundingClientRect();
  const tipEl = e.target.closest?.('[data-tip]');
  if (tipEl) { showTip(esc(tipEl.dataset.tip), e.clientX - r.left, e.clientY - r.top); return; }
  const node = e.target.closest?.('.v-svg .node[data-id]');
  if (node) { showTip(tipFor(node.dataset.id), e.clientX - r.left, e.clientY - r.top); return; }
  if (S.view !== 'physique') hideTip();
});
stage.addEventListener('mouseleave', () => { hideTip(); if (S.view === 'metrologie') metroLeave(); });
$('#view-metrologie').addEventListener('mouseleave', metroLeave);
$('#view-services').addEventListener('mouseover', (e) => {
  const node = e.target.closest('.node[data-id]');
  const svg = $('#view-services svg');
  if (!svg) return;
  if (!node) { svg.classList.remove('focus'); return; }
  const rel = V.relatedServices(node.dataset.id);
  svg.classList.add('focus');
  for (const n of svg.querySelectorAll('.node')) n.classList.toggle('rel', rel.has(n.dataset.id));
  for (const ed of svg.querySelectorAll('.edge')) ed.classList.toggle('rel', rel.has(ed.dataset.a) && rel.has(ed.dataset.b));
});
$('#view-services').addEventListener('mouseleave', () => $('#view-services svg')?.classList.remove('focus'));

// ============================================================ démarrage
setView('physique');
renderAll();

const threeUrl = document.querySelector('meta[name="sng-three"]')?.content || 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js';
// les étiquettes 3D sont dessinées en canvas : on attend les polices (1,5 s au plus)
await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]);
createScene($('#scene-host'), {
  threeUrl,
  onPick: (id) => { if (id !== S.sel) select(id); },
  onHover: (id, p) => { if (!id || !p) { hideTip(); return; } showTip(tipFor(id), p.x, p.y, S.mur ? $('#mur-scene') : $('#stage')); },
}).then((sc) => {
  scene = sc;
  window.__sng = { scene, S };
  scene.setState(state);
  scene.setPins(pinsFor());
  scene.select(S.sel);
  if (S.mur) setMur(true);
}).catch((err) => {
  console.error(err);
  const fb = $('#scene-fallback');
  fb.hidden = false;
  fb.textContent = 'La vue 3D n’a pas pu se charger sur ce poste. Les autres vues restent disponibles (touches 2 à 6).';
});

try { if (!localStorage.getItem('sng-refonte-aide')) { $('#help').hidden = false; localStorage.setItem('sng-refonte-aide', '1'); } } catch { /* stockage indisponible */ }
