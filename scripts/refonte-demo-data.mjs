#!/usr/bin/env node
// Exporte le monde de démonstration vers public/refonte/js/world.js, utilisé par la
// démo interactive du nouveau front (servie sur /refonte/). A relancer si
// server/collectors/demo-world.js change :  node scripts/refonte-demo-data.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemoWorld } from '../server/collectors/demo-world.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUTPUT = path.join(root, 'public', 'refonte', 'js', 'world.js');

/** Données de la démo : salle A de Paris, hôtes, VM et liens internes à la salle. */
export function buildRefonteData() {
  const w = buildDemoWorld();
  const room = w.inventory.sites.find((s) => s.id === 'site-par').rooms.find((r) => r.id === 'room-par-a');
  const firstIp = (ip) => (Array.isArray(ip) ? ip[0] : ip) || null;
  const roomIds = new Set();
  return {
    room: {
      id: room.id,
      name: room.name,
      rows: room.rows.map((row) => ({
        name: row.name,
        rotation: row.rotation || 0,
        racks: row.racks.map((rack) => ({
          id: rack.id,
          units: rack.units,
          devices: rack.devices.map((d) => {
            roomIds.add(d.id);
            return { id: d.id, type: d.type, name: d.name, u: d.u, height: d.height || 1, vendor: d.vendor, model: d.model, ip: firstIp(d.ip) };
          }),
        })),
      })),
    },
    hosts: w.hosts.map((h) => ({ id: h.id, cluster: h.cluster, platform: h.platform, memGB: h.memGB, cores: h.cores, rack: h.rack, model: `${h.vendor} ${h.model}`, version: h.version, ip: h.ip })),
    vms: w.vms.map((v) => ({ name: v.name, host: v.host, cluster: v.cluster, app: v.app, role: v.role, os: v.os, ip: v.ip, vlan: v.vlan, memGB: v.memGB, cores: v.cores, cpuBase: v.cpuBase, memBase: v.memBase, powered: v.powered })),
    links: w.inventory.links
      .filter((l) => roomIds.has(l.a) && roomIds.has(l.b))
      .map((l) => ({ a: l.a, aPort: l.aPort || null, b: l.b, bPort: l.bPort || null, speed: l.speed, kind: l.kind })),
  };
}

export function renderModule(data = buildRefonteData()) {
  const banner = '// Fichier généré par scripts/refonte-demo-data.mjs à partir du monde de démonstration. Ne pas modifier à la main.\n';
  return `${banner}export default ${JSON.stringify(data)};\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = buildRefonteData();
  fs.writeFileSync(OUTPUT, renderModule(data));
  console.log(`${path.relative(root, OUTPUT)} : ${data.room.rows.reduce((n, r) => n + r.racks.length, 0)} baies, ${data.hosts.length} hôtes, ${data.vms.length} VM, ${data.links.length} liens`);
}
