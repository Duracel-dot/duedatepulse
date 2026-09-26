// Formatage (fr-FR) et petits utilitaires DOM.
import { ENTITY_TYPES, STATUS_LABELS, formatBps } from '/shared/model.js';

const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function num(v, digits = 1) {
  if (v == null || !Number.isFinite(Number(v))) return '–';
  return digits === 0 ? nf0.format(v) : nf1.format(v);
}

export function pct(v) {
  return v == null ? '–' : `${num(v, v >= 10 ? 0 : 1)} %`;
}

export function bps(v) {
  return v == null ? '–' : formatBps(v).replace('.', ',');
}

export function duration(s) {
  if (s == null) return '–';
  s = Math.round(s);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d} j ${h} h`;
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min`;
  return `${s} s`;
}

export function ago(iso) {
  if (!iso) return '–';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 5) return 'à l’instant';
  if (s < 60) return `il y a ${Math.round(s)} s`;
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return `il y a ${Math.round(s / 86400)} j`;
}

export function dateTime(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });
}

export function typeLabel(type) {
  return ENTITY_TYPES[type]?.label || type;
}

export function statusLabel(s) {
  return STATUS_LABELS[s] || s;
}

export function statusPill(s) {
  return `<span class="status ${esc(s)}"><i class="dot s-${esc(s)}"></i>${esc(statusLabel(s))}</span>`;
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** Mini-graphe SVG d'une serie. */
export function sparkline(values, { max = 100, color = '#38bdf8', height = 26 } = {}) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null);
  if (pts.length < 2) return '';
  const n = values.length - 1 || 1;
  const hi = Math.max(max ?? 0, ...pts.map(([, v]) => v)) || 1;
  const w = 100;
  const d = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${((i / n) * w).toFixed(1)},${(height - 2 - (v / hi) * (height - 4)).toFixed(1)}`).join('');
  const area = `${d}L${((pts[pts.length - 1][0] / n) * w).toFixed(1)},${height}L${((pts[0][0] / n) * w).toFixed(1)},${height}Z`;
  return `<svg viewBox="0 0 ${w} ${height}" preserveAspectRatio="none"><path d="${area}" fill="${color}" opacity=".15"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>`;
}
