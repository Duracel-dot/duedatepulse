// Vue physique 3D « Maquette & calques » : salle en graphite mat, couches logiques
// posées au-dessus comme des calques. Rendu à la demande (aucune image calculée au repos).
import { WORLD, P, describe } from './data.js';
import { buildMaquette, RACK, ROW_A_FRONT, ROW_B_FRONT } from './maquette.js';

const CALQUE_Y = 2.75;
const STATE_COLOR = { root: P.critical, critical: P.critical, down: P.critical, major: P.major, degraded: P.minor, minor: P.minor, unreach: P.disabled, maint: P.ink };

export async function createScene(container, { threeUrl, onPick, onHover }) {
  const THREE = await import(threeUrl);

  const canvas = document.createElement('canvas');
  canvas.className = 'scene-canvas';
  canvas.setAttribute('aria-label', 'Vue physique en 3D de la salle A');
  const overlay = document.createElement('div');
  overlay.className = 'scene-overlay';
  const leaders = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  leaders.setAttribute('class', 'scene-leaders');
  overlay.appendChild(leaders);
  container.append(canvas, overlay);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(P.bg, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 200);
  scene.add(new THREE.HemisphereLight(0xDDE1E6, 0x0A0C0F, 1.3));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-3, 8, 6);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9fb3c8, 0.35);
  fill.position.set(6, 3, -8);
  scene.add(fill);

  // ------------------------------------------------------------ maquette partagée (salle, baies, équipements)
  const { world, pickables, deviceMeshes, racks, rackWorldPos, hotLen, mat, edges, at, textPlane, hatchTex, glowTex } = buildMaquette(THREE);
  scene.add(world);

  // ------------------------------------------------------------ calque logique
  const calque = new THREE.Group();
  world.add(calque);
  const calqueBounds = { x0: -0.55, x1: hotLen - 0.05, z0: ROW_B_FRONT - 0.3, z1: ROW_A_FRONT + 0.3 };
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(calqueBounds.x1 - calqueBounds.x0, calqueBounds.z1 - calqueBounds.z0), new THREE.MeshBasicMaterial({ color: '#C9D3DC', transparent: true, opacity: 0.045, depthWrite: false }));
  sheet.rotation.x = -Math.PI / 2; sheet.position.set((calqueBounds.x0 + calqueBounds.x1) / 2, CALQUE_Y, (calqueBounds.z0 + calqueBounds.z1) / 2);
  calque.add(sheet);
  calque.add(at(edges(new THREE.BoxGeometry(calqueBounds.x1 - calqueBounds.x0, 0.0001, calqueBounds.z1 - calqueBounds.z0), '#C9D3DC', 0.35), sheet.position));
  const calqueDyn = new THREE.Group();
  calque.add(calqueDyn);
  const calqueTiles = new Map(); // id -> mesh (hôtes et VM)

  function buildCalque(state) {
    calqueDyn.clear();
    calqueTiles.clear();
    const clusters = new Map();
    for (const h of WORLD.hosts) {
      const dm = deviceMeshes.get(h.id);
      if (!dm) continue;
      const c = rackWorldPos(dm.rack);
      const upper = dm.u >= 12;
      const pos = new THREE.Vector3(c.x, CALQUE_Y + 0.002, c.z + (upper ? -0.26 : 0.26));
      const st = state?.obj.get(h.id) || 'ok';
      const tileMat = new THREE.MeshBasicMaterial({ color: st === 'root' ? '#3A2022' : '#262C34', transparent: true, opacity: 0.92, depthWrite: false });
      const tile = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.44), tileMat);
      tile.rotation.x = -Math.PI / 2; tile.position.copy(pos); tile.userData = { id: h.id };
      calqueDyn.add(tile); pickables.push(tile); calqueTiles.set(h.id, tile);
      const e = edges(new THREE.BoxGeometry(0.5, 0.0001, 0.44), st === 'root' ? P.critical : '#5A636E', st === 'root' ? 1 : 0.8);
      e.position.copy(pos); calqueDyn.add(e);
      // VM de l'hôte
      const vms = WORLD.vms.filter((v) => (state ? state.vmHost.get(v.name) : v.host) === h.id);
      vms.forEach((v, k) => {
        const col = k % 4; const rowk = Math.floor(k / 4);
        const vst = state?.obj.get(v.name) || 'ok';
        const unreach = vst === 'unreach';
        const vmMat = unreach ? new THREE.MeshBasicMaterial({ map: hatchTex, transparent: true, depthWrite: false }) : new THREE.MeshBasicMaterial({ color: v.powered === false ? '#20252C' : '#4F7FAE', transparent: true, opacity: v.powered === false ? 0.6 : 0.85, depthWrite: false });
        const vt = new THREE.Mesh(new THREE.PlaneGeometry(0.095, 0.085), vmMat);
        vt.rotation.x = -Math.PI / 2;
        vt.position.set(pos.x - 0.18 + col * 0.12, pos.y + 0.003, pos.z - 0.12 + rowk * 0.11);
        vt.userData = { id: v.name };
        calqueDyn.add(vt); pickables.push(vt); calqueTiles.set(v.name, vt);
      });
      // fil à plomb vers l'équipement
      const target = new THREE.Vector3(); dm.anchor.getWorldPosition(target);
      const top = new THREE.Vector3(pos.x, RACK.h + 0.36, pos.z);
      const plumbGeo = new THREE.BufferGeometry().setFromPoints([pos.clone().setY(CALQUE_Y), top]);
      const plumb = new THREE.Line(plumbGeo, new THREE.LineDashedMaterial({ color: st === 'root' ? P.critical : '#8A94A0', dashSize: 0.05, gapSize: 0.05, transparent: true, opacity: st === 'root' ? 0.9 : 0.4 }));
      plumb.computeLineDistances(); calqueDyn.add(plumb);
      void target;
      if (!clusters.has(h.cluster)) clusters.set(h.cluster, []);
      clusters.get(h.cluster).push(pos);
    }
    for (const [name, pts] of clusters) {
      const xs = pts.map((p) => p.x); const zs = pts.map((p) => p.z);
      const x0 = Math.min(...xs) - 0.34; const x1 = Math.max(...xs) + 0.34; const z0 = Math.min(...zs) - 0.3; const z1 = Math.max(...zs) + 0.3;
      const st = state?.obj.get(name);
      const pts2 = [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]].map(([x, z]) => new THREE.Vector3(x, CALQUE_Y + 0.001, z));
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts2), new THREE.LineDashedMaterial({ color: st === 'major' ? P.major : '#C9D3DC', dashSize: 0.08, gapSize: 0.05, transparent: true, opacity: st ? 0.95 : 0.55 }));
      l.computeLineDistances(); calqueDyn.add(l);
      const lab = textPlane(name, { size: 0.15, color: st === 'major' ? P.major : '#DDE1E6', spacing: 8 });
      lab.rotation.x = -Math.PI / 2;
      const rowB = pts.every((p) => p.z < -2);
      lab.position.set(x0 + 0.02, CALQUE_Y + 0.004, rowB ? z0 - 0.12 : z1 + 0.16);
      calqueDyn.add(lab);
    }
  }

  // ------------------------------------------------------------ sélection, survol, halos
  const hoverLines = edges(new THREE.BoxGeometry(1, 1, 1), P.ivory, 0.9);
  hoverLines.visible = false; scene.add(hoverLines);
  const selHull = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: P.ivory, side: THREE.BackSide, transparent: true, opacity: 0.9, depthWrite: false }));
  selHull.visible = false; scene.add(selHull);
  const selEdges = edges(new THREE.BoxGeometry(1, 1, 1), P.ivory);
  selEdges.visible = false; scene.add(selEdges);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 0.45 }));
  pool.rotation.x = -Math.PI / 2; pool.visible = false; scene.add(pool);
  const stateOutlines = new THREE.Group(); scene.add(stateOutlines);

  function objectBox(id) {
    const dm = deviceMeshes.get(id);
    const obj = dm?.mesh || racks.get(id)?.body || calqueTiles.get(id);
    if (!obj) return null;
    obj.updateWorldMatrix(true, false);
    return new THREE.Box3().setFromObject(obj);
  }
  function placeBox(target, b3, pad) {
    const size = new THREE.Vector3(); const c = new THREE.Vector3();
    b3.getSize(size); b3.getCenter(c);
    target.position.copy(c);
    target.scale.set(Math.max(size.x, 0.002) + pad, Math.max(size.y, 0.002) + pad, Math.max(size.z, 0.002) + pad);
  }

  let current = { state: null, sel: null, hover: null, mode: 'standard', calque: true };

  function applyState(state) {
    current.state = state;
    // équipements
    for (const [id, dm] of deviceMeshes) {
      const st = state.obj.get(id);
      dm.material.emissive.set(st === 'root' ? P.critical : 0x000000);
      dm.material.emissiveIntensity = st === 'root' ? 0.28 : 0;
      dm.material.color.set(st === 'maint' ? '#8A94A0' : '#ffffff');
    }
    // contours d'état (P1/P2 en trait plein, P3 en contour fin) — le normal reste muet
    stateOutlines.clear();
    for (const [id, st] of state.obj) {
      const col = STATE_COLOR[st];
      if (!col || st === 'unreach' || st === 'degraded' || st === 'down') continue;
      const b3 = objectBox(id);
      if (!b3 || calqueTiles.has(id) && !deviceMeshes.has(id)) continue;
      const e = edges(new THREE.BoxGeometry(1, 1, 1), col, st === 'minor' ? 0.7 : 1);
      placeBox(e, b3, racks.has(id) ? 0.02 : 0.012);
      stateOutlines.add(e);
    }
    // bandes U
    for (const [id, r] of racks) {
      const g = r.band.canvas.getContext('2d');
      g.fillStyle = '#20252C'; g.fillRect(0, 0, 8, r.units * 4);
      for (const d of r.devices) {
        const st = state.obj.get(d.id);
        g.fillStyle = st === 'root' || st === 'critical' ? P.critical : st === 'major' ? P.major : st === 'maint' ? '#5A636E' : '#3B434E';
        g.fillRect(1, (r.units - (d.u + (d.height || 1) - 1)) * 4 + 1, 6, (d.height || 1) * 4 - 2);
      }
      r.band.tex.needsUpdate = true;
      void id;
    }
    buildCalque(state);
    updateSelection();
    invalidate();
  }

  function updateSelection() {
    const id = current.sel;
    const b3 = id ? objectBox(id) : null;
    selHull.visible = selEdges.visible = pool.visible = !!b3;
    if (b3) {
      const pad = racks.has(id) ? 0.03 : calqueTiles.has(id) && !deviceMeshes.has(id) ? 0.01 : 0.018;
      placeBox(selHull, b3, pad);
      placeBox(selEdges, b3, pad + 0.004);
      const rackId = deviceMeshes.get(id)?.rack || (racks.has(id) ? id : null);
      if (rackId) {
        const c = rackWorldPos(rackId);
        const front = rackId.startsWith('B') ? c.z - 1.2 : c.z + 1.2;
        pool.position.set(c.x, 0.006, front);
        pool.visible = true;
      } else pool.visible = false;
    }
    invalidate();
  }

  function setHover(id) {
    if (id === current.hover) return;
    current.hover = id;
    const b3 = id && id !== current.sel ? objectBox(id) : null;
    hoverLines.visible = !!b3;
    if (b3) placeBox(hoverLines, b3, 0.01);
    invalidate();
  }

  // ------------------------------------------------------------ épingles (HTML)
  let pins = [];
  function setPins(list) {
    const same = list.length === pins.length && list.every((p, i) => p.id === pins[i].id && p.prio === pins[i].prio && p.blink === pins[i].blink);
    if (same) {
      // mise à jour en place (âges) : l'animation de clignotement n'est pas relancée
      list.forEach((p, i) => { const t = pins[i].el.querySelector('.pin-t'); const html = `<b>${p.title}</b><small>${p.sub}</small>`; if (t.innerHTML !== html) t.innerHTML = html; });
      return;
    }
    for (const p of pins) p.el.remove();
    pins = list.map((p) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `pin pin-p${p.prio}`;
      el.innerHTML = `<span class="glyph g-p${p.prio}${p.blink ? ' blink' : ''}" aria-hidden="true"></span><span class="pin-t"><b>${p.title}</b><small>${p.sub}</small></span>`;
      el.addEventListener('click', () => onPick?.(p.id));
      overlay.appendChild(el);
      return { ...p, el };
    });
    invalidate();
  }
  function pinAnchor(id) {
    const dm = deviceMeshes.get(id);
    const v = new THREE.Vector3();
    if (dm) { dm.anchor.getWorldPosition(v); return v; }
    const r = racks.get(id);
    if (r) { r.anchor.getWorldPosition(v); return v; }
    return null;
  }
  function layoutPins() {
    const w = container.clientWidth; const h = container.clientHeight;
    let svg = '';
    const used = [];
    for (const p of pins) {
      const a = pinAnchor(p.id);
      if (!a) { p.el.hidden = true; continue; }
      const s = a.clone().project(camera);
      const x = (s.x + 1) / 2 * w; const y = (1 - s.y) / 2 * h;
      let bx = x + 46; let by = y - 96;
      for (const u of used) if (Math.abs(u.y - by) < 44 && Math.abs(u.x - bx) < 280) by = u.y - 48;
      bx = Math.max(8, Math.min(bx, w - (p.el.offsetWidth || 300) - 8)); by = Math.max(8, by);
      used.push({ x: bx, y: by });
      p.el.hidden = false;
      p.el.style.transform = `translate(${Math.round(bx)}px, ${Math.round(by)}px)`;
      const col = p.prio === 1 ? P.critical : P.major;
      svg += `<line x1="${x}" y1="${y}" x2="${bx}" y2="${by + 34}" stroke="${col}" stroke-width="1.4"/><circle cx="${x}" cy="${y}" r="3.2" fill="${col}"/>`;
    }
    leaders.setAttribute('viewBox', `0 0 ${w} ${h}`);
    leaders.innerHTML = svg;
  }

  // ------------------------------------------------------------ caméra et commandes
  const view = { target: new THREE.Vector3(2.2, 0.8, -1.9), theta: -0.62, phi: 0.6, zoom: 1, base: 4.7 };
  const HOME = { target: view.target.clone(), theta: view.theta, phi: view.phi, zoom: 1 };
  let anim = null;
  function applyCamera() {
    const r = 40;
    camera.position.set(
      view.target.x + r * Math.cos(view.phi) * Math.sin(view.theta),
      view.target.y + r * Math.sin(view.phi),
      view.target.z + r * Math.cos(view.phi) * Math.cos(view.theta),
    );
    camera.lookAt(view.target);
    const w = container.clientWidth || 1; const h = container.clientHeight || 1;
    const half = view.base / view.zoom;
    const aspect = w / h;
    camera.left = -half * aspect; camera.right = half * aspect; camera.top = half; camera.bottom = -half;
    camera.updateProjectionMatrix();
  }
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  function animateTo(to, ms = 380) {
    const from = { target: view.target.clone(), theta: view.theta, phi: view.phi, zoom: view.zoom };
    if (reduceMotion || current.mode === 'mur') ms = 0;
    anim = { from, to, t0: performance.now(), ms };
    invalidate();
  }
  function frame(id) {
    const b3 = objectBox(id);
    if (!b3) return;
    const c = new THREE.Vector3(); b3.getCenter(c);
    const size = new THREE.Vector3(); b3.getSize(size);
    const isRow = racks.has(id);
    const zoom = isRow ? 2.2 : deviceMeshes.has(id) ? 2.8 : 2.4;
    animateTo({ target: new THREE.Vector3(c.x, Math.max(0.6, c.y), c.z), theta: view.theta, phi: view.phi, zoom });
    void size;
  }
  function home() { animateTo({ target: HOME.target.clone(), theta: HOME.theta, phi: HOME.phi, zoom: HOME.zoom }); }

  let drag = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (current.mode === 'mur') return;
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, moved: 0, pan: e.button === 2 || e.button === 1 || e.shiftKey };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      const dx = e.clientX - drag.x; const dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.moved < 4) return;
      if (drag.pan) {
        const k = (2 * view.base / view.zoom) / (container.clientHeight || 1);
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
        view.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
      } else {
        view.theta -= dx * 0.006;
        view.phi = Math.min(1.35, Math.max(0.22, view.phi + dy * 0.005));
      }
      anim = null;
      invalidate();
      return;
    }
    queueHover(e);
  });
  canvas.addEventListener('pointerup', (e) => {
    const wasClick = drag && drag.moved < 5;
    drag = null;
    if (wasClick) { const id = pick(e); onPick?.(id || null); }
  });
  canvas.addEventListener('pointerleave', () => { onHover?.(null); setHover(null); });
  canvas.addEventListener('dblclick', (e) => { const id = pick(e); if (id) frame(id); });
  canvas.addEventListener('wheel', (e) => {
    if (current.mode === 'mur') return;
    e.preventDefault();
    view.zoom = Math.min(7, Math.max(0.55, view.zoom * Math.exp(-e.deltaY * 0.0012)));
    anim = null;
    invalidate();
  }, { passive: false });

  const ray = new THREE.Raycaster();
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pickables.filter((o) => o.visible && (current.calque || !calqueTiles.has(o.userData.id) || deviceMeshes.has(o.userData.id))), false);
    // priorité aux tuiles du calque et aux équipements sur la caisse de baie
    const best = hits.find((h) => !racks.has(h.object.userData.id)) || hits[0];
    return best?.object.userData.id || null;
  }
  let hoverQueued = null;
  function queueHover(e) {
    if (hoverQueued) { hoverQueued = e; return; }
    hoverQueued = e;
    requestAnimationFrame(() => {
      const ev = hoverQueued; hoverQueued = null;
      const id = pick(ev);
      setHover(id);
      const r = canvas.getBoundingClientRect();
      onHover?.(id, { x: ev.clientX - r.left, y: ev.clientY - r.top });
      canvas.style.cursor = id ? 'pointer' : 'grab';
    });
  }

  // ------------------------------------------------------------ boucle de rendu à la demande
  let dirty = true;
  let running = true;
  function invalidate() { dirty = true; }
  function loop(now) {
    if (!running) return;
    if (anim) {
      const k = anim.ms ? Math.min(1, (now - anim.t0) / anim.ms) : 1;
      const e = 1 - Math.pow(1 - k, 3);
      view.target.lerpVectors(anim.from.target, anim.to.target, e);
      view.theta = anim.from.theta + (anim.to.theta - anim.from.theta) * e;
      view.phi = anim.from.phi + (anim.to.phi - anim.from.phi) * e;
      view.zoom = anim.from.zoom + (anim.to.zoom - anim.from.zoom) * e;
      if (k >= 1) anim = null;
      dirty = true;
    }
    if (dirty) {
      dirty = false;
      applyCamera();
      renderer.render(scene, camera);
      layoutPins();
      stats.frames++;
    }
    requestAnimationFrame(loop);
  }
  const stats = { frames: 0 };

  function resize() {
    const w = container.clientWidth; const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    invalidate();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  requestAnimationFrame(loop);

  return {
    stats,
    setState: applyState,
    select(id, { frame: doFrame = false } = {}) {
      current.sel = id && (deviceMeshes.has(id) || racks.has(id) || calqueTiles.has(id)) ? id : null;
      updateSelection();
      if (doFrame && current.sel) frame(current.sel);
    },
    has(id) { return deviceMeshes.has(id) || racks.has(id) || calqueTiles.has(id); },
    setHover,
    setPins,
    frame, home,
    setCalque(on) { current.calque = on; calque.visible = on; invalidate(); },
    setMode(mode) {
      current.mode = mode;
      if (mode === 'mur') { calque.visible = false; animateTo({ target: new THREE.Vector3(2.1, 0.9, -1.8), theta: -0.5, phi: 0.7, zoom: 1.5 }, 0); } else { calque.visible = current.calque; animateTo({ target: HOME.target.clone(), theta: HOME.theta, phi: HOME.phi, zoom: HOME.zoom }, 0); }
      invalidate();
    },
    mount(el) {
      ro.unobserve(container);
      container = el;
      el.append(canvas, overlay);
      ro.observe(el);
      resize();
    },
    invalidate,
    dispose() { running = false; ro.disconnect(); renderer.dispose(); },
    describe,
  };
}
