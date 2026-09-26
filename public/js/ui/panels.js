// Interface autour de la vue 3D : barre du haut, couches, alarmes, collecteurs,
// recherche, infobulle, raccourcis clavier, mode "mur d'ecrans".
import { LAYERS, FLOW_CATEGORIES, STATUS_LABELS } from '/shared/model.js';
import { esc, pct, bps, ago, typeLabel, statusLabel } from './format.js';
import { DetailsPanel } from './details.js';
import { STATUS_COLORS } from '../scene/colors.js';

const COLOR_MODES = [
  ['status', 'Statut'], ['cpu', 'CPU'], ['mem', 'Mémoire'], ['disk', 'Disque'], ['temp', 'Temp.'],
];

export class UI {
  constructor(model, view, config) {
    this.model = model;
    this.view = view;
    this.config = config;
    this.showAcked = false;
    this.$ = (sel) => document.querySelector(sel);
    this.details = new DetailsPanel(this.$('#details'), model, view, {
      select: (id, o) => this.select(id, o),
      selectLink: (id) => this.selectLink(id),
      traceFlow: (id) => this.traceFlow(id),
      clearSelection: () => this.select(null),
      toggleIsolate: () => this.setIsolate(!this.view.isolate),
    });
    this.buildLeft();
    this.buildBottom();
    this.bindSearch();
    this.bindKeys();
    this.bindView();
    this.clock();
    this.updateInsets();
  }

  // ------------------------------------------------------------------ panneau gauche

  buildLeft() {
    const layers = this.$('#layers');
    LAYERS.forEach((l, i) => {
      const row = document.createElement('div');
      row.className = 'toggle on';
      row.dataset.layer = l.id;
      row.title = `Afficher / masquer (touche ${i + 1})`;
      row.innerHTML = `<span class="sw"></span><span>${esc(l.label)}</span><span class="n"></span>`;
      row.addEventListener('click', () => this.toggleLayer(l.id));
      layers.appendChild(row);
    });
    const modes = this.$('#color-modes');
    for (const [id, label] of COLOR_MODES) {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.mode = id;
      if (id === 'status') b.classList.add('active');
      b.addEventListener('click', () => this.setColorMode(id));
      modes.appendChild(b);
    }
    this.$('#explode').addEventListener('input', (ev) => {
      clearTimeout(this.explodeTimer);
      const v = Number(ev.target.value);
      this.explodeTimer = setTimeout(() => this.view.setExplode(v), 60);
    });
    document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => this.view.view(b.dataset.view)));
    this.$('#opt-labels').addEventListener('change', (ev) => this.view.setLabels(ev.target.checked));
    this.$('#opt-isolate').addEventListener('change', (ev) => this.setIsolate(ev.target.checked));
    this.$('#opt-rotate').addEventListener('change', (ev) => this.view.setAutoRotate(ev.target.checked));
    this.$('#opt-eco').addEventListener('change', (ev) => { this.view.fpsCap = ev.target.checked ? 30 : 0; });
    this.$('#left-toggle').addEventListener('click', () => {
      this.$('#left').classList.toggle('collapsed');
      this.updateInsets();
    });
    this.renderLegend();
  }

  toggleLayer(id) {
    const on = !this.view.layers[id];
    this.view.setLayer(id, on);
    document.querySelector(`.toggle[data-layer="${id}"]`)?.classList.toggle('on', on);
  }

  setColorMode(mode) {
    this.view.setColorMode(mode);
    document.querySelectorAll('#color-modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    this.renderLegend();
  }

  setIsolate(on) {
    this.$('#opt-isolate').checked = on;
    this.view.setIsolate(on);
    this.details.render();
  }

  renderLegend() {
    const mode = this.view.colorMode;
    let html = '';
    if (mode === 'status') {
      html += ['ok', 'warning', 'critical', 'off', 'unknown'].map((s) => `<div class="row"><i class="dot s-${s}"></i>${esc(STATUS_LABELS[s])}</div>`).join('');
    } else {
      const unit = mode === 'temp' ? ['20 °C', '85 °C'] : ['0 %', '100 %'];
      html += `<div class="grad"></div><div class="grad-l"><span>${unit[0]}</span><span>${unit[1]}</span></div>`;
    }
    html += '<div style="height:8px"></div>';
    html += Object.values(FLOW_CATEGORIES).map((c) => `<div class="row"><i class="sw-line" style="background:${c.color}"></i>${esc(c.label)}</div>`).join('');
    html += '<div class="row"><i class="sw-line" style="background:linear-gradient(90deg,#38bdf8,#22c55e,#eab308,#ef4444)"></i>Câble : utilisation</div>';
    this.$('#legend').innerHTML = html;
  }

  // ------------------------------------------------------------------ bas : alarmes / collecteurs

  buildBottom() {
    document.querySelectorAll('#bottom .tab').forEach((t) => t.addEventListener('click', () => {
      document.querySelectorAll('#bottom .tab').forEach((x) => x.classList.toggle('active', x === t));
      this.$('#tab-alarms').hidden = t.dataset.tab !== 'alarms';
      this.$('#tab-collectors').hidden = t.dataset.tab !== 'collectors';
      this.$('#bottom').classList.remove('collapsed');
    }));
    this.$('#bottom-toggle').addEventListener('click', () => {
      const b = this.$('#bottom');
      b.classList.toggle('collapsed');
      document.documentElement.style.setProperty('--bottom-h', b.classList.contains('collapsed') ? '38px' : '176px');
      this.updateInsets();
    });
    this.$('#show-acked').addEventListener('change', (ev) => { this.showAcked = ev.target.checked; this.renderAlarms(); });
    this.$('#tab-alarms').addEventListener('click', async (ev) => {
      const ack = ev.target.closest('.ack');
      if (ack) {
        ev.stopPropagation();
        const acked = ack.dataset.acked === '1';
        await fetch(`/api/alarms/${encodeURIComponent(ack.dataset.id)}/ack`, { method: acked ? 'DELETE' : 'POST' });
        return;
      }
      const row = ev.target.closest('tr[data-entity]');
      if (!row) return;
      if (row.dataset.link) this.selectLink(row.dataset.link);
      else this.select(row.dataset.entity, { fly: true });
    });
    this.$('#tab-collectors').addEventListener('click', () => {});
    setInterval(() => { this.renderAlarms(); this.renderCollectors(); }, 15000);
  }

  renderAlarms() {
    const all = this.model.alarms;
    const list = this.showAcked ? all : all.filter((a) => !a.acked);
    const crit = all.filter((a) => a.severity === 'critical' && !a.acked).length;
    const warn = all.filter((a) => a.severity === 'warning' && !a.acked).length;
    const cnt = this.$('#alarm-count');
    cnt.textContent = crit + warn;
    cnt.className = `count ${crit ? 'crit' : warn ? 'warn' : ''}`;
    const body = this.$('#tab-alarms');
    if (!list.length) {
      body.innerHTML = `<div class="empty"><b>Aucune alarme active.</b> ${all.length ? `(${all.length} acquittée${all.length > 1 ? 's' : ''})` : ''}</div>`;
      return;
    }
    body.innerHTML = `<table class="grid"><thead><tr><th>Sévérité</th><th>Depuis</th><th>Élément</th><th>Type</th><th>Message</th><th></th></tr></thead><tbody>${list.map((a) => `
      <tr class="clickable sev-${esc(a.severity)} ${a.acked ? 'acked' : ''}" data-entity="${esc(a.entity || '')}" ${a.link ? `data-link="${esc(a.link)}"` : ''}>
        <td><i class="dot s-${esc(a.severity)}"></i> ${esc(statusLabel(a.severity))}</td>
        <td class="muted" title="${esc(a.since)}">${ago(a.since)}</td>
        <td><b>${esc(a.name || a.entity)}</b></td>
        <td class="muted">${esc(a.type === 'link' ? 'Lien' : typeLabel(a.type))}</td>
        <td>${esc(a.message)}</td>
        <td><button class="ack" data-id="${esc(a.id)}" data-acked="${a.acked ? 1 : 0}">${a.acked ? 'Réactiver' : 'Acquitter'}</button></td>
      </tr>`).join('')}</tbody></table>`;
  }

  renderCollectors() {
    const list = this.model.collectors || [];
    const errors = list.filter((c) => c.state === 'error').length;
    const cnt = this.$('#collector-count');
    cnt.textContent = list.length;
    cnt.className = `count ${errors ? 'crit' : ''}`;
    const stateDot = (s) => (s === 'ok' ? 'ok' : s === 'error' ? 'critical' : s === 'starting' ? 'unknown' : 'off');
    this.$('#tab-collectors').innerHTML = list.length ? `<table class="grid"><thead><tr><th>État</th><th>Nom</th><th>Type</th><th>Dernière collecte</th><th>Durée</th><th>Entités</th><th>Liens</th><th>Flux</th><th>Erreur</th></tr></thead><tbody>${list.map((c) => `
      <tr>
        <td><i class="dot s-${stateDot(c.state)}"></i> ${esc(c.state === 'ok' ? 'OK' : c.state === 'error' ? 'Erreur' : c.state || '–')}</td>
        <td><b>${esc(c.name)}</b>${c.simulated ? ' <span class="muted">(simulé)</span>' : ''}</td>
        <td class="mono">${esc(c.type)}</td>
        <td class="muted">${ago(c.lastSuccess || c.lastRun)}</td>
        <td class="muted">${c.lastDurationMs != null ? `${c.lastDurationMs} ms` : '–'}</td>
        <td>${c.counts?.entities ?? '–'}</td><td>${c.counts?.links ?? '–'}</td><td>${c.counts?.flows ?? '–'}</td>
        <td style="color:#fca5a5">${esc(c.lastError || '')}</td>
      </tr>`).join('')}</tbody></table>` : '<div class="empty">Aucun collecteur configuré.</div>';
  }

  renderHealth() {
    const c = this.model.counts();
    const crit = c.critical || 0;
    const items = [
      ['critical', crit, 'critiques'], ['warning', c.warning || 0, 'avertissements'], ['ok', c.ok || 0, 'OK'],
      ['off', c.off || 0, 'arrêtés'], ['unknown', c.unknown || 0, 'inconnus'],
    ];
    this.$('#health').innerHTML = items.map(([s, n, label]) =>
      `<span class="pill ${s === 'critical' && n ? 'hot' : ''}" title="${esc(STATUS_LABELS[s])}" data-status="${s}"><i class="s-${s}"></i><b>${n}</b><span>${label}</span></span>`).join('');
  }

  renderLayerCounts() {
    const counts = {};
    for (const e of this.model.entities.values()) counts[e.layer] = (counts[e.layer] || 0) + 1;
    counts.flow = this.model.flows.size;
    counts.network = (counts.network || 0);
    for (const row of document.querySelectorAll('#layers .toggle')) {
      const n = counts[row.dataset.layer];
      row.querySelector('.n').textContent = n ? n : '';
    }
  }

  // ------------------------------------------------------------------ mise a jour

  update(flags) {
    if (flags.structure || flags.metrics || flags.alarms) this.renderHealth();
    if (flags.structure || flags.flows) this.renderLayerCounts();
    if (flags.alarms || flags.structure) this.renderAlarms();
    if (flags.collectors) this.renderCollectors();
    if (this.details.current) this.details.refresh();
    if (this.view.selectedFlow && !this.model.flows.has(this.view.selectedFlow)) {
      /* le flux a disparu : on garde l'affichage du chemin tel quel */
    }
    if (this.pendingSelect && this.model.get(this.pendingSelect)) {
      const id = this.pendingSelect;
      this.pendingSelect = null;
      this.select(id, { fly: true });
    }
  }

  /** Informe la vue 3D de la place prise par les panneaux. */
  updateInsets() {
    const kiosk = document.body.classList.contains('kiosk');
    const left = this.$('#left').classList.contains('collapsed') || kiosk ? 0 : 270;
    const right = this.$('#details').hidden ? 0 : (kiosk ? 360 : 400);
    const bottom = this.$('#bottom').classList.contains('collapsed') ? 56 : (kiosk ? 170 : 196);
    this.view.setInsets({ left, right, top: 56, bottom });
  }

  setConn(state) {
    const c = this.$('#conn');
    c.dataset.state = state;
    c.querySelector('span').textContent = state === 'live' ? 'Temps réel' : state === 'error' ? 'Reconnexion…' : 'Connexion…';
  }

  // ------------------------------------------------------------------ selection

  select(id, opts = {}) {
    if (id && this.model.get(id)) {
      this.details.showEntity(id);
      history.replaceState(null, '', `#sel=${encodeURIComponent(id)}`);
    } else {
      this.details.hide();
      history.replaceState(null, '', location.pathname + location.search);
    }
    this.updateInsets();
    this.view.select(id, opts);
  }

  selectLink(linkId) {
    this.details.showLink(linkId);
    this.updateInsets();
    this.view.selectLink(linkId);
  }

  traceFlow(flowId) {
    const back = this.details.current?.kind === 'entity' ? this.details.current.id : null;
    const path = this.view.traceFlow(flowId);
    if (path) this.details.showFlow(flowId, path, back);
    this.updateInsets();
  }

  bindView() {
    this.view.addEventListener('pick', (ev) => {
      const hit = ev.detail;
      if (!hit) { this.select(null); return; }
      if (hit.entity) this.select(hit.entity);
      else if (hit.link) this.selectLink(hit.link);
      else if (hit.flow) this.traceFlow(hit.flow);
    });
    const tip = this.$('#tooltip');
    this.view.addEventListener('hover', (ev) => {
      const { hit, x, y } = ev.detail;
      const html = hit ? this.tooltipHtml(hit) : null;
      if (!html) { tip.hidden = true; return; }
      tip.innerHTML = html;
      tip.hidden = false;
      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      tip.style.left = `${Math.min(window.innerWidth - w - 8, x + 14)}px`;
      tip.style.top = `${Math.min(window.innerHeight - h - 8, y + 14)}px`;
    });
    this.view.addEventListener('interact', () => {
      if (this.kioskOn) this.kioskPauseUntil = Date.now() + 60000;
    });
  }

  tooltipHtml(hit) {
    if (hit.entity) {
      const e = this.model.get(hit.entity);
      if (!e) return null;
      const m = e.metrics || {};
      const row = [];
      if (m.cpu != null) row.push(`CPU ${pct(m.cpu)}`);
      if (m.mem != null) row.push(`Mém. ${pct(m.mem)}`);
      if (m.disk != null) row.push(`Disque ${pct(m.disk)}`);
      if (m.temp != null) row.push(`${Math.round(m.temp)} °C`);
      if (m.latencyMs != null) row.push(`${m.latencyMs} ms`);
      const agg = this.model.agg.get(e.id);
      const st = ['rack', 'room', 'site'].includes(e.type) ? agg : e.status;
      const ip = (e.attrs?.ip || [])[0];
      return `<div class="t-type">${esc(typeLabel(e.type))}${e.attrs?.role ? ` · ${esc(e.attrs.role)}` : ''}</div>
        <div class="t-name"><i class="dot s-${esc(st)}"></i> ${esc(e.name)}</div>
        ${row.length || ip ? `<div class="t-row">${ip ? `<span class="mono">${esc(ip)}</span>` : ''}${row.map((r) => `<span>${r}</span>`).join('')}</div>` : ''}
        ${e.statusText ? `<div class="t-txt">${esc(e.statusText)}</div>` : ''}`;
    }
    if (hit.link) {
      const l = this.model.links.get(hit.link);
      if (!l) return null;
      const n = (id) => esc(this.model.get(id)?.name || id);
      return `<div class="t-type">Lien${l.label ? ` · ${esc(l.label)}` : ''}</div><div class="t-name"><i class="dot s-${esc(l.status)}"></i> ${n(l.a)} ↔ ${n(l.b)}</div>
        <div class="t-row"><span>${l.speedBps ? bps(l.speedBps) : ''}</span>${l.metrics?.util != null ? `<span>Utilisation ${pct(l.metrics.util)}</span>` : ''}</div>
        ${l.statusText ? `<div class="t-txt">${esc(l.statusText)}</div>` : ''}`;
    }
    if (hit.flow) {
      const f = this.model.flows.get(hit.flow);
      if (!f) return null;
      const n = (id) => esc(this.model.get(id)?.name || id);
      const cat = FLOW_CATEGORIES[f.category] || FLOW_CATEGORIES.other;
      return `<div class="t-type">Flux · ${esc(cat.label)}</div><div class="t-name">${n(f.src)} → ${n(f.dst)}</div>
        <div class="t-row"><span>${esc(f.app || f.proto)}${f.port ? `/${f.port}` : ''}</span><span>${f.bps != null ? bps(f.bps) : ''}</span></div>`;
    }
    return null;
  }

  // ------------------------------------------------------------------ recherche

  bindSearch() {
    const input = this.$('#search');
    const list = this.$('#search-results');
    let results = [];
    let active = 0;
    const render = () => {
      if (!results.length) { list.hidden = true; return; }
      list.hidden = false;
      list.innerHTML = results.map((e, i) => `<li class="${i === active ? 'active' : ''}" data-id="${esc(e.id)}"><i class="dot s-${esc(e.status)}"></i>${esc(e.name)}<span class="type">${esc(typeLabel(e.type))}</span></li>`).join('');
    };
    input.addEventListener('input', () => {
      results = this.model.search(input.value);
      active = 0;
      render();
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown') { active = Math.min(results.length - 1, active + 1); render(); ev.preventDefault(); }
      else if (ev.key === 'ArrowUp') { active = Math.max(0, active - 1); render(); ev.preventDefault(); }
      else if (ev.key === 'Enter' && results[active]) { this.select(results[active].id, { fly: true }); list.hidden = true; input.blur(); }
      else if (ev.key === 'Escape') { input.value = ''; results = []; render(); input.blur(); }
    });
    list.addEventListener('mousedown', (ev) => {
      const li = ev.target.closest('li[data-id]');
      if (!li) return;
      ev.preventDefault();
      this.select(li.dataset.id, { fly: true });
      list.hidden = true;
      input.blur();
    });
    input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
    input.addEventListener('focus', () => { if (results.length) render(); });
  }

  // ------------------------------------------------------------------ clavier

  bindKeys() {
    window.addEventListener('keydown', (ev) => {
      if (ev.target.matches('input, textarea, select')) return;
      if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
      const k = ev.key;
      if (k === '/') { ev.preventDefault(); this.$('#search').focus(); }
      else if (k === 'Escape') this.select(null);
      else if (k === 'f' || k === 'F') { if (this.view.selected) this.view.focusEntity(this.view.selected); }
      else if (k === 'i' || k === 'I') this.setIsolate(!this.view.isolate);
      else if (k === 'r' || k === 'R') this.view.view('overview');
      else if (k === 't' || k === 'T') this.view.view('top');
      else if (k === 'k' || k === 'K') this.setKiosk(!this.kioskOn);
      else if (k === 'c' || k === 'C') {
        const i = COLOR_MODES.findIndex(([id]) => id === this.view.colorMode);
        this.setColorMode(COLOR_MODES[(i + 1) % COLOR_MODES.length][0]);
      } else if (/^[1-7]$/.test(k)) this.toggleLayer(LAYERS[Number(k) - 1].id);
    });
  }

  // ------------------------------------------------------------------ mur d'ecrans

  setKiosk(on) {
    this.kioskOn = on;
    document.body.classList.toggle('kiosk', on);
    this.updateInsets();
    this.view.setAutoRotate(on);
    this.$('#opt-rotate').checked = on;
    clearInterval(this.kioskTimer);
    if (!on) return;
    let i = 0;
    this.kioskTimer = setInterval(() => {
      if (this.kioskPauseUntil && Date.now() < this.kioskPauseUntil) return;
      const alarms = this.model.alarms.filter((a) => !a.acked && a.entity && this.model.get(a.entity));
      if (!alarms.length) {
        if (this.view.selected) this.select(null);
        this.view.view('overview');
        this.view.setAutoRotate(true);
        return;
      }
      const a = alarms[i++ % alarms.length];
      this.view.setAutoRotate(false);
      this.select(a.entity, { fly: true });
    }, 12000);
  }

  clock() {
    const c = this.$('#clock');
    const tick = () => { c.textContent = new Date().toLocaleTimeString('fr-FR'); };
    tick();
    setInterval(tick, 1000);
  }
}
