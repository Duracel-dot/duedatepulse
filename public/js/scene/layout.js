// Disposition 3D de la topologie. Unite : le metre.
//
//  y = 0            sol des salles (sites cote a cote sur l'axe X)
//  y = 0 .. ~2 m    baies et equipements (positions U reelles)
//  y = tray         chemins de cables au-dessus des baies
//  y = hyper        couche virtuelle : ilots de clusters -> plateaux d'hyperviseurs -> VM
//  arriere-plan     entites externes (Internet, WAN, agences, cloud)
import { RACK_DEVICE_TYPES } from '/shared/model.js';

export const DIM = {
  U: 0.0445,
  RACK_W: 0.6,
  RACK_D: 1.07,
  RACK_BASE: 0.06,
  RACK_GAP: 0.012,
  DEV_W: 0.482,
  DEV_D: 0.8,
  AISLE: 1.35,
  ROOM_MARGIN: 1.3,
  ROOM_GAP: 3,
  SITE_GAP: 8,
  SITE_MARGIN: 1,
  VM: 0.19,
  VM_PITCH: 0.29,
  TILE_PAD: 0.14,
  TILE_H: 0.05,
  TILE_GAP: 0.28,
  ISLAND_PAD: 0.32,
  ISLAND_GAP: 0.8,
};

const STAGING_ID = '__staging__';

export function computeLayout(model, opts = {}) {
  const explode = opts.explode ?? 1;
  const L = {
    sites: new Map(), rooms: new Map(), racks: new Map(), devices: new Map(),
    islands: new Map(), tiles: new Map(), vms: new Map(), externals: new Map(),
    staging: null, bounds: null, heights: {},
  };
  const ents = model.entities;
  const kids = (id) => (model.children.get(id) || []).map((c) => ents.get(c)).filter(Boolean);
  const byName = (a, b) => (a.attrs?.order ?? 0) - (b.attrs?.order ?? 0) || String(a.name).localeCompare(String(b.name), 'fr', { numeric: true });

  let maxRackH = 2;
  let cursorX = 0;
  const placedDevices = new Set();

  // ------------------------------------------------------------ sites et salles
  const sites = [...ents.values()].filter((e) => e.type === 'site').sort(byName);
  for (const site of sites) {
    const siteX0 = cursorX;
    let roomX = siteX0 + DIM.SITE_MARGIN;
    let siteDepth = 0;
    const rooms = kids(site.id).filter((e) => e.type === 'room').sort(byName);
    for (const room of rooms) {
      const r = layoutRoom(room, roomX, DIM.SITE_MARGIN);
      roomX = r.x1 + DIM.ROOM_GAP;
      siteDepth = Math.max(siteDepth, r.z1);
    }
    if (!rooms.length) roomX += 4;
    const siteX1 = Math.max(roomX - DIM.ROOM_GAP + DIM.SITE_MARGIN, siteX0 + 4);
    L.sites.set(site.id, { x0: siteX0, z0: 0, x1: siteX1, z1: siteDepth + DIM.SITE_MARGIN, name: site.name });
    cursorX = siteX1 + DIM.SITE_GAP;
  }
  // salles sans site
  for (const room of [...ents.values()].filter((e) => e.type === 'room' && !L.rooms.has(e.id)).sort(byName)) {
    const r = layoutRoom(room, cursorX, DIM.SITE_MARGIN);
    cursorX = r.x1 + DIM.SITE_GAP;
  }

  function layoutRoom(room, ox, oz) {
    const racks = kids(room.id).filter((e) => e.type === 'rack');
    const local = [];
    for (const rk of racks) {
      const a = rk.attrs || {};
      const rowIndex = Number(a.rowIndex ?? 0);
      const slot = Number(a.slot ?? 0);
      let x = slot * (DIM.RACK_W + DIM.RACK_GAP) + DIM.RACK_W / 2;
      let z = rowIndex * (DIM.RACK_D + DIM.AISLE) + DIM.RACK_D / 2;
      if (Array.isArray(a.pos) && a.pos.length >= 2) { x = Number(a.pos[0]); z = Number(a.pos[1]); }
      const rotDeg = a.rotation != null ? Number(a.rotation) : (rowIndex % 2 ? 180 : 0);
      local.push({ rk, x, z, rot: (rotDeg * Math.PI) / 180 });
    }
    let lx0 = 0; let lz0 = 0; let lx1 = 4; let lz1 = 3;
    if (local.length) {
      lx0 = Math.min(...local.map((p) => p.x - DIM.RACK_W / 2));
      lx1 = Math.max(...local.map((p) => p.x + DIM.RACK_W / 2));
      lz0 = Math.min(...local.map((p) => p.z - DIM.RACK_D / 2));
      lz1 = Math.max(...local.map((p) => p.z + DIM.RACK_D / 2));
    }
    const dx = ox + DIM.ROOM_MARGIN - lx0;
    const dz = oz + DIM.ROOM_MARGIN - lz0;
    for (const p of local) placeRack(p.rk, p.x + dx, p.z + dz, p.rot, room.id);
    // equipements poses au sol (bornes Wi-Fi...) le long du bord de la salle
    const floorDevs = kids(room.id).filter((e) => e.cls === 'physical' && e.type !== 'rack');
    floorDevs.forEach((d, i) => {
      const x = ox + DIM.ROOM_MARGIN + i * 0.8;
      const z = oz + (lz1 - lz0) + DIM.ROOM_MARGIN * 1.6;
      L.devices.set(d.id, { x, y: 0.15, z, w: 0.35, h: 0.3, d: 0.35, rot: 0, front: [0, 1], rackId: null });
      placedDevices.add(d.id);
    });
    const extraZ = floorDevs.length ? 1 : 0;
    const r = {
      x0: ox, z0: oz, x1: ox + (lx1 - lx0) + DIM.ROOM_MARGIN * 2,
      z1: oz + (lz1 - lz0) + DIM.ROOM_MARGIN * 2 + extraZ, name: room.name, siteId: room.parent,
    };
    L.rooms.set(room.id, r);
    return r;
  }

  function placeRack(rk, x, z, rot, roomId) {
    const units = Number(rk.attrs?.units || 42);
    const h = DIM.RACK_BASE + units * DIM.U + 0.04;
    maxRackH = Math.max(maxRackH, h);
    const front = [Math.round(Math.sin(rot) * 1e6) / 1e6, Math.round(Math.cos(rot) * 1e6) / 1e6];
    L.racks.set(rk.id, { x, z, rot, front, units, h, roomId });
    const devs = kids(rk.id).filter((e) => RACK_DEVICE_TYPES.has(e.type));
    const used = [];
    const withU = devs.filter((d) => d.attrs?.u != null).sort((a, b) => a.attrs.u - b.attrs.u);
    const noU = devs.filter((d) => d.attrs?.u == null).sort(byName);
    for (const d of withU) {
      const hU = Math.max(1, Number(d.attrs.height ?? 1));
      if (Number(d.attrs.height) === 0) continue;
      used.push([d.attrs.u, d.attrs.u + hU - 1]);
      placeDevice(d, rk.id, Number(d.attrs.u), hU);
    }
    // sans position U : on remplit par le haut
    for (const d of noU) {
      const hU = Math.max(1, Number(d.attrs?.height ?? (d.type === 'server' ? 2 : 1)));
      let u = units - hU + 1;
      while (u >= 1 && used.some(([lo, hi]) => u <= hi && u + hU - 1 >= lo)) u--;
      if (u < 1) u = 1;
      used.push([u, u + hU - 1]);
      placeDevice(d, rk.id, u, hU);
    }
  }

  function placeDevice(d, rackId, u, hU) {
    const rk = L.racks.get(rackId);
    const y = DIM.RACK_BASE + (u - 1) * DIM.U + (hU * DIM.U) / 2;
    L.devices.set(d.id, {
      x: rk.x, y, z: rk.z, w: DIM.DEV_W, h: hU * DIM.U - 0.005, d: DIM.DEV_D, rot: rk.rot, front: rk.front, rackId, u, hU,
    });
    placedDevices.add(d.id);
  }

  // ------------------------------------------------------------ zone "non positionnes"
  const unplaced = [...ents.values()].filter((e) => e.cls === 'physical' && RACK_DEVICE_TYPES.has(e.type) && !placedDevices.has(e.id))
    .sort((a, b) => a.type.localeCompare(b.type) || String(a.name).localeCompare(String(b.name), 'fr', { numeric: true }));
  if (unplaced.length) {
    const ox = cursorX;
    const perRack = 16;
    const nRacks = Math.ceil(unplaced.length / perRack);
    const cols = Math.min(nRacks, 8);
    const rowsN = Math.ceil(nRacks / cols);
    for (let i = 0; i < nRacks; i++) {
      const id = `${STAGING_ID}:${i}`;
      const col = i % cols;
      const rowIdx = Math.floor(i / cols);
      const x = ox + DIM.ROOM_MARGIN + col * (DIM.RACK_W + 0.25) + DIM.RACK_W / 2;
      const z = DIM.SITE_MARGIN + DIM.ROOM_MARGIN + rowIdx * (DIM.RACK_D + DIM.AISLE) + DIM.RACK_D / 2;
      const rot = rowIdx % 2 ? Math.PI : 0;
      L.racks.set(id, { x, z, rot, front: [0, rowIdx % 2 ? -1 : 1], units: 42, h: DIM.RACK_BASE + 42 * DIM.U + 0.04, roomId: STAGING_ID, virtual: true });
      unplaced.slice(i * perRack, (i + 1) * perRack).forEach((d, k) => {
        const hU = 2;
        placeDevice(d, id, 41 - k * 2 - 1, hU);
      });
    }
    const x1 = ox + DIM.ROOM_MARGIN * 2 + cols * (DIM.RACK_W + 0.25);
    const z1 = DIM.SITE_MARGIN + DIM.ROOM_MARGIN * 2 + rowsN * (DIM.RACK_D + DIM.AISLE);
    L.staging = { x0: ox, z0: DIM.SITE_MARGIN, x1, z1, name: 'Équipements non positionnés (découverts)' };
    L.rooms.set(STAGING_ID, { ...L.staging, virtual: true });
    cursorX = x1 + DIM.SITE_GAP;
  }

  const physBounds = unionBounds([...L.sites.values(), ...L.rooms.values()]) || { x0: -4, z0: -4, x1: 4, z1: 4 };
  const rackTop = maxRackH;
  L.heights = {
    rackTop,
    tray: rackTop + 0.28,
    hyper: rackTop + 1.1 + explode * 2.4,
  };

  // ------------------------------------------------------------ couche virtuelle
  const hyperY = L.heights.hyper;
  const islands = new Map();
  const vmParentOk = new Set();
  for (const h of [...ents.values()].filter((e) => e.type === 'hypervisor')) {
    const vms = kids(h.id).filter((e) => e.cls === 'vm').sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr', { numeric: true }));
    vms.forEach((v) => vmParentOk.add(v.id));
    const key = h.attrs?.cluster ? `c:${h.attrs.cluster}` : `s:${h.id}`;
    if (!islands.has(key)) islands.set(key, { key, name: h.attrs?.cluster || null, hosts: [] });
    islands.get(key).hosts.push({ e: h, vms, anchor: L.devices.has(h.parent) ? h.parent : null });
  }
  const orphans = [...ents.values()].filter((e) => e.cls === 'vm' && !vmParentOk.has(e.id))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr', { numeric: true }));
  if (orphans.length) {
    islands.set('orphans', { key: 'orphans', name: 'VM non rattachées à un hyperviseur', hosts: [{ e: { id: '__orphans__', name: 'Non rattachées' }, vms: orphans, anchor: null, virtual: true }] });
  }

  const islandList = [];
  for (const isl of islands.values()) {
    isl.hosts.sort((a, b) => String(a.e.name).localeCompare(String(b.e.name), 'fr', { numeric: true }));
    for (const hst of isl.hosts) {
      const n = Math.max(1, hst.vms.length);
      const cols = Math.max(2, Math.ceil(Math.sqrt(n * 1.4)));
      const rows = Math.max(1, Math.ceil(n / cols));
      hst.cols = cols;
      hst.w = Math.max(0.9, cols * DIM.VM_PITCH + DIM.TILE_PAD * 2);
      hst.d = Math.max(0.6, rows * DIM.VM_PITCH + DIM.TILE_PAD * 2 + 0.12);
    }
    const k = isl.hosts.length;
    const icols = Math.max(1, Math.min(k, Math.ceil(Math.sqrt(k * 2.2))));
    // grille de plateaux
    let z = DIM.ISLAND_PAD + 0.25;
    let width = 0;
    for (let i = 0; i < k; i += icols) {
      const rowHosts = isl.hosts.slice(i, i + icols);
      let x = DIM.ISLAND_PAD;
      const rowD = Math.max(...rowHosts.map((h) => h.d));
      for (const h of rowHosts) {
        h.lx = x + h.w / 2;
        h.lz = z + h.d / 2;
        x += h.w + DIM.TILE_GAP;
      }
      width = Math.max(width, x - DIM.TILE_GAP + DIM.ISLAND_PAD);
      z += rowD + DIM.TILE_GAP;
    }
    isl.w = width;
    isl.d = z - DIM.TILE_GAP + DIM.ISLAND_PAD;
    // cible : au-dessus du barycentre des serveurs physiques
    const anchors = isl.hosts.map((h) => h.anchor && L.devices.get(h.anchor)).filter(Boolean);
    let cx; let cz;
    if (anchors.length) {
      cx = anchors.reduce((s, a) => s + a.x, 0) / anchors.length;
      cz = anchors.reduce((s, a) => s + a.z, 0) / anchors.length;
    } else if (L.staging) {
      cx = (L.staging.x0 + L.staging.x1) / 2; cz = (L.staging.z0 + L.staging.z1) / 2;
    } else {
      cx = (physBounds.x0 + physBounds.x1) / 2; cz = (physBounds.z0 + physBounds.z1) / 2;
    }
    isl.cx = cx; isl.cz = cz;
    isl.tx = cx; isl.tz = cz;
    islandList.push(isl);
  }
  resolveOverlaps(islandList);
  for (const isl of islandList) {
    const x0 = isl.cx - isl.w / 2;
    const z0 = isl.cz - isl.d / 2;
    L.islands.set(isl.key, { x0, z0, x1: x0 + isl.w, z1: z0 + isl.d, y: hyperY - 0.05, name: isl.name, key: isl.key });
    for (const h of isl.hosts) {
      const tx = x0 + h.lx;
      const tz = z0 + h.lz;
      L.tiles.set(h.e.id, { x: tx, y: hyperY, z: tz, w: h.w, d: h.d, anchor: h.anchor, island: isl.key, virtual: !!h.virtual });
      const gx0 = tx - h.w / 2 + DIM.TILE_PAD + DIM.VM_PITCH / 2;
      const gz0 = tz - h.d / 2 + DIM.TILE_PAD + 0.12 + DIM.VM_PITCH / 2;
      h.vms.forEach((v, i) => {
        const c = i % h.cols;
        const r = Math.floor(i / h.cols);
        L.vms.set(v.id, { x: gx0 + c * DIM.VM_PITCH, y: hyperY + DIM.TILE_H / 2 + DIM.VM / 2 + 0.01, z: gz0 + r * DIM.VM_PITCH, s: DIM.VM, tile: h.e.id });
      });
    }
  }

  // ------------------------------------------------------------ externes
  const allBounds = unionBounds([physBounds, ...L.islands.values()]) || physBounds;
  const externals = [...ents.values()].filter((e) => e.type === 'external');
  const linkedTo = new Map();
  for (const l of model.links.values()) {
    for (const [x, y] of [[l.a, l.b], [l.b, l.a]]) {
      if (ents.get(x)?.type !== 'external') continue;
      if (!linkedTo.has(x)) linkedTo.set(x, []);
      linkedTo.get(x).push(y);
    }
  }
  const level = new Map();
  const extPos = new Map();
  for (const e of externals) {
    const devs = (linkedTo.get(e.id) || []).map((id) => L.devices.get(id)).filter(Boolean);
    if (devs.length) {
      level.set(e.id, 0);
      extPos.set(e.id, devs.reduce((s, d) => s + d.x, 0) / devs.length);
    }
  }
  for (let pass = 1; pass <= 3; pass++) {
    for (const e of externals) {
      if (level.has(e.id)) continue;
      const nb = (linkedTo.get(e.id) || []).filter((id) => level.get(id) === pass - 1);
      if (nb.length) {
        level.set(e.id, pass);
        extPos.set(e.id, nb.reduce((s, id) => s + extPos.get(id), 0) / nb.length);
      }
    }
  }
  const cxAll = (allBounds.x0 + allBounds.x1) / 2;
  for (const e of externals) {
    if (!level.has(e.id)) { level.set(e.id, 1); extPos.set(e.id, cxAll); }
  }
  const byLevel = new Map();
  for (const e of externals) {
    const lv = level.get(e.id);
    if (!byLevel.has(lv)) byLevel.set(lv, []);
    byLevel.get(lv).push(e);
  }
  // distance des externes proportionnelle a la taille de l'infrastructure
  const span = Math.max(allBounds.x1 - allBounds.x0, allBounds.z1 - allBounds.z0);
  const extGap = Math.max(2.5, Math.min(6, span * 0.18));
  const extZ0 = Math.min(allBounds.z0, 0) - extGap;
  const extY = (L.islands.size ? L.heights.hyper : L.heights.rackTop) + Math.max(1.2, Math.min(1.6, span * 0.08));
  const lvDz = Math.max(2.2, Math.min(4.5, span * 0.14));
  for (const [lv, list] of byLevel) {
    list.sort((a, b) => extPos.get(a.id) - extPos.get(b.id) || String(a.name).localeCompare(String(b.name)));
    const spacing = Math.max(2.6, Math.min(4.6, span * 0.12));
    const xs = list.map((e) => extPos.get(e.id));
    for (let i = 1; i < xs.length; i++) if (xs[i] < xs[i - 1] + spacing) xs[i] = xs[i - 1] + spacing;
    // recentre le groupe sur sa position moyenne souhaitee
    const want = list.reduce((s, e) => s + extPos.get(e.id), 0) / list.length;
    const have = xs.reduce((s, x) => s + x, 0) / xs.length;
    const shift = want - have;
    list.forEach((e, i) => {
      L.externals.set(e.id, { x: xs[i] + shift, y: extY + lv * 1.2, z: extZ0 - lv * lvDz, r: e.attrs?.kind === 'internet' ? 0.8 : 0.6, level: lv });
    });
  }

  const extBounds = L.externals.size ? {
    x0: Math.min(...[...L.externals.values()].map((p) => p.x - 1)), x1: Math.max(...[...L.externals.values()].map((p) => p.x + 1)),
    z0: Math.min(...[...L.externals.values()].map((p) => p.z - 1)), z1: Math.max(...[...L.externals.values()].map((p) => p.z + 1)),
  } : null;
  L.bounds = unionBounds([allBounds, extBounds].filter(Boolean));
  L.bounds.y1 = hyperY + 1;
  return L;
}

function unionBounds(list) {
  const valid = list.filter(Boolean);
  if (!valid.length) return null;
  return {
    x0: Math.min(...valid.map((b) => b.x0)), z0: Math.min(...valid.map((b) => b.z0)),
    x1: Math.max(...valid.map((b) => b.x1)), z1: Math.max(...valid.map((b) => b.z1)),
  };
}

/** Separation iterative des ilots (rectangles) qui se chevauchent. */
function resolveOverlaps(list) {
  const gap = DIM.ISLAND_GAP;
  for (let iter = 0; iter < 400; iter++) {
    let moved = false;
    // rappel doux vers la position cible (desactive en fin de resolution)
    if (iter < 250) {
      for (const isl of list) {
        isl.cx += (isl.tx - isl.cx) * 0.03;
        isl.cz += (isl.tz - isl.cz) * 0.03;
      }
    }
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const ox = (a.w + b.w) / 2 + gap - Math.abs(a.cx - b.cx);
        const oz = (a.d + b.d) / 2 + gap - Math.abs(a.cz - b.cz);
        if (ox <= 0 || oz <= 0) continue;
        moved = true;
        if (ox < oz) {
          const s = (a.cx < b.cx || (a.cx === b.cx && i < j) ? -1 : 1) * (ox / 2 + 0.01);
          a.cx += s; b.cx -= s;
        } else {
          const s = (a.cz < b.cz || (a.cz === b.cz && i < j) ? -1 : 1) * (oz / 2 + 0.01);
          a.cz += s; b.cz -= s;
        }
      }
    }
    if (!moved && iter >= 250) break;
  }
}

/** Point d'accroche en facade d'un equipement (pour cables et flux). */
export function deviceFrontPoint(dev, offset = 0.02) {
  return [dev.x + dev.front[0] * (dev.d / 2 + offset), dev.y, dev.z + dev.front[1] * (dev.d / 2 + offset)];
}
