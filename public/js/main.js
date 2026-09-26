// Demarrage de la vue SupervisionNG.
import { TopologyModel, connect } from './data.js';
import { SceneView } from './scene/view.js';
import { UI } from './ui/panels.js';

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function main() {
  if (!webglAvailable()) {
    document.getElementById('webgl-error').hidden = false;
    document.getElementById('loading').hidden = true;
    return;
  }
  let config = { title: 'SupervisionNG' };
  try {
    config = await (await fetch('/api/config')).json();
  } catch { /* valeurs par defaut */ }
  document.title = config.title || 'SupervisionNG';
  document.getElementById('demo-badge').hidden = !config.demo;

  const model = new TopologyModel();
  const view = new SceneView(document.getElementById('scene'), model);
  const ui = new UI(model, view, config);

  const params = new URLSearchParams(location.search);
  const hashSel = new URLSearchParams(location.hash.slice(1)).get('sel');
  if (hashSel) ui.pendingSelect = hashSel;

  let first = true;
  model.addEventListener('change', (ev) => {
    view.update(ev.detail);
    ui.update(ev.detail);
    if (first && model.entities.size) {
      first = false;
      document.getElementById('loading').classList.add('done');
      if (params.get('kiosk') === '1') ui.setKiosk(true);
      if (params.get('layers')) {
        const wanted = new Set(params.get('layers').split(','));
        for (const id of Object.keys(view.layers)) if (!wanted.has(id)) ui.toggleLayer(id);
      }
    }
  });
  connect(model, { onState: (s) => ui.setConn(s) });

  // acces depuis la console du navigateur (diagnostic)
  window.sng = { model, view, ui };
}

main().catch((err) => {
  console.error(err);
  const l = document.getElementById('loading');
  l.innerHTML = `<p style="color:#fca5a5">Erreur au démarrage : ${String(err.message || err)}</p>`;
});
