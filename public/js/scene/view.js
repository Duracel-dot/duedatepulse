// Vue 3D unique : salles, baies, equipements, cablage, hyperviseurs, VM, flux et externes.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LAYERS, NETWORK_TYPES, statusRank } from '/shared/model.js';
import { flowPath } from '/shared/graph.js';
import { computeLayout, DIM, deviceFrontPoint } from './layout.js';
import { TYPE_COLORS, EXTERNAL_COLORS, STATUS_COLORS, color, statusColor, heatColor, tempToHeat, linkColor } from './colors.js';
import { FlowLayer } from './flows.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const HEX = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
const UP = new THREE.Vector3(0, 1, 0);
const LABEL_RANGE = { site: Infinity, room: 60, rack: 16, cluster: 70, hypervisor: 22, external: 90, device: 7, vm: 5 };

export class SceneView extends EventTarget {
  constructor(container, model) {
    super();
    this.container = container;
    this.model = model;
    this.layers = Object.fromEntries(LAYERS.map((l) => [l.id, true]));
    this.colorMode = 'status';
    this.explode = 1;
    this.labelsOn = true;
    this.isolate = false;
    this.selected = null;
    this.selectedFlow = null;
    this.selectedLink = null;
    this.hoverId = null;
    this.layout = null;
    this.inst = new Map();
    this.meshes = [];
    this.linkMeshes = new Map();
    this.labels = [];
    this.related = null;
    this.firstBuild = true;
    this.fpsCap = 0;
    this.initRenderer();
    this.initScene();
    this.bindEvents();
    this.lastTime = performance.now();
    this.lastLabelUpdate = 0;
    this.lastFrame = 0;
    this.renderLoop = this.renderLoop.bind(this);
    requestAnimationFrame(this.renderLoop);
  }

  // ------------------------------------------------------------------ initialisation

  initRenderer() {
    const { clientWidth: w, clientHeight: h } = this.container;
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setSize(w, h);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.1;
    r.domElement.className = 'scene-canvas';
    this.container.appendChild(r.domElement);
    this.renderer = r;

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(w, h);
    this.labelRenderer.domElement.className = 'label-layer';
    this.container.appendChild(this.labelRenderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.05, 4000);
    this.camera.position.set(18, 22, 34);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 0.4;
    this.controls.maxDistance = 600;
    this.controls.zoomToCursor = true;
    this.controls.autoRotateSpeed = 0.35;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line2 = { threshold: 6 };
    this.pointer = new THREE.Vector2();
  }

  initScene() {
    const s = new THREE.Scene();
    s.background = new THREE.Color('#050912');
    s.fog = new THREE.Fog('#050912', 80, 420);
    s.add(new THREE.HemisphereLight('#c7d8ff', '#0a0f1a', 1.35));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(30, 60, 40);
    s.add(sun);
    const fill = new THREE.DirectionalLight('#7dd3fc', 0.45);
    fill.position.set(-40, 20, -30);
    s.add(fill);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial({ color: '#060b15' }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    s.add(ground);
    const grid = new THREE.GridHelper(1200, 600, '#0d1a2e', '#0a1424');
    grid.position.y = -0.04;
    grid.material.transparent = true;
    grid.material.opacity = 0.5;
    s.add(grid);
    this.scene = s;
    this.groups = {};
    for (const l of [...LAYERS.map((x) => x.id), 'overlay', 'beacons']) {
      const g = new THREE.Group();
      g.name = l;
      s.add(g);
      this.groups[l] = g;
    }
    this.flowLayer = new FlowLayer();
    this.groups.flow.add(this.flowLayer.group);
    this.flowLayer.setViewport(this.container.clientHeight, this.camera.fov);

    // selection
    this.selBox = new THREE.LineSegments(new THREE.EdgesGeometry(BOX), new THREE.LineBasicMaterial({ color: '#f8fafc', transparent: true, depthTest: false }));
    this.selBox.renderOrder = 10;
    this.selBox.visible = false;
    this.groups.overlay.add(this.selBox);
    this.hoverBox = new THREE.LineSegments(new THREE.EdgesGeometry(BOX), new THREE.LineBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.8, depthTest: false }));
    this.hoverBox.visible = false;
    this.hoverBox.renderOrder = 9;
    this.groups.overlay.add(this.hoverBox);
    this.overlayExtra = new THREE.Group();
    this.groups.overlay.add(this.overlayExtra);
    this.floorTexture = makeFloorTexture();
  }

  bindEvents() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (ev) => { down = { x: ev.clientX, y: ev.clientY, t: performance.now() }; });
    el.addEventListener('pointerup', (ev) => {
      if (!down) return;
      const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
      down = null;
      if (moved > 5 || ev.button !== 0) return;
      const hit = this.pickAt(ev.clientX, ev.clientY);
      this.dispatchEvent(new CustomEvent('pick', { detail: hit }));
    });
    el.addEventListener('dblclick', (ev) => {
      const hit = this.pickAt(ev.clientX, ev.clientY);
      if (hit?.entity) this.focusEntity(hit.entity);
    });
    el.addEventListener('pointermove', (ev) => {
      this.pendingHover = { x: ev.clientX, y: ev.clientY };
    });
    el.addEventListener('pointerleave', () => {
      this.pendingHover = null;
      this.setHover(null);
    });
    new ResizeObserver(() => this.resize()).observe(this.container);
    this.controls.addEventListener('start', () => { this.cameraAnim = null; this.dispatchEvent(new Event('interact')); });
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.applyViewOffset();
    this.scene.traverse((o) => { if (o.material?.isLineMaterial) o.material.resolution.set(w, h); });
  }

  lineMaterial(opts) {
    const m = new LineMaterial({ worldUnits: false, transparent: true, ...opts });
    m.resolution.set(this.container.clientWidth, this.container.clientHeight);
    return m;
  }

  makeLine(curve, segments, material) {
    const pts = curve.getPoints(segments);
    const flat = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => { flat[i * 3] = p.x; flat[i * 3 + 1] = p.y; flat[i * 3 + 2] = p.z; });
    const geo = new LineGeometry();
    geo.setPositions(flat);
    const line = new Line2(geo, material);
    line.computeLineDistances();
    return line;
  }

  /** Zone de l'ecran masquee par les panneaux (px) : la vue se centre sur la zone libre. */
  setInsets(insets) {
    this.insets = { left: 0, right: 0, top: 0, bottom: 0, ...insets };
    this.applyViewOffset();
  }

  applyViewOffset() {
    const { clientWidth: W, clientHeight: H } = this.container;
    if (!W || !H) return;
    const ins = this.insets || { left: 0, right: 0, top: 0, bottom: 0 };
    const cx = ins.left + (W - ins.left - ins.right) / 2;
    const cy = ins.top + (H - ins.top - ins.bottom) / 2;
    const FW = 2 * Math.max(cx, W - cx);
    const FH = 2 * Math.max(cy, H - cy);
    this.camera.aspect = FW / FH;
    this.camera.setViewOffset(FW, FH, FW / 2 - cx, FH / 2 - cy, W, H);
    this.camera.updateProjectionMatrix();
    this.flowLayer.setViewport(FH, this.camera.fov);
    // champ de vision effectif de la zone libre
    const t = Math.tan((this.camera.fov * Math.PI) / 360);
    this.freeFov = {
      v: 2 * Math.atan(t * Math.max(80, H - ins.top - ins.bottom) / FH),
      h: 2 * Math.atan(t * (FW / FH) * Math.max(80, W - ins.left - ins.right) / FW),
    };
  }

  /** Distance de camera pour qu'une sphere de rayon r tienne dans la zone libre. */
  fitDistance(r) {
    const f = this.freeFov || { v: (this.camera.fov * Math.PI) / 180, h: (this.camera.fov * Math.PI) / 180 * this.camera.aspect };
    return r / Math.sin(Math.min(f.v, f.h) / 2);
  }

  // ------------------------------------------------------------------ mise a jour depuis le modele

  update(flags = {}) {
    if (flags.structure || !this.layout) {
      this.rebuild();
      return;
    }
    if (flags.links) this.refreshCables();
    if (flags.metrics || flags.alarms || flags.links) this.refreshColors();
    if (flags.flows) this.rebuildFlows();
    if (this.selected && !this.model.get(this.selected)) this.select(null);
    else if (this.selectedFlow) this.refreshTrace();
    else this.updateSelectionVisuals();
  }

  /** Recalcule le chemin du flux trace (le routage peut changer : lien coupe, vMotion...). */
  refreshTrace() {
    const flow = this.model.flows.get(this.selectedFlow);
    if (flow) this.tracePath = flowPath(flow, this.model.index);
    if (this.tracePath) {
      this.related = { entities: new Set(this.tracePath.entities), links: new Set(this.tracePath.links.map((l) => l.id)), flows: new Set([this.selectedFlow]) };
    }
    this.updateSelectionVisuals(this.tracePath);
  }

  rebuild() {
    const model = this.model;
    this.layout = computeLayout(model, { explode: this.explode });
    for (const key of Object.keys(this.groups)) {
      if (key === 'flow' || key === 'overlay') continue;
      clearGroup(this.groups[key]);
    }
    this.inst.clear();
    this.meshes = [];
    this.linkMeshes.clear();
    this.labels = [];
    this.buildBuilding();
    this.buildRacks();
    this.buildDevices();
    this.buildVirtual();
    this.buildExternals();
    this.buildCables();
    this.rebuildFlows();
    this.refreshColors();
    this.applyLayerVisibility();
    if (this.selectedFlow) this.refreshTrace(); else this.updateSelectionVisuals();
    if (this.firstBuild && model.entities.size) {
      this.firstBuild = false;
      this.view('overview', false);
    }
  }

  register(id, mesh, index, kind) {
    if (!this.inst.has(id)) this.inst.set(id, []);
    this.inst.get(id).push({ mesh, index, kind });
  }

  addLabel(group, text, pos, kind, id, extraClass = '') {
    const div = document.createElement('div');
    div.className = `lbl lbl-${kind} ${extraClass}`;
    div.textContent = text;
    if (id) {
      div.dataset.id = id;
      div.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.dispatchEvent(new CustomEvent('pick', { detail: { entity: id } }));
      });
    }
    const obj = new CSS2DObject(div);
    obj.position.set(pos[0], pos[1], pos[2]);
    group.add(obj);
    this.labels.push({ obj, kind, id, div, pos: new THREE.Vector3(...pos) });
    return div;
  }

  // ------------------------------------------------------------------ batiment

  buildBuilding() {
    const g = this.groups.building;
    const L = this.layout;
    for (const [id, s] of L.sites) {
      const w = s.x1 - s.x0;
      const d = s.z1 - s.z0;
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: '#0a1424', roughness: 0.95 }));
      plate.rotation.x = -Math.PI / 2;
      plate.position.set(s.x0 + w / 2, -0.02, s.z0 + d / 2);
      plate.userData.entity = id;
      g.add(plate);
      g.add(rectLine(s.x0, s.z0, s.x1, s.z1, -0.015, '#1e3a5f', 0.9));
      this.addLabel(g, s.name, [s.x0 + w / 2, 0.05, s.z1 + 1.1], 'site', id);
      this.meshes.push(plate);
    }
    for (const [id, r] of L.rooms) {
      const w = r.x1 - r.x0;
      const d = r.z1 - r.z0;
      const tex = this.floorTexture.clone();
      tex.needsUpdate = true;
      tex.repeat.set(w / 0.6, d / 0.6);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({
        map: tex, color: r.virtual ? '#3a2a10' : '#b8c6dd', roughness: 0.8, metalness: 0.1,
      }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(r.x0 + w / 2, 0, r.z0 + d / 2);
      if (!r.virtual) floor.userData.entity = id;
      g.add(floor);
      // murs en fil de fer
      const wallH = (this.layout.heights.rackTop || 2) + 0.7;
      g.add(roomWireframe(r.x0, r.z0, r.x1, r.z1, wallH, r.virtual ? '#b45309' : '#28476e'));
      this.addLabel(g, r.name, [r.x0 + Math.min(2.2, w * 0.25), 0.05, r.z1 + 0.25], 'room', r.virtual ? null : id);
      this.meshes.push(floor);
    }
  }

  // ------------------------------------------------------------------ baies

  buildRacks() {
    const L = this.layout;
    const racks = [...L.racks.entries()];
    if (!racks.length) return;
    const g = this.groups.physical;
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#111a2b', transparent: true, opacity: 0.32, roughness: 0.6, metalness: 0.4, depthWrite: false });
    const body = new THREE.InstancedMesh(BOX, bodyMat, racks.length);
    const strip = new THREE.InstancedMesh(BOX, new THREE.MeshBasicMaterial({ toneMapped: false }), racks.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const edges = [];
    const edgeBox = new THREE.EdgesGeometry(BOX).attributes.position.array;
    racks.forEach(([id, r], i) => {
      q.setFromAxisAngle(UP, r.rot);
      m.compose(new THREE.Vector3(r.x, r.h / 2, r.z), q, new THREE.Vector3(DIM.RACK_W, r.h, DIM.RACK_D));
      body.setMatrixAt(i, m);
      for (let k = 0; k < edgeBox.length; k += 3) {
        const v = new THREE.Vector3(edgeBox[k], edgeBox[k + 1], edgeBox[k + 2]).applyMatrix4(m);
        edges.push(v.x, v.y, v.z);
      }
      const fx = r.x + r.front[0] * (DIM.RACK_D / 2 + 0.005);
      const fz = r.z + r.front[1] * (DIM.RACK_D / 2 + 0.005);
      m.compose(new THREE.Vector3(fx, r.h - 0.03, fz), q, new THREE.Vector3(DIM.RACK_W * 0.9, 0.025, 0.012));
      strip.setMatrixAt(i, m);
      strip.setColorAt(i, color('#1e293b'));
      const e = this.model.get(id);
      this.register(id, body, i, 'rack');
      this.register(id, strip, i, 'rackstrip');
      this.addLabel(g, e?.name || (r.virtual ? 'Auto' : id), [r.x, r.h + 0.12, r.z], 'rack', r.virtual ? null : id);
    });
    body.userData.ids = racks.map(([id, r]) => (r.virtual ? null : id));
    strip.userData.ids = body.userData.ids;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3));
    const frame = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#41557a', transparent: true, opacity: 0.9 }));
    g.add(body, strip, frame);
    this.rackBody = body;
    this.rackStrip = strip;
    this.meshes.push(body);
  }

  // ------------------------------------------------------------------ equipements en baie

  buildDevices() {
    const L = this.layout;
    const sets = { physical: [], network: [] };
    for (const [id, d] of L.devices) {
      const e = this.model.get(id);
      if (!e) continue;
      sets[NETWORK_TYPES.has(e.type) ? 'network' : 'physical'].push([id, d, e]);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    this.deviceMeshes = [];
    for (const layer of ['physical', 'network']) {
      const list = sets[layer];
      if (!list.length) continue;
      const body = new THREE.InstancedMesh(BOX, new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.45 }), list.length);
      const plate = new THREE.InstancedMesh(BOX, new THREE.MeshBasicMaterial({ toneMapped: false }), list.length);
      list.forEach(([id, d, e], i) => {
        q.setFromAxisAngle(UP, d.rot);
        m.compose(new THREE.Vector3(d.x, d.y, d.z), q, new THREE.Vector3(d.w, d.h, d.d));
        body.setMatrixAt(i, m);
        body.setColorAt(i, color(TYPE_COLORS[e.type] || '#2b313d'));
        const fx = d.x + d.front[0] * (d.d / 2 + 0.006);
        const fz = d.z + d.front[1] * (d.d / 2 + 0.006);
        m.compose(new THREE.Vector3(fx, d.y, fz), q, new THREE.Vector3(d.w * 0.97, Math.max(0.012, d.h * 0.6), 0.008));
        plate.setMatrixAt(i, m);
        plate.setColorAt(i, color('#475569'));
        this.register(id, body, i, 'body');
        this.register(id, plate, i, 'plate');
        if (layer === 'network' || d.hU >= 4 || !d.rackId) {
          const fp = deviceFrontPoint(d, 0.05);
          this.addLabel(this.groups[layer], e.name, [fp[0], d.y, fp[2]], 'device', id);
        }
      });
      body.userData.ids = list.map((x) => x[0]);
      plate.userData.ids = body.userData.ids;
      this.groups[layer].add(body, plate);
      this.meshes.push(body, plate);
      this.deviceMeshes.push({ body, plate, list });
    }
  }

  // ------------------------------------------------------------------ couche virtuelle

  buildVirtual() {
    const L = this.layout;
    const gH = this.groups.hypervisor;
    const gV = this.groups.vm;
    for (const [key, isl] of L.islands) {
      const w = isl.x1 - isl.x0;
      const d = isl.z1 - isl.z0;
      const orphan = key === 'orphans';
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({
        color: orphan ? '#f59e0b' : '#0ea5e9', transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide,
      }));
      plate.rotation.x = -Math.PI / 2;
      plate.position.set(isl.x0 + w / 2, isl.y, isl.z0 + d / 2);
      gH.add(plate);
      gH.add(rectLine(isl.x0, isl.z0, isl.x1, isl.z1, isl.y, orphan ? '#f59e0b' : '#38bdf8', 0.55));
      if (isl.name) this.addLabel(gH, isl.name, [isl.x0 + w / 2, isl.y + 0.05, isl.z0 - 0.05], 'cluster');
    }
    const tiles = [...L.tiles.entries()];
    if (tiles.length) {
      const mesh = new THREE.InstancedMesh(BOX, new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.3, transparent: true, opacity: 0.92 }), tiles.length);
      const m = new THREE.Matrix4();
      const drops = [];
      const edges = [];
      tiles.forEach(([id, t], i) => {
        m.compose(new THREE.Vector3(t.x, t.y, t.z), new THREE.Quaternion(), new THREE.Vector3(t.w, DIM.TILE_H, t.d));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, color('#1e293b'));
        this.register(id, mesh, i, 'tile');
        const e = this.model.get(id);
        if (!t.virtual) this.addLabel(gH, e?.name || id, [t.x, t.y + 0.04, t.z - t.d / 2 + 0.07], 'hypervisor', id);
        const y = t.y + DIM.TILE_H / 2 + 0.002;
        const x0 = t.x - t.w / 2; const x1 = t.x + t.w / 2; const z0 = t.z - t.d / 2; const z1 = t.z + t.d / 2;
        edges.push(x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0);
        const dev = t.anchor && L.devices.get(t.anchor);
        if (dev) {
          const fp = deviceFrontPoint(dev, 0.03);
          drops.push(t.x, t.y - DIM.TILE_H / 2, t.z, fp[0], fp[1], fp[2]);
        }
      });
      mesh.userData.ids = tiles.map(([id, t]) => (t.virtual ? null : id));
      gH.add(mesh);
      this.meshes.push(mesh);
      const eg = new THREE.BufferGeometry();
      eg.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3));
      gH.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: '#5b7aa6', transparent: true, opacity: 0.8 })));
      const dg = new THREE.BufferGeometry();
      dg.setAttribute('position', new THREE.Float32BufferAttribute(drops, 3));
      this.dropLines = new THREE.LineSegments(dg, new THREE.LineBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.22, depthWrite: false }));
      gH.add(this.dropLines);
    }
    // VM (cubes) et conteneurs (prismes hexagonaux)
    const vmList = { vm: [], container: [] };
    for (const [id, v] of L.vms) {
      const e = this.model.get(id);
      if (e) vmList[e.type === 'container' ? 'container' : 'vm'].push([id, v, e]);
    }
    for (const [kind, list] of Object.entries(vmList)) {
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(kind === 'vm' ? BOX : HEX, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.15 }), list.length);
      const m = new THREE.Matrix4();
      list.forEach(([id, v, e], i) => {
        const s = e.status === 'off' ? v.s * 0.55 : v.s;
        m.compose(new THREE.Vector3(v.x, v.y - (v.s - s) / 2, v.z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, color('#475569'));
        this.register(id, mesh, i, 'vm');
      });
      mesh.userData.ids = list.map((x) => x[0]);
      mesh.userData.offState = new Map(list.map(([id, , e]) => [id, e.status === 'off']));
      gV.add(mesh);
      this.meshes.push(mesh);
    }
  }

  // ------------------------------------------------------------------ externes

  buildExternals() {
    const g = this.groups.external;
    this.extRings = [];
    for (const [id, p] of this.layout.externals) {
      const e = this.model.get(id);
      const kind = e?.attrs?.kind || 'network';
      const c = EXTERNAL_COLORS[kind] || EXTERNAL_COLORS.network;
      const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(p.r, 1), new THREE.MeshBasicMaterial({ color: c, wireframe: true, transparent: true, opacity: 0.55 }));
      wire.position.set(p.x, p.y, p.z);
      const core = new THREE.Mesh(new THREE.SphereGeometry(p.r * 0.72, 24, 16), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.22 }));
      core.position.copy(wire.position);
      core.userData.entity = id;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(p.r * 1.25, 0.03, 8, 48), new THREE.MeshBasicMaterial({ color: '#64748b', toneMapped: false }));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(p.x, p.y - p.r * 0.2, p.z);
      g.add(wire, core, ring);
      this.register(id, ring, -1, 'ring');
      this.extRings.push({ id, ring, wire });
      this.meshes.push(core);
      this.addLabel(g, e?.name || id, [p.x, p.y - p.r - 0.35, p.z], 'external', id);
    }
  }

  // ------------------------------------------------------------------ cablage

  anchorPoint(id) {
    const L = this.layout;
    if (L.devices.has(id)) {
      // les cables partent de la face arriere (cote allee chaude), comme en salle
      const d = L.devices.get(id);
      return { p: [d.x - d.front[0] * (d.d / 2 + 0.02), d.y, d.z - d.front[1] * (d.d / 2 + 0.02)], kind: 'device', dev: d, back: [-d.front[0], -d.front[1]] };
    }
    if (L.externals.has(id)) { const e = L.externals.get(id); return { p: [e.x, e.y, e.z], kind: 'external', r: e.r }; }
    if (L.tiles.has(id)) { const t = L.tiles.get(id); return { p: [t.x, t.y, t.z], kind: 'tile' }; }
    if (L.vms.has(id)) { const v = L.vms.get(id); return { p: [v.x, v.y, v.z], kind: 'vm' }; }
    return null;
  }

  buildCables() {
    const L = this.layout;
    for (const link of this.model.links.values()) {
      const A = this.anchorPoint(link.a);
      const B = this.anchorPoint(link.b);
      if (!A || !B) continue;
      const curve = this.cableCurve(link, A, B);
      if (!curve) continue;
      const s = link.speedBps || 1e9;
      let width = s >= 1e11 ? 3.4 : s >= 4e10 ? 2.8 : s >= 1e10 ? 2.1 : s >= 1e9 ? 1.6 : 1.3;
      if (link.kind === 'wan') width *= 1.35;
      const ext = A.kind === 'external' || B.kind === 'external';
      const long = ext || (A.dev && B.dev && L.racks.get(A.dev.rackId)?.roomId !== L.racks.get(B.dev.rackId)?.roomId);
      const mesh = this.makeLine(curve, long ? 64 : 36, this.lineMaterial({ color: '#3b82f6', linewidth: width, opacity: 0.9 }));
      mesh.userData.link = link.id;
      (ext ? this.groups.external : this.groups.network).add(mesh);
      this.linkMeshes.set(link.id, { mesh, curve, width, long });
      this.meshes.push(mesh);
    }
    this.refreshCables();
  }

  cableCurve(link, A, B) {
    const L = this.layout;
    const pa = new THREE.Vector3(...A.p);
    const pb = new THREE.Vector3(...B.p);
    const h = hash(link.id);
    if (A.kind === 'device' && B.kind === 'device') {
      const ra = L.racks.get(A.dev.rackId);
      const rb = L.racks.get(B.dev.rackId);
      if (ra && rb && ra.roomId === rb.roomId) {
        const yT = L.heights.tray + (h % 8) * 0.03;
        const oa = pa.clone().add(new THREE.Vector3(A.back[0], 0, A.back[1]).multiplyScalar(0.08 + (h % 5) * 0.02));
        const ob = pb.clone().add(new THREE.Vector3(B.back[0], 0, B.back[1]).multiplyScalar(0.08 + ((h >> 3) % 5) * 0.02));
        if (ra === rb) {
          const side = new THREE.Vector3(-A.back[1], 0, A.back[0]).multiplyScalar(DIM.RACK_W / 2 - 0.04);
          return new THREE.CatmullRomCurve3([pa, oa, oa.clone().add(side), ob.clone().add(side), ob, pb], false, 'catmullrom', 0.2);
        }
        const pts = [pa, oa, new THREE.Vector3(oa.x, yT, oa.z), new THREE.Vector3(ob.x, yT, ob.z), ob, pb];
        return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.08);
      }
      const d = pa.distanceTo(pb);
      const lift = 3 + d * 0.12;
      return new THREE.CubicBezierCurve3(pa, new THREE.Vector3(pa.x, pa.y + lift, pa.z), new THREE.Vector3(pb.x, pb.y + lift, pb.z), pb);
    }
    // vers/depuis un externe : sortie par le haut de la baie puis arc
    if (A.kind === 'external' && B.kind === 'external') {
      const mid = pa.clone().add(pb).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.6, 0));
      return new THREE.QuadraticBezierCurve3(pa, mid, pb);
    }
    const [dev, ext, pd, pe] = A.kind === 'external' ? [B, A, pb, pa] : [A, B, pa, pb];
    const up = new THREE.Vector3(pd.x, L.heights.tray + 1.2, pd.z);
    const toward = new THREE.Vector3(pe.x, pe.y, pe.z + ext.r * 1.5 + 1.5);
    const curve = new THREE.CubicBezierCurve3(pd, up, toward, pe);
    return A.kind === 'external' ? new ReversedCurve(curve) : curve;
  }

  refreshCables() {
    const tmp = new THREE.Color();
    for (const [id, lm] of this.linkMeshes) {
      const link = this.model.links.get(id);
      if (!link) continue;
      linkColor(link, tmp);
      if (this.related && !this.related.links.has(id)) tmp.multiplyScalar(this.isolate ? 0.08 : 0.35);
      lm.mesh.material.color.copy(tmp);
      lm.critical = link.status === 'critical';
    }
  }

  // ------------------------------------------------------------------ flux

  flowPoint(id) {
    const L = this.layout;
    let e = this.model.get(id);
    for (let guard = 0; e && guard < 10; guard++) {
      if (this.layers.vm && L.vms.has(e.id)) { const v = L.vms.get(e.id); return [v.x, v.y + v.s / 2, v.z]; }
      if (this.layers.hypervisor && L.tiles.has(e.id)) { const t = L.tiles.get(e.id); return [t.x, t.y + DIM.TILE_H, t.z]; }
      if (L.devices.has(e.id) && (this.layers.physical || this.layers.network)) return deviceFrontPoint(L.devices.get(e.id), 0.05);
      if (L.externals.has(e.id) && this.layers.external) { const x = L.externals.get(e.id); return [x.x, x.y, x.z]; }
      e = e.parent ? this.model.get(e.parent) : null;
    }
    return null;
  }

  rebuildFlows() {
    if (!this.layout) return;
    const flows = [...this.model.flows.values()];
    this.flowLayer.build(flows, (id) => this.flowPoint(id));
    this.applyFlowFocus();
  }

  applyFlowFocus() {
    if (this.selectedFlow) {
      this.flowLayer.setFocus(new Set([this.selectedFlow]));
    } else if (this.related) {
      this.flowLayer.setFocus(this.related.flows.size ? this.related.flows : new Set(['__none__']));
    } else {
      this.flowLayer.setFocus(null);
    }
  }

  // ------------------------------------------------------------------ couleurs

  entityColor(e, out) {
    const mode = this.colorMode;
    if (mode === 'status') {
      if (e.status === 'unknown') return out.set('#4b5a70');
      return out.copy(statusColor(e.status));
    }
    const v = mode === 'temp' ? tempToHeat(e.metrics?.temp) : e.metrics?.[mode];
    if (v == null) return out.set(e.status === 'off' ? STATUS_COLORS.off : '#2a3446');
    return heatColor(v, out);
  }

  refreshColors() {
    if (!this.layout) return;
    const model = this.model;
    const tmp = new THREE.Color();
    const dimOf = (id) => (this.related && !this.related.entities.has(id) ? (this.isolate ? 0.12 : 0.55) : 1);
    const touched = new Set();
    for (const [id, list] of this.inst) {
      const e = model.get(id);
      if (!e) continue;
      const dim = dimOf(id);
      for (const { mesh, index, kind } of list) {
        switch (kind) {
          case 'plate':
            this.entityColor(e, tmp);
            if (e.status === 'unknown' && this.colorMode === 'status') tmp.set('#3a475c');
            break;
          case 'body':
            tmp.copy(color(TYPE_COLORS[e.type] || '#2b313d'));
            break;
          case 'rack':
            continue;
          case 'rackstrip': {
            const agg = model.agg.get(id);
            tmp.copy(agg === 'warning' || agg === 'critical' ? statusColor(agg) : agg === 'ok' ? color('#1f6f4a') : color('#1e293b'));
            break;
          }
          case 'tile': {
            this.entityColor(e, tmp);
            tmp.lerp(color('#0f172a'), 0.55);
            break;
          }
          case 'vm':
            this.entityColor(e, tmp);
            break;
          case 'ring':
            mesh.material.color.copy(e.status === 'unknown' ? color('#64748b') : statusColor(e.status)).multiplyScalar(dim);
            continue;
          default:
            continue;
        }
        tmp.multiplyScalar(dim);
        mesh.setColorAt(index, tmp);
        touched.add(mesh);
      }
    }
    for (const mesh of touched) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // VM eteintes/allumees : taille a mettre a jour
    this.refreshVmScale();
    this.refreshCables();
    this.buildBeacons();
    for (const l of this.labels) {
      if (!l.id) continue;
      const agg = model.agg.get(l.id);
      const st = l.kind === 'rack' || l.kind === 'room' || l.kind === 'site' ? agg : model.get(l.id)?.status;
      if (l.div.dataset.status !== st) l.div.dataset.status = st || 'unknown';
    }
  }

  refreshVmScale() {
    const m = new THREE.Matrix4();
    for (const mesh of this.groups.vm.children) {
      if (!mesh.isInstancedMesh) continue;
      let changed = false;
      mesh.userData.ids.forEach((id, i) => {
        const e = this.model.get(id);
        const off = e?.status === 'off';
        if (mesh.userData.offState.get(id) === off) return;
        mesh.userData.offState.set(id, off);
        const v = this.layout.vms.get(id);
        const s = off ? v.s * 0.55 : v.s;
        m.compose(new THREE.Vector3(v.x, v.y - (v.s - s) / 2, v.z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
        mesh.setMatrixAt(i, m);
        changed = true;
      });
      if (changed) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Colonnes lumineuses au-dessus des baies / hyperviseurs en alerte. */
  buildBeacons() {
    const g = this.groups.beacons;
    clearGroup(g);
    this.beacons = [];
    const L = this.layout;
    const add = (x, y0, z, h, st, r = 0.18) => {
      const mat = new THREE.MeshBasicMaterial({ color: statusColor(st), transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.6, h, 20, 1, true), mat);
      cyl.position.set(x, y0 + h / 2, z);
      g.add(cyl);
      this.beacons.push({ mesh: cyl, st, phase: Math.random() * 6 });
    };
    for (const [id, r] of L.racks) {
      const st = this.model.agg.get(id);
      if (!this.layers.physical && !this.layers.network) break;
      if (st !== 'critical' && st !== 'warning') continue;
      // on ne signale une baie que si un equipement physique est en cause
      const phys = [...(this.model.children.get(id) || [])].map((c) => this.model.get(c)).filter(Boolean);
      const worst = phys.reduce((w, e) => (statusRank(e.status) > statusRank(w) ? e.status : w), 'unknown');
      if (worst !== 'critical' && worst !== 'warning') continue;
      add(r.x, r.h, r.z, 1.1, worst, 0.26);
    }
    if (this.layers.hypervisor) {
      for (const [id, t] of L.tiles) {
        const e = this.model.get(id);
        if (!e || (e.status !== 'critical' && e.status !== 'warning')) continue;
        add(t.x, t.y, t.z, 0.9, e.status, Math.min(t.w, t.d) * 0.35);
      }
    }
    if (this.layers.vm) {
      for (const [id, v] of L.vms) {
        const e = this.model.get(id);
        if (!e || e.status !== 'critical') continue;
        add(v.x, v.y + v.s / 2, v.z, 0.55, 'critical', 0.09);
      }
    }
    for (const [id, p] of L.externals) {
      const e = this.model.get(id);
      if (!e || (e.status !== 'critical' && e.status !== 'warning')) continue;
      add(p.x, p.y + p.r, p.z, 1.2, e.status, 0.3);
    }
  }

  // ------------------------------------------------------------------ calques / options

  setLayer(id, on) {
    this.layers[id] = on;
    this.applyLayerVisibility();
    this.rebuildFlows();
    this.buildBeacons();
  }

  applyLayerVisibility() {
    for (const l of LAYERS) this.groups[l.id].visible = !!this.layers[l.id];
    if (this.dropLines) this.dropLines.visible = this.layers.physical || this.layers.network;
  }

  setColorMode(mode) {
    this.colorMode = mode;
    this.refreshColors();
  }

  setExplode(v) {
    this.explode = v;
    this.rebuild();
  }

  setLabels(on) {
    this.labelsOn = on;
    this.updateLabels(true);
  }

  setIsolate(on) {
    this.isolate = on;
    this.refreshColors();
    this.updateLabels(true);
  }

  // ------------------------------------------------------------------ selection

  select(id, { fly = false } = {}) {
    this.selected = id && this.model.get(id) ? id : null;
    this.selectedLink = null;
    this.selectedFlow = null;
    this.tracePath = null;
    this.computeRelated();
    this.refreshColors();
    this.applyFlowFocus();
    this.updateSelectionVisuals();
    this.updateLabels(true);
    if (fly && this.selected) this.focusEntity(this.selected);
  }

  selectLink(linkId) {
    this.selected = null;
    this.selectedFlow = null;
    this.tracePath = null;
    this.selectedLink = this.model.links.get(linkId) ? linkId : null;
    const link = this.model.links.get(linkId);
    this.related = link ? { entities: new Set([link.a, link.b]), links: new Set([linkId]), flows: new Set() } : null;
    this.refreshColors();
    this.applyFlowFocus();
    this.updateSelectionVisuals();
  }

  /** Trace le chemin physique complet d'un flux (VM -> ... -> VM). */
  traceFlow(flowId) {
    const flow = this.model.flows.get(flowId);
    if (!flow) return null;
    const path = flowPath(flow, this.model.index);
    this.selectedFlow = flowId;
    this.tracePath = path;
    this.related = { entities: new Set(path.entities), links: new Set(path.links.map((l) => l.id)), flows: new Set([flowId]) };
    this.refreshColors();
    this.applyFlowFocus();
    this.updateSelectionVisuals(path);
    this.updateLabels(true);
    this.fitEntities(path.entities);
    return path;
  }

  computeRelated() {
    const id = this.selected;
    if (!id) { this.related = null; return; }
    const m = this.model;
    const entities = new Set([id]);
    for (const a of m.ancestors(id)) entities.add(a.id);
    const desc = m.descendants(id);
    for (const d of desc) entities.add(d);
    const scope = new Set([id, ...desc]);
    const flows = new Set();
    for (const f of m.flows.values()) {
      if (scope.has(f.src) || scope.has(f.dst)) {
        flows.add(f.id);
        for (const x of [f.src, f.dst]) {
          entities.add(x);
          for (const a of m.ancestors(x)) if (a.type !== 'site' && a.type !== 'room') entities.add(a.id);
        }
      }
    }
    const links = new Set();
    // liens des equipements physiques concernes (le serveur d'une VM, ses switches...)
    const physScope = new Set([...entities].filter((x) => { const e = m.get(x); return e && (e.cls === 'physical' || e.cls === 'external') && !['site', 'room', 'rack'].includes(e.type); }));
    for (const l of m.links.values()) {
      if (scope.has(l.a) || scope.has(l.b) || (physScope.has(l.a) && physScope.has(l.b)) ||
          (m.get(id)?.cls !== 'physical' && (physScope.has(l.a) || physScope.has(l.b)))) {
        links.add(l.id);
        entities.add(l.a);
        entities.add(l.b);
      }
    }
    this.related = { entities, links, flows };
  }

  entityBounds(id) {
    const L = this.layout;
    if (!L) return null;
    if (L.devices.has(id)) { const d = L.devices.get(id); return { c: [d.x, d.y, d.z], s: [d.w + 0.04, d.h + 0.03, d.d + 0.04], rot: d.rot }; }
    if (L.racks.has(id)) { const r = L.racks.get(id); return { c: [r.x, r.h / 2, r.z], s: [DIM.RACK_W + 0.05, r.h + 0.05, DIM.RACK_D + 0.05], rot: r.rot }; }
    if (L.vms.has(id)) { const v = L.vms.get(id); return { c: [v.x, v.y, v.z], s: [v.s * 1.5, v.s * 1.5, v.s * 1.5], rot: 0 }; }
    if (L.tiles.has(id)) { const t = L.tiles.get(id); return { c: [t.x, t.y + 0.1, t.z], s: [t.w + 0.06, 0.32, t.d + 0.06], rot: 0 }; }
    if (L.externals.has(id)) { const x = L.externals.get(id); return { c: [x.x, x.y, x.z], s: [x.r * 2.6, x.r * 2.6, x.r * 2.6], rot: 0 }; }
    if (L.rooms.has(id)) { const r = L.rooms.get(id); return { c: [(r.x0 + r.x1) / 2, 1.2, (r.z0 + r.z1) / 2], s: [r.x1 - r.x0, 2.4, r.z1 - r.z0], rot: 0 }; }
    if (L.sites.has(id)) { const s = L.sites.get(id); return { c: [(s.x0 + s.x1) / 2, 1.2, (s.z0 + s.z1) / 2], s: [s.x1 - s.x0, 2.4, s.z1 - s.z0], rot: 0 }; }
    return null;
  }

  placeBox(box, b) {
    box.position.set(...b.c);
    box.scale.set(...b.s);
    box.rotation.set(0, b.rot || 0, 0);
    box.visible = true;
  }

  updateSelectionVisuals(path) {
    clearGroup(this.overlayExtra);
    const id = this.selected;
    const b = id ? this.entityBounds(id) : null;
    if (b) this.placeBox(this.selBox, b); else this.selBox.visible = false;
    if (b && !this.labels.some((l) => l.id === id && l.kind !== 'site')) {
      const e = this.model.get(id);
      const div = document.createElement('div');
      div.className = 'lbl lbl-selected';
      div.dataset.status = e.status;
      div.textContent = e.name;
      const obj = new CSS2DObject(div);
      obj.position.set(b.c[0], b.c[1] + b.s[1] / 2 + 0.12, b.c[2]);
      this.overlayExtra.add(obj);
    }
    const L = this.layout;
    if (!L) return;
    // chaine verticale VM -> hyperviseur -> serveur
    const chainIds = id ? [id, ...this.model.ancestors(id).map((a) => a.id).reverse()] : [];
    const pts = [];
    for (let i = 0; i < chainIds.length - 1; i++) {
      const a = this.chainPoint(chainIds[i]);
      const c = this.chainPoint(chainIds[i + 1]);
      if (a && c) pts.push(...a, ...c);
    }
    if (pts.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#f0abfc', transparent: true, depthTest: false }));
      line.renderOrder = 11;
      this.overlayExtra.add(line);
    }
    for (const cid of chainIds.slice(1)) {
      const cb = this.entityBounds(cid);
      if (!cb || ['room', 'site'].includes(this.model.get(cid)?.type)) continue;
      const box = new THREE.LineSegments(new THREE.EdgesGeometry(BOX), new THREE.LineBasicMaterial({ color: '#f0abfc', transparent: true, opacity: 0.7, depthTest: false }));
      box.renderOrder = 10;
      this.placeBox(box, cb);
      this.overlayExtra.add(box);
    }
    // lien selectionne ou chemin trace : surcouche lumineuse
    const hlLinks = path ? path.links.map((l) => l.id) : this.selectedLink ? [this.selectedLink] : [];
    for (const lid of hlLinks) {
      const lm = this.linkMeshes.get(lid);
      if (!lm) continue;
      const hl = this.makeLine(lm.curve, lm.long ? 64 : 36, this.lineMaterial({
        color: path ? '#ff4fd8' : '#f8fafc', linewidth: lm.width + 2.5, opacity: 0.95, depthWrite: false, depthTest: false,
      }));
      hl.renderOrder = 12;
      this.overlayExtra.add(hl);
    }
    if (path) {
      for (const eid of path.entities) {
        const eb = this.entityBounds(eid);
        if (!eb) continue;
        const box = new THREE.LineSegments(new THREE.EdgesGeometry(BOX), new THREE.LineBasicMaterial({ color: '#f472b6', transparent: true, depthTest: false }));
        box.renderOrder = 10;
        this.placeBox(box, eb);
        this.overlayExtra.add(box);
      }
    }
  }

  chainPoint(id) {
    const L = this.layout;
    if (L.vms.has(id)) { const v = L.vms.get(id); return [v.x, v.y - v.s / 2, v.z]; }
    if (L.tiles.has(id)) { const t = L.tiles.get(id); return [t.x, t.y - DIM.TILE_H / 2, t.z]; }
    if (L.devices.has(id)) return deviceFrontPoint(L.devices.get(id), 0.02);
    if (L.racks.has(id)) { const r = L.racks.get(id); return [r.x, r.h, r.z]; }
    return null;
  }

  // ------------------------------------------------------------------ survol / selection au pointeur

  pickAt(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const candidates = this.meshes.filter((o) => isVisible(o));
    const hits = this.raycaster.intersectObjects(candidates, false);
    for (const h of hits) {
      const o = h.object;
      if (o.userData.link) return { link: o.userData.link, point: h.point };
      if (o.isInstancedMesh && h.instanceId != null) {
        const id = o.userData.ids?.[h.instanceId];
        if (id) return { entity: id, point: h.point };
        continue;
      }
      if (o.userData.entity) return { entity: o.userData.entity, point: h.point };
    }
    const f = this.flowLayer.pick(this.raycaster);
    if (f) return { flow: f.id };
    return null;
  }

  setHover(hit, clientX, clientY) {
    const id = hit?.entity || null;
    const key = id || (hit?.link ? `link:${hit.link}` : hit?.flow ? `flow:${hit.flow}` : null);
    if (key !== this.hoverKey) {
      this.hoverKey = key;
      this.hoverId = id;
      const b = id && id !== this.selected ? this.entityBounds(id) : null;
      if (b && !['room', 'site'].includes(this.model.get(id)?.type)) this.placeBox(this.hoverBox, b); else this.hoverBox.visible = false;
      this.renderer.domElement.style.cursor = key ? 'pointer' : '';
    }
    this.dispatchEvent(new CustomEvent('hover', { detail: { hit, x: clientX, y: clientY } }));
  }

  // ------------------------------------------------------------------ camera

  view(preset, animate = true) {
    const b = this.layout?.bounds;
    if (!b) return;
    const hy = this.layout.heights.hyper;
    const box = new THREE.Box3(new THREE.Vector3(b.x0, 0, b.z0), new THREE.Vector3(b.x1, hy + 0.5, b.z1));
    let dir;
    switch (preset) {
      case 'top': dir = new THREE.Vector3(0, 1, 0.0001); break;
      case 'front': dir = new THREE.Vector3(0, 0.2, 1); box.max.y = this.layout.heights.rackTop + 0.5; break;
      case 'virtual': dir = new THREE.Vector3(0.12, 0.9, 0.7); box.min.y = hy - 0.2; break;
      default: dir = new THREE.Vector3(0.25, 0.62, 0.95);
    }
    const { target, pos } = this.fitBox(box, dir.normalize(), 1.04);
    this.flyTo(target, pos, animate ? 900 : 0);
  }

  /** Position de camera cadrant exactement une boite dans la zone libre, selon une direction. */
  fitBox(box, dir, margin = 1.05) {
    const center = box.getCenter(new THREE.Vector3());
    const up = Math.abs(dir.y) > 0.99 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, dir).normalize();
    const camUp = new THREE.Vector3().crossVectors(dir, right).normalize();
    const f = this.freeFov || { v: (this.camera.fov * Math.PI) / 180, h: (this.camera.fov * Math.PI) / 180 };
    const tv = Math.tan(f.v / 2);
    const th = Math.tan(f.h / 2);
    let dist = 1;
    const c = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      c.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center);
      const x = Math.abs(c.dot(right));
      const y = Math.abs(c.dot(camUp));
      const z = c.dot(dir);
      dist = Math.max(dist, (x * margin) / th + z, (y * margin) / tv + z);
    }
    return { target: center, pos: center.clone().add(dir.clone().multiplyScalar(dist)) };
  }

  focusEntity(id) {
    const b = this.entityBounds(id);
    if (!b) return;
    const e = this.model.get(id);
    const target = new THREE.Vector3(...b.c);
    const size = Math.max(...b.s);
    const minDist = { vm: 3.2, container: 3.2, hypervisor: 4.5, rack: 4.2, external: 7 }[e?.type] ?? (this.layout.devices.has(id) ? 2.6 : 4);
    const dist = Math.max(minDist, size * 2.4);
    const dev = this.layout.devices.get(id);
    const rack = this.layout.racks.get(id) || (dev && this.layout.racks.get(dev.rackId));
    if (rack) {
      // baie ou equipement en baie : vue oblique depuis l'allee, face aux facades
      const front = new THREE.Vector3(rack.front[0], 0, rack.front[1]);
      const along = new THREE.Vector3(-front.z, 0, front.x);
      if (this.camera.position.clone().sub(new THREE.Vector3(rack.x, 0, rack.z)).dot(along) < 0) along.negate();
      const aisle = DIM.RACK_D / 2 + DIM.AISLE * 0.55;
      const tgt = dev ? new THREE.Vector3(dev.x, dev.y, dev.z).addScaledVector(front, dev.d / 2) : new THREE.Vector3(rack.x, rack.h * 0.5, rack.z).addScaledVector(front, DIM.RACK_D / 2);
      const pos = new THREE.Vector3(rack.x, 0, rack.z).addScaledVector(front, aisle + (dev ? 0.2 : 0.9)).addScaledVector(along, dev ? 2 : 3.2);
      pos.y = dev ? Math.max(1.3, dev.y + 0.9) : 3.1;
      this.flyTo(tgt, pos, 800);
      return;
    }
    const dir = this.camera.position.clone().sub(this.controls.target);
    dir.y = 0;
    const elev = 0.62;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    // elevation en conservant l'azimut
    dir.multiplyScalar(Math.cos(elev)).add(new THREE.Vector3(0, Math.sin(elev), 0)).normalize();
    this.flyTo(target, target.clone().add(dir.multiplyScalar(dist)), 800);
  }

  /** Cadre un ensemble d'entites (ex. chemin d'un flux). */
  fitEntities(ids) {
    const box = new THREE.Box3();
    for (const id of ids) {
      const b = this.entityBounds(id);
      if (!b) continue;
      box.expandByPoint(new THREE.Vector3(...b.c).addScaledVector(new THREE.Vector3(...b.s), 0.5));
      box.expandByPoint(new THREE.Vector3(...b.c).addScaledVector(new THREE.Vector3(...b.s), -0.5));
    }
    if (box.isEmpty()) return;
    const dir = this.camera.position.clone().sub(this.controls.target);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0.3, 0, 1);
    dir.normalize().multiplyScalar(Math.cos(0.7)).add(new THREE.Vector3(0, Math.sin(0.7), 0)).normalize();
    const { target, pos } = this.fitBox(box, dir, 1.15);
    if (target.distanceTo(pos) < 3) pos.copy(target).add(dir.multiplyScalar(3));
    this.flyTo(target, pos, 900);
  }

  flyTo(target, pos, ms = 800) {
    if (!ms) {
      this.controls.target.copy(target);
      this.camera.position.copy(pos);
      this.controls.update();
      return;
    }
    this.cameraAnim = {
      t0: performance.now(), ms,
      fromT: this.controls.target.clone(), toT: target,
      fromP: this.camera.position.clone(), toP: pos,
    };
  }

  setAutoRotate(on) { this.controls.autoRotate = on; }

  // ------------------------------------------------------------------ boucle de rendu

  updateLabels(force = false) {
    const now = performance.now();
    if (!force && now - this.lastLabelUpdate < 250) return;
    this.lastLabelUpdate = now;
    const cam = this.camera.position;
    for (const l of this.labels) {
      let vis = this.labelsOn;
      if (vis) {
        const range = LABEL_RANGE[l.kind] ?? 20;
        vis = cam.distanceTo(l.pos) < range;
        if (l.id && (l.id === this.selected || l.id === this.hoverId)) vis = true;
        if (this.related && this.isolate && l.id && !this.related.entities.has(l.id) && l.kind !== 'site') vis = false;
      }
      if (l.obj.visible !== vis) l.obj.visible = vis;
    }
  }

  renderLoop(now) {
    requestAnimationFrame(this.renderLoop);
    if (this.fpsCap && now - this.lastFrame < 1000 / this.fpsCap - 2) return;
    this.lastFrame = now;
    const dt = Math.min(0.1, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    if (this.cameraAnim) {
      const a = this.cameraAnim;
      const k = Math.min(1, (now - a.t0) / a.ms);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.controls.target.lerpVectors(a.fromT, a.toT, e);
      this.camera.position.lerpVectors(a.fromP, a.toP, e);
      if (k >= 1) this.cameraAnim = null;
    }
    this.controls.update();
    if (this.pendingHover) {
      const { x, y } = this.pendingHover;
      this.pendingHover = null;
      this.setHover(this.pickAt(x, y), x, y);
    }
    if (this.groups.flow.visible) this.flowLayer.update(dt);
    const t = now / 1000;
    if (this.selBox.visible) this.selBox.material.opacity = 0.65 + 0.35 * Math.sin(t * 5);
    for (const b of this.beacons || []) {
      b.mesh.material.opacity = (b.st === 'critical' ? 0.3 : 0.18) + 0.15 * Math.sin(t * (b.st === 'critical' ? 5 : 2.5) + b.phase);
    }
    for (const lm of this.linkMeshes.values()) {
      if (lm.critical) lm.mesh.material.opacity = 0.35 + 0.6 * (0.5 + 0.5 * Math.sin(t * 6));
      else if (lm.mesh.material.opacity !== 0.9) lm.mesh.material.opacity = 0.9;
    }
    for (const r of this.extRings || []) r.wire.rotation.y += dt * 0.15;
    this.updateLabels();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
}

// ---------------------------------------------------------------------------

class ReversedCurve extends THREE.Curve {
  constructor(curve) { super(); this.curve = curve; }
  getPoint(t, target) { return this.curve.getPoint(1 - t, target); }
}

function isVisible(o) {
  for (let x = o; x; x = x.parent) if (!x.visible) return false;
  return true;
}

function clearGroup(g) {
  for (const child of [...g.children]) {
    g.remove(child);
    child.traverse((o) => {
      if (o.geometry && o.geometry !== BOX && o.geometry !== HEX) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { if (m.map && m.map.isTexture) m.map.dispose(); m.dispose(); }
      }
      if (o.isCSS2DObject && o.element?.parentNode) o.element.parentNode.removeChild(o.element);
    });
  }
}

function rectLine(x0, z0, x1, z1, y, col, opacity = 1) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1, x0, y, z0], 3));
  return new THREE.Line(g, new THREE.LineBasicMaterial({ color: col, transparent: opacity < 1, opacity }));
}

function roomWireframe(x0, z0, x1, z1, h, col) {
  const p = [];
  const seg = (a, b) => p.push(...a, ...b);
  const c = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = c[i];
    const [bx, bz] = c[(i + 1) % 4];
    seg([ax, 0.01, az], [bx, 0.01, bz]);
    seg([ax, h, az], [bx, h, bz]);
    seg([ax, 0, az], [ax, h, az]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.45 }));
}

function makeFloorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1a2436';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#1f2b40';
  ctx.fillRect(3, 3, 122, 122);
  ctx.strokeStyle = '#2c3b55';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 126, 126);
  ctx.fillStyle = '#243149';
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) ctx.fillRect(20 + i * 26, 20 + j * 26, 6, 6);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
