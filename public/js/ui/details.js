// Panneau de detail : entite, lien ou flux selectionne.
import { FLOW_CATEGORIES, statusRank, formatBps } from '/shared/model.js';
import { esc, num, pct, bps, duration, dateTime, typeLabel, statusPill, sparkline } from './format.js';

const ATTR_LABELS = {
  role: 'Rôle', app: 'Application', vendor: 'Constructeur', model: 'Modèle', serial: 'N° de série',
  hostname: 'Nom d’hôte', os: 'Système', osVersion: 'Version du système', domain: 'Domaine', ip: 'Adresses IP', mac: 'Adresses MAC',
  hypervisor: 'Hyperviseur', version: 'Version', cluster: 'Cluster', connectionState: 'Connexion', cpuCores: 'Cœurs',
  memGB: 'Mémoire (Go)', memDemandGB: 'Mémoire demandée (Go)', vmCount: 'VM hébergées', powerState: 'Alimentation',
  generation: 'Génération', replication: 'Réplication', networks: 'Réseaux virtuels', vlan: 'VLAN', vmid: 'VMID',
  migration: 'Migration', restart: 'Événement', psu: 'Alimentations', u: 'Position (U)', height: 'Hauteur (U)',
  units: 'Capacité (U)', row: 'Rangée', location: 'Localisation', capacityTB: 'Capacité (To)', kind: 'Nature',
  cidrs: 'Réseaux', sysDescr: 'Description', lastBoot: 'Dernier démarrage', stoppedServices: 'Services arrêtés',
  portsUp: 'Ports actifs', portsTotal: 'Ports', guestOS: 'Système invité', uptime: 'Disponibilité',
};
const HIDDEN_ATTRS = new Set(['order', 'rowIndex', 'slot', 'pos', 'rotation', 'synthetic', 'default', 'interfaces', 'disks', 'storages', 'vSwitches', 'attrs']);
const METRIC_DEFS = {
  temp: ['Température', (v) => `${num(v)} °C`],
  powerW: ['Puissance', (v) => `${num(v, 0)} W`],
  latencyMs: ['Latence', (v) => `${num(v)} ms`],
  rxBps: ['Débit entrant', bps],
  txBps: ['Débit sortant', bps],
  uptimeS: ['Disponibilité', duration],
  iops: ['IOPS', (v) => num(v, 0)],
  load: ['Charge', pct],
  battery: ['Batterie', pct],
  runtimeMin: ['Autonomie', (v) => `${num(v, 0)} min`],
  portsUp: ['Ports actifs', (v) => num(v, 0)],
  loss: ['Pertes', pct],
};

export class DetailsPanel {
  constructor(root, model, view, api) {
    this.root = root;
    this.body = root.querySelector('#details-body');
    this.model = model;
    this.view = view;
    this.api = api;
    this.current = null;
    this.history = null;
    this.historyTimer = null;
    root.querySelector('#details-close').addEventListener('click', () => api.clearSelection());
    this.body.addEventListener('click', (ev) => this.onClick(ev));
  }

  onClick(ev) {
    const a = ev.target.closest('[data-go],[data-link],[data-flow],[data-act]');
    if (!a) return;
    if (a.dataset.go) this.api.select(a.dataset.go, { fly: true });
    else if (a.dataset.link) this.api.selectLink(a.dataset.link);
    else if (a.dataset.flow) this.api.traceFlow(a.dataset.flow);
    else if (a.dataset.act === 'focus' && this.current?.id) this.view.focusEntity(this.current.id);
    else if (a.dataset.act === 'isolate') this.api.toggleIsolate();
    else if (a.dataset.act === 'back' && this.current?.back) this.api.select(this.current.back, { fly: false });
  }

  hide() {
    this.current = null;
    this.root.hidden = true;
    clearInterval(this.historyTimer);
  }

  showEntity(id) {
    const changed = this.current?.kind !== 'entity' || this.current.id !== id;
    this.current = { kind: 'entity', id };
    this.root.hidden = false;
    if (changed) {
      this.history = null;
      this.body.scrollTop = 0;
      clearInterval(this.historyTimer);
      this.loadHistory(id);
      this.historyTimer = setInterval(() => this.loadHistory(id), 10000);
    }
    this.render();
  }

  showLink(linkId) {
    this.current = { kind: 'link', id: linkId };
    clearInterval(this.historyTimer);
    this.root.hidden = false;
    this.render();
  }

  showFlow(flowId, path, back) {
    this.current = { kind: 'flow', id: flowId, path, back };
    clearInterval(this.historyTimer);
    this.root.hidden = false;
    this.render();
  }

  async loadHistory(id) {
    try {
      const r = await fetch(`/api/entities/${encodeURIComponent(id)}`);
      if (!r.ok) return;
      const data = await r.json();
      if (this.current?.id !== id) return;
      this.history = data.history;
      this.render();
    } catch { /* hors ligne */ }
  }

  refresh() {
    if (!this.current) return;
    if (this.current.kind === 'entity' && !this.model.get(this.current.id)) { this.api.clearSelection(); return; }
    this.render();
  }

  render() {
    const c = this.current;
    if (!c) return;
    const scroll = this.body.scrollTop;
    if (c.kind === 'entity') this.body.innerHTML = this.entityHtml(this.model.get(c.id));
    else if (c.kind === 'link') this.body.innerHTML = this.linkHtml(this.model.links.get(c.id));
    else this.body.innerHTML = this.flowHtml(this.model.flows.get(c.id), this.view.tracePath || c.path, c.back);
    this.body.scrollTop = scroll;
  }

  name(id) {
    return esc(this.model.get(id)?.name || id);
  }

  entityHtml(e) {
    if (!e) return '<p class="muted">Élément disparu.</p>';
    const m = this.model;
    const anc = m.ancestors(e.id);
    const parts = [];
    parts.push(`<div class="d-type">${esc(typeLabel(e.type))}${e.attrs?.cluster && e.type !== 'vm' ? ` · ${esc(e.attrs.cluster)}` : ''}</div>`);
    parts.push(`<div class="d-name">${esc(e.name)}</div>`);
    if (['site', 'room', 'rack'].includes(e.type)) {
      parts.push(`${statusPill(m.agg.get(e.id) || 'unknown')} <span class="muted" style="font-size:11px">état agrégé du contenu</span>`);
    } else {
      parts.push(statusPill(e.status));
    }
    if (e.statusText) parts.push(`<div class="d-text ${esc(e.status)}">${esc(e.statusText)}</div>`);
    if (anc.length) {
      parts.push(`<div class="crumbs">${anc.map((a) => `<a data-go="${esc(a.id)}">${esc(a.name)}</a>`).join('<span>›</span>')}<span>›</span><span>${esc(e.name)}</span></div>`);
    }

    // jauges
    const g = [];
    const h = this.history || {};
    for (const [k, label, col] of [['cpu', 'CPU', '#38bdf8'], ['mem', 'Mémoire', '#a78bfa'], ['disk', 'Disque', '#fb923c']]) {
      const v = e.metrics?.[k];
      if (v == null) continue;
      const barCol = v >= 95 ? 'var(--critical)' : v >= 85 ? 'var(--warning)' : col;
      g.push(`<div class="gauge"><div class="l">${label}</div><div class="v">${pct(v)}</div><div class="bar"><i style="width:${Math.min(100, v)}%;background:${barCol}"></i></div>${h[k] ? sparkline(h[k], { color: col }) : ''}</div>`);
    }
    if (g.length) parts.push(`<div class="d-sec"><div class="gauges">${g.join('')}</div></div>`);

    const mrows = [];
    for (const [k, [label, fmt]] of Object.entries(METRIC_DEFS)) {
      const v = e.metrics?.[k];
      if (v == null) continue;
      const spark = (k === 'rxBps' || k === 'txBps' || k === 'temp' || k === 'latencyMs') && h[k] ? sparkline(h[k], { max: null, color: '#22d3ee', height: 18 }) : '';
      mrows.push(`<dt>${label}</dt><dd>${fmt(v)}${spark}</dd>`);
    }
    if (mrows.length) parts.push(`<div class="d-sec"><h4>Mesures</h4><dl class="kv">${mrows.join('')}</dl></div>`);

    // attributs
    const arows = [];
    for (const [k, v] of Object.entries(e.attrs || {})) {
      if (HIDDEN_ATTRS.has(k) || v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
      if (typeof v === 'object' && !Array.isArray(v)) continue;
      const label = ATTR_LABELS[k] || k;
      const val = Array.isArray(v)
        ? v.map((x) => (x && typeof x === 'object' ? Object.values(x).filter((y) => y != null && y !== '').join(' ') : x)).join(', ')
        : typeof v === 'boolean' ? (v ? 'oui' : 'non') : v;
      arows.push(`<dt>${esc(label)}</dt><dd>${esc(val)}</dd>`);
    }
    if (arows.length) parts.push(`<div class="d-sec"><h4>Caractéristiques</h4><dl class="kv">${arows.join('')}</dl></div>`);
    if (Array.isArray(e.attrs?.disks) && e.attrs.disks.length) {
      parts.push(`<div class="d-sec"><h4>Disques</h4><div class="list">${e.attrs.disks.map((d) => `<div class="item"><span class="grow mono">${esc(d.id)}</span><span class="r">${num(d.freeGB, 0)} Go libres / ${num(d.sizeGB, 0)} Go · ${pct(d.usedPct)}</span></div>`).join('')}</div></div>`);
    }
    if (Array.isArray(e.attrs?.storages) && e.attrs.storages.length) {
      parts.push(`<div class="d-sec"><h4>Stockages</h4><div class="list">${e.attrs.storages.map((d) => `<div class="item"><span class="grow">${esc(d.name)}</span><span class="r">${pct(d.usedPct)}</span></div>`).join('')}</div></div>`);
    }

    // enfants
    const kids = (m.children.get(e.id) || []).map((id) => m.get(id)).filter(Boolean)
      .sort((a, b) => statusRank(b.status) - statusRank(a.status) || (b.attrs?.u ?? 0) - (a.attrs?.u ?? 0) || String(a.name).localeCompare(String(b.name), 'fr', { numeric: true }));
    if (kids.length) {
      const title = { site: 'Salles', room: 'Baies', rack: 'Équipements', server: 'Système / hyperviseur', hypervisor: 'Machines virtuelles' }[e.type] || 'Contenu';
      const shown = kids.slice(0, 40);
      parts.push(`<div class="d-sec"><h4>${title} <span class="n">${kids.length}</span></h4><div class="list">${shown.map((k) => {
        const right = k.metrics?.cpu != null ? `CPU ${pct(k.metrics.cpu)}` : k.attrs?.u != null ? `U${k.attrs.u}` : esc(typeLabel(k.type));
        return `<div class="item" data-go="${esc(k.id)}"><i class="dot s-${esc(k.status)}"></i><span class="grow">${esc(k.name)}</span><span class="r">${right}</span></div>`;
      }).join('')}${kids.length > shown.length ? `<div class="item more">… ${kids.length - shown.length} autres</div>` : ''}</div></div>`);
    }

    // liens physiques
    const links = [...m.links.values()].filter((l) => l.a === e.id || l.b === e.id)
      .sort((a, b) => statusRank(b.status) - statusRank(a.status) || (b.metrics?.util ?? 0) - (a.metrics?.util ?? 0));
    if (links.length) {
      parts.push(`<div class="d-sec"><h4>Connexions <span class="n">${links.length}</span></h4><div class="list">${links.slice(0, 30).map((l) => {
        const mine = l.a === e.id ? l.aPort : l.bPort;
        const peer = l.a === e.id ? l.b : l.a;
        const peerPort = l.a === e.id ? l.bPort : l.aPort;
        return `<div class="item" data-link="${esc(l.id)}"><i class="dot s-${esc(l.status)}"></i><span class="grow"><span class="mono">${esc(mine || '·')}</span> → ${this.name(peer)}${peerPort ? ` <span class="mono muted">${esc(peerPort)}</span>` : ''}</span><span class="r">${l.speedBps ? formatBps(l.speedBps).replace(/\.0+ /, ' ').replace('bit/s', 'b') : ''}${l.metrics?.util != null ? ` · ${pct(l.metrics.util)}` : ''}</span></div>`;
      }).join('')}</div></div>`);
    }

    // flux
    const scope = new Set([e.id, ...m.descendants(e.id)]);
    const flows = [...m.flows.values()].filter((f) => scope.has(f.src) || scope.has(f.dst)).sort((a, b) => (b.bps || 0) - (a.bps || 0));
    if (flows.length) {
      parts.push(`<div class="d-sec"><h4>Flux <span class="n">${flows.length}</span></h4><div class="list">${flows.slice(0, 25).map((f) => {
        const out = scope.has(f.src);
        const peer = out ? f.dst : f.src;
        const cat = FLOW_CATEGORIES[f.category] || FLOW_CATEGORIES.other;
        return `<div class="item" data-flow="${esc(f.id)}" title="Tracer le chemin"><i class="cat" style="background:${cat.color}"></i><span class="grow">${out ? '→' : '←'} ${this.name(peer)} <span class="muted">${esc(f.app || f.proto)}${f.port ? `/${f.port}` : ''}</span></span><span class="r">${f.bps != null ? bps(f.bps) : `${f.conns || 1} cnx`}</span></div>`;
      }).join('')}</div></div>`);
    }

    parts.push(`<div class="d-sec"><h4>Sources</h4><div class="srcs">${(e.sources || []).map((s) => `<span>${esc(s)}</span>`).join('')}</div>${e.updatedAt ? `<div class="muted" style="margin-top:6px;font-size:11px">Mis à jour : ${dateTime(e.updatedAt)}</div>` : ''}</div>`);
    parts.push(`<div class="d-actions"><button class="btn" data-act="focus">Centrer (F)</button><button class="btn" data-act="isolate">${this.view.isolate ? 'Tout afficher' : 'Isoler'} (I)</button></div>`);
    return parts.join('');
  }

  linkHtml(l) {
    if (!l) return '<p class="muted">Lien disparu.</p>';
    const rows = [
      ['Extrémité A', `<a data-go="${esc(l.a)}">${this.name(l.a)}</a>${l.aPort ? ` <span class="mono">${esc(l.aPort)}</span>` : ''}`],
      ['Extrémité B', `<a data-go="${esc(l.b)}">${this.name(l.b)}</a>${l.bPort ? ` <span class="mono">${esc(l.bPort)}</span>` : ''}`],
      ['Nature', esc(l.kind || '–')],
      ['Débit nominal', l.speedBps ? bps(l.speedBps) : '–'],
      ['Utilisation', pct(l.metrics?.util)],
      ['Trafic A → B', bps(l.metrics?.txBps)],
      ['Trafic B → A', bps(l.metrics?.rxBps)],
    ];
    if (l.metrics?.errors != null) rows.push(['Erreurs', num(l.metrics.errors, 0)]);
    if (l.label) rows.unshift(['Libellé', esc(l.label)]);
    return `<div class="d-type">Lien physique</div><div class="d-name">${this.name(l.a)} ↔ ${this.name(l.b)}</div>${statusPill(l.status)}
      ${l.statusText ? `<div class="d-text ${esc(l.status)}">${esc(l.statusText)}</div>` : ''}
      <div class="d-sec"><dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></div>
      <div class="d-sec"><h4>Sources</h4><div class="srcs">${(l.sources || []).map((s) => `<span>${esc(s)}</span>`).join('')}</div></div>`;
  }

  flowHtml(f, path, back) {
    if (!f) return '<p class="muted">Flux terminé.</p>';
    const cat = FLOW_CATEGORIES[f.category] || FLOW_CATEGORIES.other;
    const hops = [];
    if (path) {
      const linkBetween = (a, b) => path.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
      path.entities.forEach((id, i) => {
        const e = this.model.get(id);
        hops.push(`<div class="hop" data-go="${esc(id)}"><span class="grow">${esc(e?.name || id)}</span><span class="muted" style="margin-left:auto;font-size:11px">${esc(typeLabel(e?.type))}</span></div>`);
        const next = path.entities[i + 1];
        const l = next && linkBetween(id, next);
        if (l) {
          const util = l.metrics?.util;
          hops.push(`<div class="via">${esc((l.a === id ? l.aPort : l.bPort) || '')} → ${esc((l.a === id ? l.bPort : l.aPort) || '')} · ${l.speedBps ? bps(l.speedBps) : ''}${util != null ? ` · ${pct(util)}` : ''}</div>`);
        }
      });
    }
    return `<div class="d-type">Flux · ${esc(cat.label)}</div>
      <div class="d-name">${this.name(f.src)} → ${this.name(f.dst)}</div>
      <div class="d-sec"><dl class="kv">
        <dt>Application</dt><dd>${esc(f.app || '–')}</dd>
        <dt>Protocole / port</dt><dd>${esc(f.proto || '–')}${f.port ? ` / ${f.port}` : ''}</dd>
        <dt>Débit</dt><dd>${f.bps != null ? bps(f.bps) : 'non mesuré'}</dd>
        ${f.pps != null ? `<dt>Paquets/s</dt><dd>${num(f.pps, 0)}</dd>` : ''}
        ${f.conns != null ? `<dt>Connexions</dt><dd>${num(f.conns, 0)}</dd>` : ''}
        ${f.process ? `<dt>Processus serveur</dt><dd class="mono">${esc(f.process)}</dd>` : ''}
        ${f.clientProcess ? `<dt>Processus client</dt><dd class="mono">${esc(f.clientProcess)}</dd>` : ''}
        <dt>Sources</dt><dd>${esc((f.sources || []).join(', '))}</dd>
      </dl></div>
      <div class="d-sec"><h4>Chemin de bout en bout ${path && !path.complete ? '<span class="n">(partiel : liens inconnus)</span>' : ''}</h4><div class="path">${hops.join('')}</div></div>
      ${back ? '<div class="d-actions"><button class="btn" data-act="back">← Retour</button></div>' : ''}`;
  }
}
