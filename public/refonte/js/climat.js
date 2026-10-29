// Calque « climat » de la démo spatiale : la teinte dit la température de l'air, le mouvement dit le courant.
// - carte thermique de l'air à 1,2 m, posée sur le sol, avec isothermes tous les 2 °C et l'isotherme 27 °C
//   (limite recommandée ASHRAE A1) soulignée ;
// - façade de chaque baie colorée par ses trois sondes d'entrée (bas, milieu, haut) ;
// - vitrages des confinements (allées froides, allée chaude, gaine de reprise) teintés par leur température ;
// - courants d'air en circuit fermé : dalle perforée → allée froide confinée → baie → allée chaude →
//   gaine de reprise → sommet du climatiseur ; et la fuite d'A04, où l'air chaud repasse par les U sans
//   obturateur. Les particules sont des comètes lumineuses (fusion additive, traînée dégradée, turbulence).
import { THERMIQUE, tempRGB, tempCss } from './grammaire.js';
import { MISSING_BLANKS, U } from './maquette.js';

export function buildClimat({ THREE, K, RACK, rackWorldPos, ROW_A_FRONT, ROW_B_FRONT, dpr = 1 }) {
  const group = new THREE.Group(); group.visible = false;
  const room = K.room;
  const rackIds = [...K.racks.keys()];
  const front = (id) => (id[0] === 'A' ? ROW_A_FRONT : ROW_B_FRONT);
  const dir = (id) => (id[0] === 'A' ? 1 : -1); // de la baie vers son allée froide
  const back = (id) => front(id) - dir(id) * RACK.d;
  const HOT = { x0: -RACK.w / 2, x1: K.hotLen - RACK.w / 2, zc: (K.hotZ0 + K.hotZ1) / 2 };
  const D = K.duct; const ductY = D.y0 + D.h / 2;
  const clim = (id) => K.clims.find((c) => c.id === id);
  const linear = (t) => new THREE.Color().setRGB(...tempRGB(t), THREE.SRGBColorSpace);

  // ------------------------------------------------------------ carte thermique au sol
  const MAP = { w: 368, h: Math.round(368 * (room.z1 - room.z0) / (room.x1 - room.x0)) };
  const mapCanvas = document.createElement('canvas'); mapCanvas.width = MAP.w; mapCanvas.height = MAP.h;
  const mapTex = new THREE.CanvasTexture(mapCanvas); mapTex.colorSpace = THREE.SRGBColorSpace; mapTex.anisotropy = 8;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(room.x1 - room.x0, room.z1 - room.z0), new THREE.MeshBasicMaterial({ map: mapTex, transparent: true, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2; floor.position.set((room.x0 + room.x1) / 2, 0.006, (room.z0 + room.z1) / 2); group.add(floor);

  /** Points de mesure de l'air à 1,2 m : sondes d'entrée, allée chaude, air de la salle hors confinement. */
  function samples(th) {
    const pts = [];
    for (const id of rackIds) {
      const r = th.racks[id]; const c = rackWorldPos(id); const f = front(id); const d = dir(id);
      if (!r?.flux) { pts.push([c.x, f + d * 0.5, th.ambiant - 3.5, 0.8]); continue; }
      const haut = (r.inlet[1] + r.inlet[2]) / 2;
      pts.push([c.x, f + d * 0.2, haut, 2.2], [c.x, f + d * 0.75, (haut + r.inlet[0]) / 2, 1.6], [c.x, f + d * 1.1, r.inlet[0] + 0.4, 1.2]);
      pts.push([c.x, (HOT.zc + back(id)) / 2, r.outlet - 0.6, 2.2]);
    }
    for (let x = room.x0 + 0.4; x < room.x1; x += 1.15) for (let z = room.z0 + 0.4; z < room.z1; z += 1.15) pts.push([x, z, th.ambiant, 0.3]);
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
      // carte assombrie (les courants lumineux ressortent) et estompée hors des rangées
      r *= 0.55; gg *= 0.55; b *= 0.55;
      const x = room.x0 + ((i + 0.5) / W) * (room.x1 - room.x0); const z = room.z0 + ((j + 0.5) / H) * (room.z1 - room.z0);
      const out = Math.max(0, -0.9 - x, x - 5.1, -5.2 - z, z - 1.3);
      let a = 0.86 - Math.min(0.58, out * 0.5);
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
    const m = new THREE.Mesh(new THREE.PlaneGeometry(RACK.w - 0.08, RACK.h - 0.12), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.8, depthWrite: false }));
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

  // ------------------------------------------------------------ courants d'air (circuit fermé)
  const JIT = [-0.17, 0, 0.17]; const Y = [0.42, 1.02, 1.62];
  const UY = (u) => RACK.plinth + (u - 0.5) * U; // hauteur du milieu d'un U
  function returnLeg(add, x, k, src, cr, th, zOff) {
    // toit de l'allée chaude → gaine de reprise → branche du climatiseur → sommet du climatiseur
    const cl = clim(src); const s = Math.sign(cl.pos.z - D.z);
    add(x * 0.85 + HOT.x0 * 0.15, D.y0 - 0.06, HOT.zc + zOff * 0.4, th.alleeChaude);
    add(x + 0.35, ductY + (k - 1) * 0.08, D.z + zOff, th.alleeChaude - 0.3);
    add(D.x1 - 0.75, ductY + (k - 1) * 0.06, D.z + zOff * 0.8, th.alleeChaude - 0.8);
    add(cl.pos.x + zOff * 0.4, ductY - 0.05, D.z + s * (D.w * 0.6), cr.reprise + 0.6);
    add(cl.pos.x + zOff * 0.4, cl.top + 0.2, cl.pos.z - s * 0.25, cr.reprise + 0.2);
    add(cl.pos.x, cl.top + 0.03, cl.pos.z, cr.reprise);
  }
  function rackPath(id, k, th) {
    const r = th.racks[id]; const c = rackWorldPos(id); const f = front(id); const d = dir(id); const b = back(id);
    const x = c.x + JIT[k]; const tileZ = f + d * 0.6; const zOff = ((rackIds.indexOf(id) % 5) - 2) * 0.07;
    // rangée B : pendant le dégivrage, CLIM 2 ne reprend plus que le bas ; CLIM 1 absorbe le reste
    const src = id[0] === 'A' || (th.degivrage && k > 0) ? 'clim-1' : 'clim-2';
    const cr = th.crac.find((cc) => cc.id === src);
    const P = []; const T = []; const add = (px, py, pz, t) => { P.push(new THREE.Vector3(px, py, pz)); T.push(t); };
    const tile = Math.min(cr.soufflage, 18.2) + 1.1;
    add(x, -0.3, tileZ, cr.soufflage + 0.6);
    add(x, 0.12, tileZ, tile);
    add(x, 0.18 + Y[k] * 0.55, tileZ - d * 0.14, (tile + r.inlet[k]) / 2);
    add(x, Y[k], f + d * 0.16, r.inlet[k]);
    add(x, Y[k], f, r.inlet[k]);
    add(x, Y[k], b, r.outlet); // traversée de la baie, masquée par ses parois
    add(x, Math.min(1.85, Y[k] + 0.42), (b + HOT.zc) / 2, r.outlet - 0.4);
    returnLeg(add, x, k, src, cr, th, zOff);
    const slow = src === 'clim-2' ? 1 / Math.max(0.3, cr.debit) : 1;
    return { pts: P, temps: T, period: 9.5 * slow, count: src === 'clim-2' && th.degivrage ? 7 : 16 };
  }
  function leakPath(id, th) {
    // l'air chaud de l'allée repasse par les U sans obturateur, s'enroule devant la baie et remonte dans
    // l'aspiration des équipements du haut : c'est l'alarme A04
    const r = th.racks[id]; const c = rackWorldPos(id); const f = front(id); const d = dir(id); const b = back(id);
    const [u0, u1] = MISSING_BLANKS[id]; const yg = UY((u0 + u1) / 2); const cr = th.crac.find((cc) => cc.id === 'clim-1');
    const P = []; const T = []; const add = (px, py, pz, t) => { P.push(new THREE.Vector3(px, py, pz)); T.push(t); };
    add(c.x - 0.1, yg - 0.1, (b + HOT.zc) / 2, th.alleeChaude + 0.6);
    add(c.x, yg, b, r.outlet - 2);
    add(c.x, yg, f, r.inlet[2] + 3.2);
    add(c.x + 0.12, yg + 0.12, f + d * 0.3, r.inlet[2] + 1.6);
    add(c.x - 0.06, Y[2] + 0.12, f + d * 0.2, r.inlet[2] + 0.4);
    add(c.x, Y[2] + 0.16, f, r.inlet[2]);
    add(c.x, Y[2] + 0.16, b, r.outlet);
    add(c.x, 1.9, (b + HOT.zc) / 2, r.outlet - 0.6);
    returnLeg(add, c.x, 2, 'clim-1', cr, th, 0.05);
    return { pts: P, temps: T, period: 8.5, count: 28, leak: true };
  }

  // comète : tête de 11 px, traînée continue de 14 points qui s'amincit et s'éteint
  const SAMPLES = 320; const TRAIL = 14; const TRAIL_STEP = 0.0026;
  const TRAIL_SIZE = Array.from({ length: TRAIL }, (_, j) => 11 * Math.pow(1 - j / TRAIL, 0.75) + 1.6);
  const TRAIL_ALPHA = Array.from({ length: TRAIL }, (_, j) => Math.pow(1 - j / TRAIL, 1.6));
  // particules : disque lumineux à cœur blanc et halo gaussien, en fusion additive (les courants se cumulent)
  const glowMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { dpr: { value: dpr } },
    vertexShader: `attribute vec4 rgba; attribute float psize; uniform float dpr; varying vec4 vC;
      void main() { vC = rgba; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = psize * dpr; }`,
    fragmentShader: `varying vec4 vC;
      void main() { float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard;
        float glow = exp(-r * r * 3.2); float core = smoothstep(0.42, 0.0, r);
        vec3 c = mix(vC.rgb, vec3(1.0), core * 0.55);
        gl_FragColor = vec4(c * (glow * 0.9 + core * 0.6) * vC.a, 1.0); }`,
  });
  let paths = []; let points = null; let lines = null;
  function buildFlows(th) {
    if (points) { group.remove(points, lines); points.geometry.dispose(); lines.geometry.dispose(); }
    paths = [];
    for (const id of rackIds) { const r = th.racks[id]; if (!r?.flux) continue; for (let k = 0; k < 3; k++) paths.push(rackPath(id, k, th)); if (r.recirculation && MISSING_BLANKS[id]) paths.push(leakPath(id, th)); }
    let n = 0; const linePos = []; const lineCol = [];
    paths.forEach((p, pi) => {
      const curve = new THREE.CatmullRomCurve3(p.pts, false, 'centripetal');
      p.samples = curve.getPoints(SAMPLES);
      p.sTemps = p.samples.map((_, s) => { const f = (s / SAMPLES) * (p.temps.length - 1); const i = Math.min(p.temps.length - 2, Math.floor(f)); return p.temps[i] + (p.temps[i + 1] - p.temps[i]) * (f - i); });
      p.sColors = p.sTemps.map((t) => tempRGB(t).map((v) => Math.min(1, v * 1.08 + 0.06)));
      p.phases = Array.from({ length: p.count }, (_, i) => (i + 0.5 * ((pi * 7 + i * 3) % 5) / 5) / p.count);
      p.seed = pi * 12.9898;
      p.offset = n; n += p.count * TRAIL;
      // ligne de courant : guide lumineux discret, visible aussi quand les particules sont figées
      for (let s = 0; s < SAMPLES; s += 2) {
        const a = p.samples[s]; const b = p.samples[Math.min(SAMPLES, s + 2)]; const c = p.sColors[s];
        linePos.push(a.x, a.y, a.z, b.x, b.y, b.z); lineCol.push(...c, ...c);
      }
    });
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3)); lg.setAttribute('color', new THREE.Float32BufferAttribute(lineCol, 3));
    lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    pg.setAttribute('rgba', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
    const sizes = new Float32Array(n); for (let i = 0; i < n; i++) sizes[i] = TRAIL_SIZE[i % TRAIL];
    pg.setAttribute('psize', new THREE.BufferAttribute(sizes, 1));
    points = new THREE.Points(pg, glowMat);
    points.frustumCulled = false; lines.frustumCulled = false; points.renderOrder = 5; lines.renderOrder = 4;
    group.add(lines, points);
    placeParticles();
  }
  let clock = 0;
  function placeParticles() {
    const pos = points.geometry.attributes.position.array; const col = points.geometry.attributes.rgba.array;
    for (const p of paths) {
      for (let i = 0; i < p.count; i++) {
        const head = (p.phases[i] + clock / p.period) % 1; const ph = p.seed + i * 1.618;
        for (let j = 0; j < TRAIL; j++) {
          const u = (head - j * TRAIL_STEP + 1) % 1; const f = u * SAMPLES; const s = Math.floor(f); const w = f - s; const a = p.samples[s]; const b = p.samples[Math.min(SAMPLES, s + 1)];
          // turbulence : petit tourbillon propre à chaque particule, qui fait vivre le courant sans le brouiller
          const tq = clock * 1.6 + ph + u * 26; const amp = 0.028;
          const o = p.offset + i * TRAIL + j; const c = p.sColors[s];
          pos[o * 3] = a.x + (b.x - a.x) * w + Math.sin(tq) * amp; pos[o * 3 + 1] = a.y + (b.y - a.y) * w + Math.cos(tq * 1.3) * amp; pos[o * 3 + 2] = a.z + (b.z - a.z) * w + Math.sin(tq * 0.7 + 1.1) * amp;
          col[o * 4] = c[0]; col[o * 4 + 1] = c[1]; col[o * 4 + 2] = c[2]; col[o * 4 + 3] = TRAIL_ALPHA[j] * (p.leak ? 1 : 0.85);
        }
      }
    }
    points.geometry.attributes.position.needsUpdate = true; points.geometry.attributes.rgba.needsUpdate = true;
  }

  // ------------------------------------------------------------ interface du calque
  let sig = '';
  const GLASS = [K.glass, K.coldGlass, K.ductGlass].map((m) => ({ m, color: m.color.clone(), opacity: m.opacity }));
  function tint(th) {
    const flux = rackIds.filter((id) => th.racks[id]?.flux);
    const froid = flux.reduce((a, id) => a + th.racks[id].inlet[1], 0) / flux.length;
    K.glass.color.copy(linear(th.alleeChaude)); K.glass.opacity = 0.18;
    K.coldGlass.color.copy(linear(froid)); K.coldGlass.opacity = 0.12;
    K.ductGlass.color.copy(linear(th.plafond)); K.ductGlass.opacity = 0.2;
  }
  return {
    group,
    apply(th) {
      if (th.sig === sig) return false;
      sig = th.sig;
      drawMap(th); drawSkins(th); buildFlows(th);
      if (group.visible) tint(th);
      return true;
    },
    setVisible(on, th) {
      group.visible = on;
      if (on) { sig = ''; this.apply(th); tint(th); } else for (const g of GLASS) { g.m.color.copy(g.color); g.m.opacity = g.opacity; }
    },
    /** Avance les particules ; renvoie vrai si la scène doit être redessinée. */
    tick(dt, animated) {
      if (!group.visible || !points || !animated) return false;
      clock += dt; placeParticles(); return true;
    },
    get particleCount() { return points ? points.geometry.attributes.position.count : 0; },
  };
}
