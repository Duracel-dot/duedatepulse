// Vue physique 3D « Maquette & calques » : salle en graphite mat, couches logiques
// posées au-dessus comme des calques. Rendu à la demande (aucune image calculée au repos).
import { WORLD, P, describe } from './data.js';

const U = 0.04445;                    // hauteur d'une unité de baie (m)
const RACK = { w: 0.6, d: 1.2, h: 2.0, plinth: 0.06 };
const INNER_W = 0.482;                // largeur utile 19"
const ROW_A_FRONT = 0;                // face avant de la rangée A, tournée vers la caméra (+z)
const ROW_B_FRONT = -3.6;             // face avant de la rangée B, tournée vers -z
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

  // ------------------------------------------------------------ utilitaires
  const texCache = new Map();
  const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.04, ...o });
  const lineMat = (color, opacity = 1) => new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
  const edges = (geo, color, opacity = 1) => new THREE.LineSegments(new THREE.EdgesGeometry(geo), lineMat(color, opacity));
  const box = (w, h, d, material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  const at = (o, pos) => { o.position.copy(pos); return o; };

  function canvasTex(key, w, h, draw, { repeat = false } = {}) {
    if (texCache.has(key)) return texCache.get(key);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    texCache.set(key, t);
    return t;
  }

  function textPlane(text, { size = 0.2, color = P.inkLight, font = "600 64px 'IBM Plex Sans Condensed', sans-serif", spacing = 0, align = 'left' } = {}) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    ctx.font = font;
    ctx.letterSpacing = `${spacing}px`;
    const w = Math.ceil(ctx.measureText(text).width + spacing * text.length) + 8;
    c.width = w; c.height = 84;
    ctx.font = font;
    ctx.letterSpacing = `${spacing}px`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 4, 44);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size * (w / 84), size), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
    if (align === 'left') m.geometry.translate((size * (w / 84)) / 2, 0, 0);
    return m;
  }

  // ------------------------------------------------------------ façades procédurales
  // Représentation schématique : seuls les équipements inventoriés sont dessinés.
  const FP = { body: '#323840', net: '#2E343C', stor: '#343A42', edge: '#15191E', ear: '#252A31', screw: '#48505A', vent: '#23282E', drive: '#3D444D', driveEdge: '#22272D', handle: '#5A636E', port: '#0F1114', portEdge: '#4C5560', led: '#5C646E', act: '#6D7580', lcd: '#1D2632' };
  const PX = 1100; // pixels par mètre
  function faceplate(type, hU) {
    const W = Math.round(INNER_W * PX); const H = Math.max(24, Math.round(hU * U * PX));
    return canvasTex(`fp-${type}-${hU}`, W, H, (g) => {
      const body = type === 'switch' || type === 'router' ? FP.net : type === 'storage' ? FP.stor : FP.body;
      g.fillStyle = body; g.fillRect(0, 0, W, H);
      g.fillStyle = FP.ear; g.fillRect(0, 0, 14, H); g.fillRect(W - 14, 0, 14, H);
      g.fillStyle = FP.screw;
      for (let k = 0; k < hU; k++) { const y = (k + 0.5) * (H / hU); g.fillRect(5, y - 2, 4, 4); g.fillRect(W - 9, y - 2, 4, 4); }
      g.strokeStyle = FP.edge; g.lineWidth = 2; g.strokeRect(1, 1, W - 2, H - 2);
      const bay = (x, y, w, h) => { g.fillStyle = FP.drive; g.fillRect(x, y, w, h); g.strokeStyle = FP.driveEdge; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); g.fillStyle = FP.handle; g.fillRect(x + 2, y + h - 5, w - 4, 2); g.fillStyle = FP.led; g.fillRect(x + w - 5, y + 3, 2, 2); };
      const vents = (x, y, w, h) => { g.fillStyle = FP.vent; for (let i = x; i < x + w; i += 5) g.fillRect(i, y, 3, h); };
      const ports = (x, y, cols, rows, pw = 11, ph = 9, gap = 3) => {
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const px = x + c * (pw + gap) + Math.floor(c / 6) * 4; const py = y + r * (ph + gap);
          g.fillStyle = FP.port; g.fillRect(px, py, pw, ph); g.strokeStyle = FP.portEdge; g.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
        }
      };
      if (type === 'server') {
        g.fillStyle = FP.lcd; g.fillRect(22, 6, 26, H - 12);
        g.fillStyle = FP.led; g.fillRect(30, 10, 4, 4); g.fillRect(38, 10, 4, 4);
        const rows = hU >= 2 ? 2 : 1; const cols = hU >= 2 ? 12 : 10; const bw = 26; const bh = (H - 12 - (rows - 1) * 3) / rows;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) bay(60 + c * (bw + 2), 6 + r * (bh + 3), bw, bh);
        vents(60 + cols * (bw + 2) + 8, 8, W - (60 + cols * (bw + 2) + 8) - 22, H - 16);
      } else if (type === 'switch') {
        g.fillStyle = FP.port; g.fillRect(24, 8, 14, 11);
        ports(52, Math.max(3, (H - 20) / 2 - 3), 24, 2, 11, 8, 2);
        ports(W - 150, Math.max(4, H / 2 - 6), 6, 1, 18, 12, 4);
        g.fillStyle = FP.led; for (let i = 0; i < 4; i++) g.fillRect(W - 30, 6 + i * 6, 3, 3);
      } else if (type === 'router' || type === 'loadbalancer') {
        g.fillStyle = FP.lcd; g.fillRect(24, 8, 60, H - 16);
        ports(110, H / 2 - 5, 8, 1, 14, 10, 5);
        vents(W - 180, 6, 150, H - 12);
      } else if (type === 'firewall') {
        g.fillStyle = FP.lcd; g.fillRect(24, 10, 70, 24);
        ports(120, 10, 16, 2, 12, 9, 3);
        vents(W - 150, 10, 120, H - 20);
      } else if (type === 'storage') {
        const rows = hU >= 4 ? 4 : 2; const cols = hU >= 4 ? 12 : 24; const bw = hU >= 4 ? 36 : 17; const bh = (H - 14 - (rows - 1) * 3) / rows;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) bay(22 + c * (bw + 2), 7 + r * (bh + 3), bw, bh);
      } else if (type === 'ups') {
        g.fillStyle = FP.lcd; g.fillRect(34, 14, 80, 36);
        g.fillStyle = FP.handle; g.fillRect(34, 60, 18, 8); g.fillRect(58, 60, 18, 8);
        vents(140, 14, W - 170, H - 28);
      } else if (type === 'appliance') {
        g.fillStyle = FP.lcd; g.fillRect(30, 20, 90, 50);
        g.fillStyle = '#20252C'; g.fillRect(140, 16, W - 180, H - 40);
        for (let i = 0; i < 6; i++) { g.fillStyle = FP.handle; g.fillRect(150 + i * 50, H - 20, 30, 6); }
      } else {
        vents(24, 6, W - 48, H - 12);
      }
    });
  }
  function blankTex(hU) {
    const W = Math.round(INNER_W * PX); const H = Math.round(hU * U * PX);
    return canvasTex(`blank-${hU}`, W, Math.max(8, H), (g) => {
      g.fillStyle = '#262B31'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#1D2126'; for (let k = 1; k < hU; k++) g.fillRect(0, Math.round(k * (H / hU)) - 1, W, 2);
      g.fillStyle = '#2C3238'; for (let k = 0; k < hU; k++) { const y = (k + 0.5) * (H / hU); g.fillRect(6, y - 2, 4, 4); g.fillRect(W - 10, y - 2, 4, 4); }
    });
  }
  const hatchTex = canvasTex('hatch', 64, 64, (g) => {
    g.fillStyle = '#1B2026'; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#5A636E'; g.lineWidth = 3;
    for (let i = -64; i < 128; i += 12) { g.beginPath(); g.moveTo(i, 64); g.lineTo(i + 64, 0); g.stroke(); }
  }, { repeat: true });
  const perfTex = canvasTex('perf', 64, 64, (g) => {
    g.fillStyle = '#1B2026'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#151A1F'; for (let y = 4; y < 64; y += 8) for (let x = 4; x < 64; x += 8) g.fillRect(x, y, 3, 3);
  }, { repeat: true });
  const sidePerfTex = canvasTex('sideperf', 64, 64, (g) => {
    g.fillStyle = '#252B32'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#1D2228'; for (let y = 3; y < 64; y += 6) for (let x = 3; x < 64; x += 6) g.fillRect(x, y, 2, 2);
  }, { repeat: true });
  const glowTex = canvasTex('glow', 128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(245,241,232,0.55)'); gr.addColorStop(1, 'rgba(245,241,232,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
  const shadowTex = canvasTex('shadow', 128, 64, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 64);
    g.filter = 'blur(6px)'; g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(12, 10, 104, 44);
    void gr;
  });

  // ------------------------------------------------------------ salle
  const world = new THREE.Group();
  scene.add(world);
  const room = { x0: -2.4, x1: 7.4, z0: -6.4, z1: 3.0 };
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(room.x1 - room.x0, room.z1 - room.z0), mat('#171B21'));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((room.x0 + room.x1) / 2, 0, (room.z0 + room.z1) / 2);
  world.add(floor);
  // dalles de faux plancher 0,6 m, perforées dans les allées froides
  const grid = [];
  for (let x = room.x0; x <= room.x1 + 1e-6; x += 0.6) grid.push(x, 0.002, room.z0, x, 0.002, room.z1);
  for (let z = room.z0; z <= room.z1 + 1e-6; z += 0.6) grid.push(room.x0, 0.002, z, room.x1, 0.002, z);
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(grid, 3));
  world.add(new THREE.LineSegments(gridGeo, lineMat('#232830')));
  for (const z of [0, -4.8]) {
    const perfMat = new THREE.MeshStandardMaterial({ map: perfTex.clone(), roughness: 1 });
    perfMat.map.repeat.set(8 * 2, 2 * 2); perfMat.map.needsUpdate = true;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 1.2), perfMat);
    p.rotation.x = -Math.PI / 2; p.position.set(2.1, 0.003, z + 0.6); world.add(p);
  }
  // murs coupés à 1,4 m (poché noir sur la tranche)
  const WALL_H = 1.4; const WALL_T = 0.2;
  const wallMat = mat('#232830');
  const wallTop = new THREE.MeshBasicMaterial({ color: '#07090B' });
  const wallBack = box(room.x1 - room.x0 + WALL_T, WALL_H, WALL_T, [wallMat, wallMat, wallTop, wallMat, wallMat, wallMat]);
  wallBack.position.set((room.x0 + room.x1) / 2 + WALL_T / 2, WALL_H / 2, room.z0 - WALL_T / 2); world.add(wallBack);
  world.add(at(edges(wallBack.geometry, '#8D949C', 0.45), wallBack.position));
  const wallRight = box(WALL_T, WALL_H, room.z1 - room.z0, [wallMat, wallMat, wallTop, wallMat, wallMat, wallMat]);
  wallRight.position.set(room.x1 + WALL_T / 2, WALL_H / 2, (room.z0 + room.z1) / 2); world.add(wallRight);
  world.add(at(edges(wallRight.geometry, '#8D949C', 0.45), wallRight.position));

  // climatiseurs contre le mur droit
  for (const [i, z] of [[1, -1.5], [2, -4.5]]) {
    const g = new THREE.Group();
    const bodyMat = mat('#262C33');
    const front = new THREE.MeshStandardMaterial({ map: canvasTex(`crac-${i}`, 256, 512, (c, w, h) => {
      c.fillStyle = '#262C33'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#1C2126'; for (let y = 60; y < h - 20; y += 10) c.fillRect(20, y, w - 40, 5);
      c.fillStyle = '#1D2632'; c.fillRect(w - 80, 18, 56, 28);
      c.fillStyle = '#8A94A0'; c.font = "600 16px 'IBM Plex Mono', monospace"; c.fillText('18,4°', w - 74, 38);
    }), roughness: 0.95 });
    const b = box(0.9, 1.95, 1.8, [bodyMat, front, bodyMat, bodyMat, bodyMat, bodyMat]);
    b.position.y = 0.975; g.add(b);
    g.add(at(edges(b.geometry, '#3B434E'), b.position));
    const lab = textPlane(`CLIM ${i}`, { size: 0.16, color: '#8A94A0', spacing: 6 });
    lab.rotation.x = -Math.PI / 2; lab.position.set(-0.36, 1.952, 0.2); g.add(lab);
    g.position.set(room.x1 - 0.55, 0, z + 0.9); world.add(g);
  }

  // titre de salle au sol, façon cartouche d'architecte
  const title = textPlane('SALLE A — PRODUCTION', { size: 0.34, color: '#8A94A0', spacing: 18 });
  title.rotation.x = -Math.PI / 2; title.position.set(-1.9, 0.004, 1.95); world.add(title);
  const sub = textPlane('PARIS DC1 · NIVEAU −1 · 16 BAIES · 42U', { size: 0.17, color: '#5A636E', font: "500 64px 'IBM Plex Mono', monospace", spacing: 6 });
  sub.rotation.x = -Math.PI / 2; sub.position.set(-1.9, 0.004, 2.35); world.add(sub);

  // ------------------------------------------------------------ baies et équipements
  const pickables = [];
  const deviceMeshes = new Map();   // id -> { mesh, material, rack, anchor }
  const racks = new Map();          // id -> { group, outline, uband, anchor, devices }
  const rackBody = mat('#252B32');
  const rackTop = mat('#2F363F');
  const rackSide = new THREE.MeshStandardMaterial({ map: sidePerfTex, roughness: 0.95 });
  sidePerfTex.repeat.set(6, 20);
  const rackInside = new THREE.MeshBasicMaterial({ color: '#0A0C0F' });

  WORLD.room.rows.forEach((row) => {
    const flip = row.rotation === 180;
    row.racks.forEach((rack, i) => {
      const x = flip ? (row.racks.length - 1 - i) * RACK.w : i * RACK.w;
      const frontZ = flip ? ROW_B_FRONT : ROW_A_FRONT;
      const g = new THREE.Group();
      // repère local : face avant en z = 0 vers -z
      const body = box(RACK.w, RACK.h, RACK.d, [rackSide, rackSide, rackTop, rackBody, rackBody, rackInside]);
      body.position.set(0, RACK.h / 2, RACK.d / 2);
      body.userData = { id: rack.id };
      g.add(body);
      pickables.push(body);
      const outline = at(edges(body.geometry, '#3B434E'), body.position);
      g.add(outline);
      // montants avant
      for (const sx of [-1, 1]) {
        const post = box(0.04, RACK.h - 0.1, 0.02, rackBody);
        post.position.set(sx * (RACK.w / 2 - 0.035), RACK.h / 2, -0.005); g.add(post);
      }

      // occupation : équipements + obturateurs
      const used = new Array(rack.units + 2).fill(false);
      const devs = [];
      for (const d of rack.devices) {
        const h = d.height || 1;
        for (let u = d.u; u < d.u + h; u++) used[u] = true;
        const m = new THREE.MeshStandardMaterial({ map: faceplate(d.type, h), roughness: 0.85, metalness: 0.05, emissive: new THREE.Color(0x000000) });
        const mesh = box(INNER_W + 0.036, h * U - 0.003, 0.03, [m, m, m, m, m, m]);
        // la texture n'est utile que sur la face avant (index 5 regarde +z, 4 regarde -z)
        const side = new THREE.MeshStandardMaterial({ color: '#2B3139', roughness: 0.9 });
        mesh.material = [side, side, side, side, side, m];
        const y = RACK.plinth + (d.u - 1) * U + (h * U) / 2;
        mesh.position.set(0, y, -0.012);
        mesh.userData = { id: d.id, rack: rack.id };
        g.add(mesh);
        pickables.push(mesh);
        const anchor = new THREE.Object3D(); anchor.position.set(0, y, -0.03); g.add(anchor);
        deviceMeshes.set(d.id, { mesh, material: m, rack: rack.id, anchor, u: d.u, h });
        devs.push(d);
      }
      let start = null;
      for (let u = 1; u <= rack.units + 1; u++) {
        const free = u <= rack.units && !used[u];
        if (free && start == null) start = u;
        if (!free && start != null) {
          const hU = u - start;
          const bm = new THREE.MeshStandardMaterial({ map: blankTex(hU), roughness: 0.95 });
          const b = box(INNER_W, hU * U - 0.002, 0.008, [rackBody, rackBody, rackBody, rackBody, rackBody, bm]);
          b.position.set(0, RACK.plinth + (start - 1) * U + (hU * U) / 2, -0.004);
          g.add(b);
          start = null;
        }
      }
      // bande U d'état (montant gauche) : lisible de loin et au mur
      const bandCanvas = document.createElement('canvas'); bandCanvas.width = 8; bandCanvas.height = rack.units * 4;
      const bandTex = new THREE.CanvasTexture(bandCanvas); bandTex.colorSpace = THREE.SRGBColorSpace; bandTex.magFilter = THREE.NearestFilter;
      const band = new THREE.Mesh(new THREE.PlaneGeometry(0.022, rack.units * U), new THREE.MeshBasicMaterial({ map: bandTex }));
      band.rotation.y = Math.PI;
      band.position.set(RACK.w / 2 - 0.035, RACK.plinth + (rack.units * U) / 2, -0.017);
      g.add(band);
      const anchor = new THREE.Object3D(); anchor.position.set(0, RACK.h, 0); g.add(anchor);

      // rangée A : face avant vers +z (vers la caméra) ; rangée B : face avant vers -z
      if (!flip) g.rotation.y = Math.PI;
      g.position.set(x, 0, frontZ);
      world.add(g);
      const roofLab = textPlane(rack.id, { size: 0.15, color: P.inkLight, font: "600 64px 'IBM Plex Mono', monospace" });
      roofLab.rotation.x = -Math.PI / 2;
      roofLab.position.set(x - 0.2, RACK.h + 0.004, (flip ? frontZ + RACK.d / 2 : frontZ - RACK.d / 2) + 0.36);
      world.add(roofLab);
      racks.set(rack.id, { group: g, outline, body, band: { canvas: bandCanvas, tex: bandTex }, anchor, devices: devs, units: rack.units });
    });
  });

  // ombres de contact sous les rangées
  for (const z of [ROW_A_FRONT - RACK.d / 2, ROW_B_FRONT + RACK.d / 2]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.9), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    s.rotation.x = -Math.PI / 2; s.position.set(2.1, 0.004, z); world.add(s);
  }
  // allée chaude confinée entre les dos des rangées
  const glass = new THREE.MeshBasicMaterial({ color: '#C9D3DC', transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide });
  const hotLen = 8 * RACK.w;
  const hotZ0 = ROW_B_FRONT + RACK.d; const hotZ1 = ROW_A_FRONT - RACK.d; const hotW = hotZ1 - hotZ0; const hotC = (hotZ0 + hotZ1) / 2;
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(hotLen, hotW), glass);
  roof.rotation.x = -Math.PI / 2; roof.position.set(hotLen / 2 - RACK.w / 2, RACK.h + 0.05, hotC); world.add(roof);
  world.add(at(edges(new THREE.BoxGeometry(hotLen, 0.001, hotW), '#C9D3DC', 0.3), roof.position));
  for (const ex of [-RACK.w / 2, hotLen - RACK.w / 2]) {
    const door = new THREE.Mesh(new THREE.PlaneGeometry(hotW, RACK.h + 0.05), glass);
    door.rotation.y = Math.PI / 2; door.position.set(ex, (RACK.h + 0.05) / 2, hotC); world.add(door);
    world.add(at(edges(new THREE.BoxGeometry(0.001, RACK.h + 0.05, hotW), '#C9D3DC', 0.28), door.position));
  }
  const hotLab = textPlane('ALLÉE CHAUDE', { size: 0.12, color: '#8A94A0', spacing: 8 });
  hotLab.rotation.y = -Math.PI / 2; hotLab.position.set(-RACK.w / 2 - 0.01, 1.25, hotZ0 + 0.12); world.add(hotLab);
  // chemins de câbles au-dessus des rangées
  for (const z of [ROW_A_FRONT - 0.35, ROW_B_FRONT + 0.35]) {
    const tray = box(hotLen + 0.4, 0.06, 0.3, mat('#20252C'));
    tray.position.set(hotLen / 2 - RACK.w / 2, RACK.h + 0.32, z); world.add(tray);
    world.add(at(edges(tray.geometry, '#3B434E'), tray.position));
  }

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

  function rackWorldPos(rackId) {
    const r = racks.get(rackId);
    const v = new THREE.Vector3(0, 0, RACK.d / 2);
    r.group.localToWorld(v);
    return v;
  }

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
