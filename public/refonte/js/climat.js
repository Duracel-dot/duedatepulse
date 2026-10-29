// Calque « climat » de la démo spatiale : la teinte dit la température de l'air, le mouvement dit le courant.
// - carte thermique de l'air à 1,2 m, posée sur le sol, avec isothermes tous les 2 °C et l'isotherme 27 °C
//   (limite recommandée ASHRAE A1) soulignée ;
// - façade de chaque baie colorée par ses trois sondes d'entrée (bas, milieu, haut) ;
// - allée chaude teintée par sa température ;
// - courants d'air : dalle perforée → entrée de baie → sortie → allée chaude → reprise au plafond →
//   climatiseur, et recirculation d'air chaud dans le haut des baies qui manquent d'air froid.
// Les courants sont des particules à traînée : 4 points par particule, alpha décroissant.
import { THERMIQUE, tempRGB, tempCss } from './grammaire.js';

export function buildClimat({ THREE, K, RACK, rackWorldPos, ROW_A_FRONT, ROW_B_FRONT, dpr = 1 }) {
  const group = new THREE.Group(); group.visible = false;
  const room = K.room;
  const rackIds = [...K.racks.keys()];
  const front = (id) => (id[0] === 'A' ? ROW_A_FRONT : ROW_B_FRONT);
  const dir = (id) => (id[0] === 'A' ? 1 : -1); // de la baie vers son allée froide
  const back = (id) => front(id) - dir(id) * RACK.d;
  const HOT = { x0: -RACK.w / 2, x1: K.hotLen - RACK.w / 2, zc: (K.hotZ0 + K.hotZ1) / 2 };
  const clim = (id) => K.clims.find((c) => c.id === id);
  const linear = (t) => new THREE.Color().setRGB(...tempRGB(t), THREE.SRGBColorSpace);

  // ------------------------------------------------------------ carte thermique au sol
  const MAP = { w: 368, h: Math.round(368 * (room.z1 - room.z0) / (room.x1 - room.x0)) };
  const mapCanvas = document.createElement('canvas'); mapCanvas.width = MAP.w; mapCanvas.height = MAP.h;
  const mapTex = new THREE.CanvasTexture(mapCanvas); mapTex.colorSpace = THREE.SRGBColorSpace; mapTex.anisotropy = 8;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(room.x1 - room.x0, room.z1 - room.z0), new THREE.MeshBasicMaterial({ map: mapTex, transparent: true, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2; floor.position.set((room.x0 + room.x1) / 2, 0.006, (room.z0 + room.z1) / 2); group.add(floor);

  /** Points de mesure de l'air à 1,2 m (sondes d'entrée, allée chaude, air de la salle, fuites). */
  function samples(th) {
    const pts = [];
    for (const id of rackIds) {
      const r = th.racks[id]; const c = rackWorldPos(id); const f = front(id); const d = dir(id);
      if (!r?.flux) { pts.push([c.x, f + d * 0.5, th.ambiant - 0.8, 0.8]); continue; }
      const haut = (r.inlet[1] + r.inlet[2]) / 2;
      pts.push([c.x, f + d * 0.2, haut, 2.2], [c.x, f + d * 0.75, (haut + r.inlet[0]) / 2, 1.4]);
      pts.push([c.x, (HOT.zc + back(id)) / 2, r.outlet - 0.6, 2.2]);
    }
    for (let x = room.x0 + 0.4; x < room.x1; x += 1.15) for (let z = room.z0 + 0.4; z < room.z1; z += 1.15) pts.push([x, z, th.ambiant, 0.3]);
    // l'allée chaude fuit par ses portes ; l'air est plus frais devant les climatiseurs
    pts.push([HOT.x0 - 0.3, HOT.zc, th.alleeChaude - 4.5, 1.3], [HOT.x1 + 0.3, HOT.zc, th.alleeChaude - 6.5, 1]);
    for (const c of th.crac) { const k = clim(c.id); pts.push([k.front - 0.35, k.pos.z, c.soufflage + 4.5, 0.9]); }
    return pts;
  }
  function drawMap(th) {
    const pts = samples(th); const W = MAP.w; const H = MAP.h; const T = new Float32Array(W * H);
    for (let j = 0; j < H; j++) {
      const z = room.z0 + ((j + 0.5) / H) * (room.z1 - room.z0);
      for (let i = 0; i < W; i++) {
        const x = room.x0 + ((i + 0.5) / W) * (room.x1 - room.x0);
        let num = 0; let den = 0;
        for (const [px, pz, t, w] of pts) { const d2 = (x - px) ** 2 + (z - pz) ** 2 + 0.04; const k = w / (d2 * d2); num += k * t; den += k; }
        T[j * W + i] = num / den;
      }
    }
    const g = mapCanvas.getContext('2d'); const img = g.createImageData(W, H); const step = THERMIQUE.pasIsothermes; const iso = THERMIQUE.isotherme;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i; const t = T[k]; let [r, gg, b] = tempRGB(t);
      // carte assombrie (la salle reste un fond sombre où les courants ressortent) et estompée hors des rangées
      r *= 0.62; gg *= 0.62; b *= 0.62;
      const x = room.x0 + ((i + 0.5) / W) * (room.x1 - room.x0); const z = room.z0 + ((j + 0.5) / H) * (room.z1 - room.z0);
      const out = Math.max(0, -0.9 - x, x - 5.1, -5.2 - z, z - 1.0);
      let a = 0.88 - Math.min(0.58, out * 0.5);
      const tr = i + 1 < W ? T[k + 1] : t; const td = j + 1 < H ? T[k + W] : t;
      // isothermes : trait sombre tous les 2 °C, trait clair à 27 °C (lisible en niveaux de gris)
      if ((t - iso) * (tr - iso) < 0 || (t - iso) * (td - iso) < 0) { r = 0.93; gg = 0.91; b = 0.86; a = 1; }
      else if (Math.floor(t / step) !== Math.floor(tr / step) || Math.floor(t / step) !== Math.floor(td / step)) { r *= 0.5; gg *= 0.5; b *= 0.5; a = Math.max(a, 0.9); }
      img.data[k * 4] = r * 255; img.data[k * 4 + 1] = gg * 255; img.data[k * 4 + 2] = b * 255; img.data[k * 4 + 3] = a * 255;
    }
    g.putImageData(img, 0, 0); mapTex.needsUpdate = true;
  }

  // ------------------------------------------------------------ façades : trois sondes d'entrée par baie
  const skins = new Map();
  for (const id of rackIds) {
    const c = rackWorldPos(id); const f = front(id); const d = dir(id);
    const cv = document.createElement('canvas'); cv.width = 4; cv.height = 128;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(RACK.w - 0.08, RACK.h - 0.12), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.82, depthWrite: false }));
    // entre les obturateurs et la face des équipements : la température se lit sur les obturateurs, les
    // équipements (et leur contour d'état) restent devant
    m.position.set(c.x, RACK.h / 2 + 0.02, f + d * 0.013); if (d < 0) m.rotation.y = Math.PI;
    group.add(m); skins.set(id, { m, cv, tex });
  }
  function drawSkins(th) {
    for (const [id, s] of skins) {
      const r = th.racks[id]; s.m.visible = !!r?.flux; if (!r?.flux) continue;
      const g = s.cv.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 128);
      gr.addColorStop(0, tempCss(r.inlet[2])); gr.addColorStop(0.15, tempCss(r.inlet[2])); gr.addColorStop(0.5, tempCss(r.inlet[1])); gr.addColorStop(0.88, tempCss(r.inlet[0])); gr.addColorStop(1, tempCss(r.inlet[0]));
      g.fillStyle = gr; g.fillRect(0, 0, 4, 128); s.tex.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------ courants d'air
  const JIT = [-0.17, 0, 0.17]; const Y = [0.42, 1.02, 1.62];
  function rackPath(id, k, th) {
    const r = th.racks[id]; const c = rackWorldPos(id); const f = front(id); const d = dir(id); const b = back(id);
    const x = c.x + JIT[k]; const tileZ = f + d * 0.6;
    // rangée B : pendant le dégivrage, CLIM 2 ne reprend plus que le bas ; CLIM 1 absorbe le reste
    const src = id[0] === 'A' || (th.degivrage && k > 0) ? 'clim-1' : 'clim-2';
    const cr = th.crac.find((cc) => cc.id === src); const cl = clim(src);
    const recirc = r.recirculation && k === 2;
    const P = []; const T = []; const add = (px, py, pz, t) => { P.push(new THREE.Vector3(px, py, pz)); T.push(t); };
    if (recirc) {
      // air chaud échappé par la porte de l'allée chaude, qui file sous le plafond et redescend dans le haut de la baie
      add(HOT.x0 - 0.05, 1.75, HOT.zc, th.alleeChaude - 1);
      add(HOT.x0 - 0.45, 2.35, HOT.zc + 0.7, th.alleeChaude - 2.5);
      add(x - 0.5, 2.6, f + d * 0.9, r.inlet[2] + 1.6);
      add(x - 0.1, 2.2, f + d * 0.55, r.inlet[2] + 0.7);
      add(x, Y[k] + 0.05, f + d * 0.2, r.inlet[2]);
    } else {
      const tile = Math.min(cr.soufflage, 18.2) + 1.1;
      add(x, -0.3, tileZ, cr.soufflage + 0.6);
      add(x, 0.1, tileZ, tile);
      add(x, 0.15 + Y[k] * 0.55, tileZ - d * 0.12, (tile + r.inlet[k]) / 2);
      add(x, Y[k], f + d * 0.18, r.inlet[k]);
    }
    add(x, Y[k], f, r.inlet[k]);
    add(x, Y[k], b, r.outlet); // traversée de la baie, masquée par ses parois
    add(x, Math.min(1.85, Y[k] + 0.45), (b + HOT.zc) / 2, r.outlet - 0.4);
    add(c.x, RACK.h + 0.03, HOT.zc, th.alleeChaude);
    add(c.x, 2.5, HOT.zc, th.alleeChaude - 0.9);
    add(c.x + (cl.pos.x - c.x) * 0.6, 2.72, (HOT.zc + cl.pos.z) / 2, th.plafond);
    add(cl.pos.x - 0.1, 2.45, cl.pos.z, cr.reprise + 0.3);
    add(cl.pos.x, cl.top + 0.03, cl.pos.z, cr.reprise);
    const slow = src === 'clim-2' ? 1 / Math.max(0.3, cr.debit) : 1;
    return { pts: P, temps: T, period: 11 * slow, count: src === 'clim-2' && th.degivrage ? 4 : recirc ? 11 : 8 };
  }

  const SAMPLES = 220; const TRAIL = 4; const TRAIL_STEP = 0.007; const TRAIL_ALPHA = [1, 0.6, 0.34, 0.16];
  let paths = []; let points = null; let lines = null; const dotTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 32; const g = cv.getContext('2d');
    // cœur coloré cerclé de sombre : la particule se détache aussi bien sur la carte thermique que sur une baie
    g.fillStyle = 'rgba(8,10,13,0.85)'; g.beginPath(); g.arc(16, 16, 14, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#FFFFFF'; g.beginPath(); g.arc(16, 16, 9.5, 0, Math.PI * 2); g.fill();
    const t = new THREE.CanvasTexture(cv); return t;
  })();
  function buildFlows(th) {
    if (points) { group.remove(points, lines); points.geometry.dispose(); lines.geometry.dispose(); }
    paths = [];
    for (const id of rackIds) { const r = th.racks[id]; if (!r?.flux) continue; for (let k = 0; k < 3; k++) paths.push(rackPath(id, k, th)); }
    let n = 0; const linePos = []; const lineCol = [];
    paths.forEach((p, pi) => {
      const curve = new THREE.CatmullRomCurve3(p.pts, false, 'centripetal');
      p.samples = curve.getPoints(SAMPLES);
      p.sTemps = p.samples.map((_, s) => { const f = (s / SAMPLES) * (p.temps.length - 1); const i = Math.min(p.temps.length - 2, Math.floor(f)); return p.temps[i] + (p.temps[i + 1] - p.temps[i]) * (f - i); });
      p.sColors = p.sTemps.map((t) => linear(t).lerp(new THREE.Color(1, 1, 1), 0.18));
      p.phases = Array.from({ length: p.count }, (_, i) => (i + 0.37 * ((pi * 7 + i * 3) % 5) / 5) / p.count);
      p.offset = n; n += p.count * TRAIL;
      // ligne de courant : guide discret, visible aussi quand les particules sont figées
      for (let s = 0; s < SAMPLES; s += 2) {
        const a = p.samples[s]; const b = p.samples[Math.min(SAMPLES, s + 2)]; const ca = p.sColors[s];
        linePos.push(a.x, a.y, a.z, b.x, b.y, b.z); lineCol.push(ca.r, ca.g, ca.b, ca.r, ca.g, ca.b);
      }
    });
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3)); lg.setAttribute('color', new THREE.Float32BufferAttribute(lineCol, 3));
    lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, depthWrite: false }));
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    pg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
    points = new THREE.Points(pg, new THREE.PointsMaterial({ size: 7 * dpr, sizeAttenuation: false, vertexColors: true, map: dotTex, transparent: true, depthWrite: false, alphaTest: 0.02 }));
    points.frustumCulled = false; lines.frustumCulled = false;
    group.add(lines, points);
    placeParticles();
  }
  let clock = 0;
  function placeParticles() {
    const pos = points.geometry.attributes.position.array; const col = points.geometry.attributes.color.array;
    for (const p of paths) {
      for (let i = 0; i < p.count; i++) {
        const head = (p.phases[i] + clock / p.period) % 1;
        for (let j = 0; j < TRAIL; j++) {
          const u = (head - j * TRAIL_STEP + 1) % 1; const f = u * SAMPLES; const s = Math.floor(f); const w = f - s; const a = p.samples[s]; const b = p.samples[Math.min(SAMPLES, s + 1)];
          const o = p.offset + i * TRAIL + j; const c = p.sColors[s];
          pos[o * 3] = a.x + (b.x - a.x) * w; pos[o * 3 + 1] = a.y + (b.y - a.y) * w; pos[o * 3 + 2] = a.z + (b.z - a.z) * w;
          col[o * 4] = c.r; col[o * 4 + 1] = c.g; col[o * 4 + 2] = c.b; col[o * 4 + 3] = TRAIL_ALPHA[j];
        }
      }
    }
    points.geometry.attributes.position.needsUpdate = true; points.geometry.attributes.color.needsUpdate = true;
  }

  // ------------------------------------------------------------ interface du calque
  let sig = '';
  const GLASS = { color: K.glass.color.clone(), opacity: K.glass.opacity };
  return {
    group,
    apply(th) {
      if (th.sig === sig) return false;
      sig = th.sig;
      drawMap(th); drawSkins(th); buildFlows(th);
      if (group.visible) { K.glass.color.copy(linear(th.alleeChaude)); K.glass.opacity = 0.2; }
      return true;
    },
    setVisible(on, th) {
      group.visible = on;
      if (on) { sig = ''; this.apply(th); K.glass.color.copy(linear(th.alleeChaude)); K.glass.opacity = 0.2; } else { K.glass.color.copy(GLASS.color); K.glass.opacity = GLASS.opacity; }
    },
    /** Avance les particules ; renvoie vrai si la scène doit être redessinée. */
    tick(dt, animated) {
      if (!group.visible || !points || !animated) return false;
      clock += dt; placeParticles(); return true;
    },
    get particleCount() { return points ? points.geometry.attributes.position.count : 0; },
  };
}
