// Couche "flux" : arcs entre extremites et particules animees (densite et
// taille proportionnelles au debit, couleur = categorie applicative).
import * as THREE from 'three';
import { FLOW_CATEGORIES } from '/shared/model.js';

const SEG = 24;

const VERT = /* glsl */`
  attribute float size;
  attribute vec3 color;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(size * uScale / -mv.z, 1.5, 48.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */`
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d);
    a = a * a;
    gl_FragColor = vec4(vColor * (0.35 + 1.2 * a), a);
  }
`;

export class FlowLayer {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'flows';
    this.arcs = [];
    this.phase = new Map();
    this.focus = null;
    this.lines = null;
    this.points = null;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.lineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
    });
  }

  setViewport(height, fovDeg) {
    this.material.uniforms.uScale.value = (height * 0.5) / Math.tan((fovDeg * Math.PI) / 360);
  }

  /**
   * @param {object[]} flows
   * @param {(id:string)=>number[]|null} resolve  point d'accroche 3D d'une entite
   */
  build(flows, resolve) {
    this.dispose();
    const arcs = [];
    for (const f of flows) {
      const a = resolve(f.src);
      const b = resolve(f.dst);
      if (!a || !b) continue;
      const p0 = new THREE.Vector3(...a);
      const p1 = new THREE.Vector3(...b);
      const dist = p0.distanceTo(p1);
      if (dist < 0.05) continue;
      const mid = p0.clone().add(p1).multiplyScalar(0.5);
      const c = mid.add(new THREE.Vector3(0, Math.min(9, 0.5 + dist * 0.28), 0));
      const cat = FLOW_CATEGORIES[f.category] || FLOW_CATEGORIES.other;
      const col = new THREE.Color(cat.color);
      const bps = f.bps ?? 0;
      const lg = bps > 0 ? Math.log10(bps / 1e4) : 0;
      const n = f.bps == null ? 1 : Math.max(1, Math.min(10, Math.round(1 + lg * 1.4)));
      const size = f.bps == null ? 0.05 : Math.max(0.045, Math.min(0.2, 0.035 + lg * 0.022));
      const len = approxLength(p0, c, p1);
      const speed = Math.max(0.08, Math.min(0.9, 1.7 / len));
      if (!this.phase.has(f.id)) this.phase.set(f.id, Math.random());
      arcs.push({ id: f.id, flow: f, p0, c, p1, col, n, size, speed, phase: this.phase.get(f.id) });
    }
    this.arcs = arcs;

    // arcs (segments)
    const lp = new Float32Array(arcs.length * SEG * 2 * 3);
    const lc = new Float32Array(arcs.length * SEG * 2 * 3);
    const tmp = new THREE.Vector3();
    const prev = new THREE.Vector3();
    let k = 0;
    for (const arc of arcs) {
      bezier(arc.p0, arc.c, arc.p1, 0, prev);
      for (let i = 1; i <= SEG; i++) {
        bezier(arc.p0, arc.c, arc.p1, i / SEG, tmp);
        lp.set([prev.x, prev.y, prev.z, tmp.x, tmp.y, tmp.z], k);
        k += 6;
        prev.copy(tmp);
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    lg.setAttribute('color', new THREE.BufferAttribute(lc, 3));
    this.lines = new THREE.LineSegments(lg, this.lineMaterial);
    this.lines.frustumCulled = false;
    this.group.add(this.lines);

    // particules
    const total = arcs.reduce((s, a) => s + a.n, 0);
    const pp = new Float32Array(total * 3);
    const pc = new Float32Array(total * 3);
    const ps = new Float32Array(total);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(pc, 3));
    pg.setAttribute('size', new THREE.BufferAttribute(ps, 1));
    this.points = new THREE.Points(pg, this.material);
    this.points.frustumCulled = false;
    this.group.add(this.points);
    this.applyColors();
    this.update(0);
  }

  /** Met en avant certains flux (ensemble d'id) ; null = tous. */
  setFocus(ids) {
    this.focus = ids && ids.size ? ids : null;
    this.applyColors();
  }

  applyColors() {
    if (!this.lines) return;
    const lc = this.lines.geometry.attributes.color.array;
    const pc = this.points.geometry.attributes.color.array;
    const ps = this.points.geometry.attributes.size.array;
    let k = 0;
    let j = 0;
    for (const arc of this.arcs) {
      const on = !this.focus || this.focus.has(arc.id);
      const lf = on ? (this.focus ? 0.9 : 0.35) : 0.04;
      const pf = on ? 1 : 0.12;
      for (let i = 0; i < SEG * 2; i++) {
        lc[k++] = arc.col.r * lf; lc[k++] = arc.col.g * lf; lc[k++] = arc.col.b * lf;
      }
      for (let i = 0; i < arc.n; i++) {
        pc[j * 3] = arc.col.r * pf; pc[j * 3 + 1] = arc.col.g * pf; pc[j * 3 + 2] = arc.col.b * pf;
        ps[j] = arc.size * (on && this.focus ? 1.5 : 1);
        j++;
      }
    }
    this.lines.geometry.attributes.color.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.points.geometry.attributes.size.needsUpdate = true;
  }

  update(dt) {
    if (!this.points) return;
    const pos = this.points.geometry.attributes.position.array;
    const v = new THREE.Vector3();
    let j = 0;
    for (const arc of this.arcs) {
      arc.phase = (arc.phase + arc.speed * dt) % 1;
      this.phase.set(arc.id, arc.phase);
      for (let i = 0; i < arc.n; i++) {
        const t = (arc.phase + i / arc.n) % 1;
        bezier(arc.p0, arc.c, arc.p1, t, v);
        pos[j * 3] = v.x; pos[j * 3 + 1] = v.y; pos[j * 3 + 2] = v.z;
        j++;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  /** Flux le plus proche d'un rayon (selection au clic). */
  pick(raycaster, threshold = 0.12) {
    if (!this.lines || !this.group.visible) return null;
    raycaster.params.Line.threshold = threshold;
    const hits = raycaster.intersectObject(this.lines, false);
    if (!hits.length) return null;
    const seg = Math.floor(hits[0].index / 2);
    const arc = this.arcs[Math.floor(seg / SEG)];
    return arc ? { id: arc.id, distance: hits[0].distance } : null;
  }

  dispose() {
    for (const o of [this.lines, this.points]) {
      if (!o) continue;
      this.group.remove(o);
      o.geometry.dispose();
    }
    this.lines = null;
    this.points = null;
  }
}

function bezier(p0, c, p1, t, out) {
  const u = 1 - t;
  out.x = u * u * p0.x + 2 * u * t * c.x + t * t * p1.x;
  out.y = u * u * p0.y + 2 * u * t * c.y + t * t * p1.y;
  out.z = u * u * p0.z + 2 * u * t * c.z + t * t * p1.z;
  return out;
}

function approxLength(p0, c, p1) {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  let len = 0;
  bezier(p0, c, p1, 0, a);
  for (let i = 1; i <= 8; i++) {
    bezier(p0, c, p1, i / 8, b);
    len += a.distanceTo(b);
    a.copy(b);
  }
  return len;
}
