// Conversion de l'inventaire physique (config/inventory.json) en snapshot.
// L'inventaire decrit ce qui ne se decouvre pas : sites, salles, rangees,
// baies, position des equipements (U), cablage connu, reseaux externes.
import { ENTITY_TYPES, RACK_DEVICE_TYPES, buildKeys, parseSpeed, toArray } from '../../shared/model.js';

const RESERVED = new Set(['id', 'type', 'name', 'u', 'height', 'hostname', 'fqdn', 'serial', 'ip', 'mac', 'uuid', 'attrs', 'devices', 'keys']);
const DEFAULT_HEIGHT = { server: 2, storage: 4, switch: 1, router: 1, firewall: 1, loadbalancer: 1, appliance: 1, pdu: 0, ups: 3 };

/**
 * @returns {{snapshot:{entities:object[], links:object[]}, networks:object[], warnings:string[]}}
 */
export function inventoryToSnapshot(inv = {}) {
  const entities = [];
  const links = [];
  const warnings = [];
  const ids = new Set();

  const add = (e) => {
    if (!e.id) { warnings.push(`entite sans id ignoree (${e.name || e.type})`); return false; }
    if (ids.has(e.id)) { warnings.push(`id en double : ${e.id}`); return false; }
    ids.add(e.id);
    entities.push(e);
    return true;
  };

  toArray(inv.sites).forEach((site, si) => {
    add({ id: site.id, type: 'site', name: site.name || site.id, attrs: { order: si, location: site.location, ...site.attrs } });
    toArray(site.rooms).forEach((room, ri) => {
      add({ id: room.id, type: 'room', name: room.name || room.id, parent: site.id, attrs: { order: ri, ...room.attrs } });
      toArray(room.rows).forEach((row, rowIndex) => {
        toArray(row.racks).forEach((rack, slot) => {
          const units = rack.units || 42;
          add({
            id: rack.id, type: 'rack', name: rack.name || rack.id, parent: room.id,
            attrs: {
              row: row.name ?? String(rowIndex + 1), rowIndex, slot: rack.slot ?? slot, units,
              pos: rack.pos, rotation: rack.rotation ?? row.rotation, ...rack.attrs,
            },
          });
          const used = [];
          for (const dev of toArray(rack.devices)) {
            const ent = deviceEntity(dev, rack.id, warnings);
            if (!ent) continue;
            if (ent.attrs.u != null && ent.attrs.height > 0) {
              const lo = ent.attrs.u;
              const hi = lo + ent.attrs.height - 1;
              if (hi > units) warnings.push(`${ent.id} depasse la baie ${rack.id} (U${lo}-U${hi} > ${units}U)`);
              const clash = used.find((o) => lo <= o.hi && hi >= o.lo);
              if (clash) warnings.push(`${ent.id} chevauche ${clash.id} dans ${rack.id}`);
              used.push({ id: ent.id, lo, hi });
            }
            add(ent);
          }
        });
      });
      for (const dev of toArray(room.devices)) {
        const ent = deviceEntity(dev, room.id, warnings);
        if (ent) add(ent);
      }
    });
  });

  for (const dev of toArray(inv.devices)) {
    const ent = deviceEntity(dev, dev.parent || null, warnings);
    if (ent) add(ent);
  }

  for (const ext of toArray(inv.externals)) {
    add({
      id: ext.id, type: 'external', name: ext.name || ext.id,
      keys: buildKeys({ ip: ext.ip }),
      attrs: { kind: ext.kind || 'network', cidrs: ext.cidrs, default: ext.default, ...ext.attrs },
    });
  }

  for (const l of toArray(inv.links)) {
    if (!l.a || !l.b) { warnings.push('lien sans extremite ignore'); continue; }
    links.push({
      a: l.a, aPort: l.aPort, b: l.b, bPort: l.bPort, kind: l.kind || null,
      speedBps: parseSpeed(l.speed ?? l.speedBps), label: l.label || null,
    });
  }

  const networks = toArray(inv.networks).filter((n) => n && n.cidr);
  return { snapshot: { entities, links, flows: [] }, networks, warnings };
}

function deviceEntity(dev, parent, warnings) {
  if (!dev || !dev.id) { warnings.push(`equipement sans id dans ${parent}`); return null; }
  let type = dev.type || 'server';
  if (!ENTITY_TYPES[type]) { warnings.push(`${dev.id} : type inconnu "${type}" (appliance utilise)`); type = 'appliance'; }
  const attrs = {};
  for (const [k, v] of Object.entries(dev)) if (!RESERVED.has(k)) attrs[k] = v;
  Object.assign(attrs, dev.attrs || {});
  if (RACK_DEVICE_TYPES.has(type)) {
    attrs.height = dev.height ?? DEFAULT_HEIGHT[type] ?? 1;
    if (dev.u != null) attrs.u = Number(dev.u);
  }
  if (dev.serial) attrs.serial = dev.serial;
  if (dev.hostname) attrs.hostname = dev.hostname;
  if (dev.ip) attrs.ip = toArray(dev.ip);
  return {
    id: dev.id, type, name: dev.name || dev.hostname || dev.id, parent,
    keys: [...buildKeys(dev), ...toArray(dev.keys)],
    attrs,
  };
}
