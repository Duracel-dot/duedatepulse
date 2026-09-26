// Collecteur SNMP v2c / v3 : equipements reseau (commutateurs, routeurs, pare-feu...).
//
// Interroge le groupe systeme, ENTITY-MIB (modele, numero de serie du chassis),
// IF-MIB (etat et debit des ports) et LLDP-MIB (voisins -> liens de cablage).
// Le module net-snmp (dependance optionnelle) est charge a la demande.
import { Collector } from './base.js';
import { buildKeys, hostKey, fqdnKey, normalizeMac, isIPv4 } from '../../shared/model.js';
import { ipv6ToString } from './netflow-parser.js';

export const SYSTEM_OIDS = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysObjectID: '1.3.6.1.2.1.1.2.0',
  sysUpTime: '1.3.6.1.2.1.1.3.0',
  sysName: '1.3.6.1.2.1.1.5.0',
  sysLocation: '1.3.6.1.2.1.1.6.0',
  sysServices: '1.3.6.1.2.1.1.7.0',
};

export const ENTITY_COLS = {
  class: '1.3.6.1.2.1.47.1.1.1.1.5',
  serial: '1.3.6.1.2.1.47.1.1.1.1.11',
  model: '1.3.6.1.2.1.47.1.1.1.1.13',
};

// noms d'interfaces (toujours lus : correspondance des ports LLDP)
export const IF_NAME_COLS = {
  descr: '1.3.6.1.2.1.2.2.1.2',
  name: '1.3.6.1.2.1.31.1.1.1.1',
};

export const IF_COLS = {
  type: '1.3.6.1.2.1.2.2.1.3',
  mac: '1.3.6.1.2.1.2.2.1.6',
  admin: '1.3.6.1.2.1.2.2.1.7',
  oper: '1.3.6.1.2.1.2.2.1.8',
  inErrors: '1.3.6.1.2.1.2.2.1.14',
  hcIn: '1.3.6.1.2.1.31.1.1.1.6',
  hcOut: '1.3.6.1.2.1.31.1.1.1.10',
  highSpeed: '1.3.6.1.2.1.31.1.1.1.15',
  alias: '1.3.6.1.2.1.31.1.1.1.18',
};

// repli pour les agents sans compteurs 64 bits
export const IF_COLS_32 = {
  speed: '1.3.6.1.2.1.2.2.1.5',
  in32: '1.3.6.1.2.1.2.2.1.10',
  out32: '1.3.6.1.2.1.2.2.1.16',
};

export const LLDP_LOC_COLS = {
  portIdSubtype: '1.0.8802.1.1.2.1.3.7.1.2',
  portId: '1.0.8802.1.1.2.1.3.7.1.3',
  portDesc: '1.0.8802.1.1.2.1.3.7.1.4',
};

export const LLDP_REM_COLS = {
  chassisId: '1.0.8802.1.1.2.1.4.1.1.5',
  chassisIdSubtype: '1.0.8802.1.1.2.1.4.1.1.4',
  portIdSubtype: '1.0.8802.1.1.2.1.4.1.1.6',
  portId: '1.0.8802.1.1.2.1.4.1.1.7',
  portDesc: '1.0.8802.1.1.2.1.4.1.1.8',
  sysName: '1.0.8802.1.1.2.1.4.1.1.9',
  sysDesc: '1.0.8802.1.1.2.1.4.1.1.10',
  capEnabled: '1.0.8802.1.1.2.1.4.1.1.12',
};

// lldpRemManAddrIfSubtype : l'adresse de gestion est dans l'index
export const LLDP_MAN_ADDR = '1.0.8802.1.1.2.1.4.2.1.3';

// types d'interfaces retenus : ethernet, LAG, gigabit, fast ethernet, fibre channel
const PHYS_IF_TYPES = new Set([6, 161, 117, 62, 69, 56]);
const LAG_IF_TYPE = 161;

// ---------------------------------------------------------------------------
// Conversions de valeurs SNMP (Buffer, nombre, chaine)
// ---------------------------------------------------------------------------

function str(v) {
  if (v == null) return '';
  const s = Buffer.isBuffer(v) ? v.toString('utf8') : String(v);
  return s.replace(/\0+$/g, '').trim();
}

function num(v) {
  if (v == null || v === '') return null;
  if (Buffer.isBuffer(v)) {
    let n = 0;
    for (const b of v) n = n * 256 + b;
    return n;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isPrintable(buf) {
  for (const b of buf) if (b < 0x20 || b > 0x7e) return false;
  return true;
}

function hexColon(buf) {
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join(':');
}

function macStr(v) {
  if (v == null) return null;
  if (Buffer.isBuffer(v)) return v.length === 6 ? normalizeMac(v.toString('hex')) : normalizeMac(v.toString('latin1'));
  return normalizeMac(String(v));
}

function numSort(a, b) { return Number(a) - Number(b); }

/** Identifiant LLDP (chassis ou port) en texte selon son sous-type. */
export function formatLldpId(v, subtype, kind = 'chassis') {
  if (v == null) return '';
  const isMac = kind === 'chassis' ? subtype === 4 : subtype === 3;
  const isAddr = kind === 'chassis' ? subtype === 5 : subtype === 4;
  if (isMac) return macStr(v) || str(v);
  if (!Buffer.isBuffer(v)) return String(v).trim();
  if (isAddr && v.length >= 5) {
    // 1er octet : famille d'adresse IANA (1 = IPv4, 2 = IPv6)
    if (v[0] === 1 && v.length === 5) return `${v[1]}.${v[2]}.${v[3]}.${v[4]}`;
    if (v[0] === 2 && v.length === 17) return ipv6ToString(v, 1);
  }
  const trimmed = v.subarray(0, v.length - (v[v.length - 1] === 0 ? 1 : 0));
  return isPrintable(trimmed) ? trimmed.toString('latin1').trim() : hexColon(v);
}

// ---------------------------------------------------------------------------
// Fabricant, type d'equipement, capacites LLDP
// ---------------------------------------------------------------------------

const VENDORS = {
  2: 'IBM', 9: 'Cisco', 11: 'HP', 43: '3Com', 171: 'D-Link', 207: 'Allied Telesis', 232: 'HPE', 311: 'Microsoft',
  318: 'APC', 534: 'Eaton', 674: 'Dell', 789: 'NetApp', 890: 'Zyxel', 1588: 'Brocade',
  1916: 'Extreme Networks', 1991: 'Brocade (Foundry)', 2011: 'Huawei', 2620: 'Check Point',
  2636: 'Juniper', 3375: 'F5', 4526: 'Netgear', 5624: 'Extreme Networks', 6027: 'Dell (Force10)',
  6486: 'Alcatel-Lucent', 6876: 'VMware', 8072: 'net-snmp (Linux)', 8741: 'SonicWall', 11863: 'TP-Link',
  12356: 'Fortinet', 13742: 'Raritan', 14179: 'Cisco', 14823: 'Aruba', 14988: 'MikroTik', 25053: 'Ruckus',
  25461: 'Palo Alto Networks', 25506: 'H3C / HPE', 30065: 'Arista', 41112: 'Ubiquiti', 47196: 'Aruba (HPE)',
};

/** Numero d'entreprise IANA d'un sysObjectID (1.3.6.1.4.1.<n>...). */
export function enterpriseOf(sysObjectID) {
  const m = String(sysObjectID || '').replace(/^\./, '').replace(/^iso\./, '1.').match(/^1\.3\.6\.1\.4\.1\.(\d+)/);
  return m ? Number(m[1]) : null;
}

export function guessVendor(sysObjectID) {
  const n = enterpriseOf(sysObjectID);
  return n == null ? null : VENDORS[n] || `enterprise ${n}`;
}

const NET_OS_RE = /\b(cisco|ios|nx-os|junos|juniper|arista|eos|aruba|procurve|comware|cumulus|sonic|routeros|mikrotik|fortigate|fortios|pan-os|edgeswitch|edgeos|unifi|dell emc networking|os10|ftos|huawei|vrp|extremexos|exos|voss|netgear|brocade|alcatel|omniswitch)\b/i;
const SERVER_OS_RE = /\b(windows|vmware|esxi|proxmox|ubuntu|debian|red hat|rhel|centos|rocky|alma|suse|freebsd|hyper-v)\b/i;

/** Type d'un equipement interroge (type configure prioritaire, repli 'switch'). */
export function guessDeviceType({ sysDescr = '', sysObjectID = '', services = null } = {}) {
  const d = String(sysDescr || '');
  const ent = enterpriseOf(sysObjectID);
  if ([12356, 25461, 2620, 8741].includes(ent) ||
    /\b(fortigate|pan-os|palo alto|adaptive security appliance|firepower|sonicwall|check ?point|stormshield|pfsense|opnsense|sophos|watchguard)\b/i.test(d)) return 'firewall';
  if (ent === 3375 || /\b(big-ip|netscaler|citrix adc|kemp|loadmaster)\b/i.test(d)) return 'loadbalancer';
  if (/\b(ups|smart-ups|symmetra|galaxy|eaton 9)/i.test(d) && !/\bpdu\b/i.test(d)) return 'ups';
  if (/\b(pdu|sentry|raritan|dominion px|switched rack)\b/i.test(d)) return 'pdu';
  if (ent === 789 || /\b(netapp|ontap|isilon|onefs|powerstore|powervault|unity|3par|primera|nimble|pure storage|purity|synology|qnap|truenas|storeonce|data domain)\b/i.test(d)) return 'storage';
  if (ent === 311 || (SERVER_OS_RE.test(d) && !NET_OS_RE.test(d))) return 'server';
  if (/\b(router|isr\d*|asr\d*|ios[ -]xr|routeros|vyos|edgeos|edgerouter)\b/i.test(d)) return 'router';
  const s = Number(services) || 0;
  if (s & 2) return 'switch';           // couche 2
  if (s & 4) return 'router';           // couche 3 seule
  if (ent === 8072 && (s & 64)) return 'server';
  return 'switch';
}

// lldpRemSysCapEnabled (BITS) : le bit 0 est le bit de poids fort du 1er octet
export const LLDP_CAPS = ['other', 'repeater', 'bridge', 'wlanAccessPoint', 'router', 'telephone', 'docsisCableDevice', 'stationOnly'];

/** Decode le champ BITS des capacites LLDP -> liste de noms. */
export function decodeLldpCapabilities(v) {
  if (v == null) return [];
  const buf = Buffer.isBuffer(v) ? v : typeof v === 'number' ? Buffer.from([v & 0xff]) : Buffer.from(String(v), 'latin1');
  const caps = [];
  for (let bit = 0; bit < Math.min(buf.length * 8, 16); bit++) {
    if (buf[bit >> 3] & (0x80 >> (bit & 7))) caps.push(LLDP_CAPS[bit] || `bit${bit}`);
  }
  return caps;
}

/** Type d'un voisin LLDP ; null = a ignorer (telephone IP). */
export function neighborType(caps = [], sysDesc = '') {
  if (caps.includes('telephone')) return null;
  if (caps.includes('wlanAccessPoint')) return 'accesspoint';
  // hote Linux/ESXi avec un pont logiciel : reste un serveur
  if (SERVER_OS_RE.test(sysDesc) && !NET_OS_RE.test(sysDesc)) return 'server';
  if (caps.includes('bridge')) return 'switch';
  if (caps.includes('router')) return 'router';
  if (caps.includes('stationOnly')) return 'server';
  return NET_OS_RE.test(sysDesc) ? 'switch' : 'server';
}

// ---------------------------------------------------------------------------
// Analyse des donnees brutes d'une cible
// ---------------------------------------------------------------------------

/** Premier chassis (entPhysicalClass = 3) : modele et numero de serie. */
export function parseChassis(entity = {}) {
  const cls = entity.class || {};
  let idx = Object.keys(cls).sort(numSort).find((i) => num(cls[i]) === 3);
  if (idx == null) idx = Object.keys(entity.serial || {}).sort(numSort).find((i) => str(entity.serial[i]));
  if (idx == null) return { serial: null, model: null };
  return { serial: str(entity.serial?.[idx]) || null, model: str(entity.model?.[idx]) || null };
}

/** Colonnes IF-MIB -> interfaces triees par ifIndex. */
export function parseInterfaces(cols = {}) {
  const idxs = new Set();
  for (const k of ['descr', 'name', 'type']) for (const i of Object.keys(cols[k] || {})) idxs.add(i);
  return [...idxs].sort(numSort).map((i) => {
    const hc = cols.hcIn?.[i] != null;
    const high = num(cols.highSpeed?.[i]);
    const low = num(cols.speed?.[i]);
    const oper = num(cols.oper?.[i]);
    const admin = num(cols.admin?.[i]);
    const descr = str(cols.descr?.[i]);
    return {
      index: Number(i),
      name: str(cols.name?.[i]) || descr || `if${i}`,
      descr,
      alias: str(cols.alias?.[i]),
      type: num(cols.type?.[i]),
      mac: macStr(cols.mac?.[i]),
      admin: admin == null ? null : admin === 1 ? 'up' : 'down',
      oper: oper == null ? null : oper === 1 ? 'up' : 'down',
      // ifSpeed sature a 4 294 967 295 : ifHighSpeed (Mbit/s) prioritaire
      speedBps: high ? high * 1e6 : low || null,
      inOctets: num(hc ? cols.hcIn?.[i] : cols.in32?.[i]),
      outOctets: num(hc ? cols.hcOut?.[i] : cols.out32?.[i]),
      bits: hc ? 64 : 32,
      inErrors: num(cols.inErrors?.[i]),
    };
  });
}

/** Adresses de gestion LLDP indexees par "timeMark.localPortNum.remIndex". */
function parseManAddrs(man = {}) {
  const out = new Map();
  for (const suffix of Object.keys(man)) {
    const p = suffix.split('.').map(Number);
    if (p.length < 6) continue;
    const [subtype, len] = [p[3], p[4]];
    const bytes = p.slice(5, 5 + len);
    let ip = null;
    if (subtype === 1 && len === 4) ip = bytes.join('.');
    else if (subtype === 2 && len === 16) ip = ipv6ToString(Buffer.from(bytes));
    if (!ip) continue;
    const key = p.slice(0, 3).join('.');
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(ip);
  }
  return out;
}

/**
 * Voisins LLDP. Index de la table distante : timeMark.localPortNum.remIndex.
 * Le port local (lldpLocPortNum) est rapproche de l'ifIndex par nom de port
 * (lldpLocPortId / lldpLocPortDesc vs ifName / ifDescr), puis par egalite numerique.
 */
export function parseLldp(loc = {}, rem = {}, man = {}, interfaces = []) {
  const byName = new Map();
  const byMac = new Map();
  const byIndex = new Map();
  for (const i of interfaces) {
    byIndex.set(i.index, i);
    for (const n of [i.name, i.descr]) if (n && !byName.has(n.toLowerCase())) byName.set(n.toLowerCase(), i);
    if (i.mac && !byMac.has(i.mac)) byMac.set(i.mac, i);
  }
  const localIface = (portNum) => {
    const subtype = num(loc.portIdSubtype?.[portNum]);
    const id = loc.portId?.[portNum];
    if (subtype === 3) {
      const m = macStr(id);
      if (m && byMac.has(m)) return byMac.get(m);
    }
    for (const v of [formatLldpId(id, subtype, 'port'), str(loc.portDesc?.[portNum])]) {
      const i = v && byName.get(v.toLowerCase());
      if (i) return i;
    }
    if (subtype === 7 && byIndex.has(Number(str(id)))) return byIndex.get(Number(str(id)));
    return byIndex.get(Number(portNum)) || null;
  };

  const rows = new Map();
  for (const [col, values] of Object.entries(rem)) {
    for (const [suffix, v] of Object.entries(values || {})) {
      if (!rows.has(suffix)) rows.set(suffix, {});
      rows.get(suffix)[col] = v;
    }
  }
  const mans = parseManAddrs(man);
  const neighbors = [];
  for (const [suffix, e] of rows) {
    const parts = suffix.split('.');
    if (parts.length < 3) continue;
    const portNum = parts[1];
    const iface = localIface(portNum);
    const chassisIdSubtype = num(e.chassisIdSubtype);
    const portIdSubtype = num(e.portIdSubtype);
    const chassisId = formatLldpId(e.chassisId, chassisIdSubtype, 'chassis');
    const mgmtIp = [...(mans.get(parts.slice(0, 3).join('.')) || [])];
    if (chassisIdSubtype === 5 && (isIPv4(chassisId) || chassisId.includes(':')) && !mgmtIp.includes(chassisId)) mgmtIp.push(chassisId);
    neighbors.push({
      localPortNum: Number(portNum),
      ifIndex: iface ? iface.index : null,
      localPort: iface?.name || formatLldpId(loc.portId?.[portNum], num(loc.portIdSubtype?.[portNum]), 'port') || str(loc.portDesc?.[portNum]) || portNum,
      chassisIdSubtype,
      chassisId,
      portIdSubtype,
      portId: formatLldpId(e.portId, portIdSubtype, 'port'),
      portDesc: str(e.portDesc),
      sysName: str(e.sysName),
      sysDesc: str(e.sysDesc),
      caps: decodeLldpCapabilities(e.capEnabled),
      mgmtIp,
    });
  }
  return neighbors.sort((a, b) => a.localPortNum - b.localPortNum);
}

/** Donnees brutes d'une cible (voir collectTarget) -> donnees normalisees. */
export function parseTargetData(raw) {
  const s = raw.system || {};
  const interfaces = parseInterfaces(raw.ifaces);
  const chassis = parseChassis(raw.entity);
  const sysObjectID = str(s.sysObjectID).replace(/^\./, '');
  const ticks = num(s.sysUpTime);
  return {
    sysDescr: str(s.sysDescr),
    sysObjectID,
    sysName: str(s.sysName),
    location: str(s.sysLocation),
    services: num(s.sysServices),
    uptimeS: ticks == null ? null : Math.floor(ticks / 100),
    vendor: guessVendor(sysObjectID),
    serial: chassis.serial,
    model: chassis.model,
    interfaces,
    neighbors: parseLldp(raw.lldpLoc, raw.lldpRem, raw.lldpMan, interfaces),
    t: raw.t ?? null,
  };
}

// ---------------------------------------------------------------------------
// Debits
// ---------------------------------------------------------------------------

/** Difference de compteur ; null en cas de remise a zero. Gere le rebouclage 32 bits. */
export function counterDelta(prev, cur, bits = 64) {
  if (prev == null || cur == null) return null;
  if (cur >= prev) return cur - prev;
  if (bits === 32) {
    const d = cur + 2 ** 32 - prev;
    if (d < 2 ** 31) return d;
  }
  return null;
}

/** Compteurs d'interfaces a memoriser : { [ifIndex]: {in, out, err, bits} }. */
export function interfaceCounters(interfaces = []) {
  const out = {};
  for (const i of interfaces) {
    if (i.inOctets == null && i.outOctets == null) continue;
    out[i.index] = { in: i.inOctets, out: i.outOctets, err: i.inErrors, bits: i.bits };
  }
  return out;
}

/**
 * Debits entre deux releves.
 * @returns {{[ifIndex]: {rxBps, txBps, errors}}}  vide au premier releve
 */
export function computeRates(prev, cur, dtSec) {
  const out = {};
  if (!prev || !cur || !(dtSec > 0)) return out;
  for (const [idx, c] of Object.entries(cur)) {
    const p = prev[idx];
    if (!p) continue;
    const dIn = counterDelta(p.in, c.in, c.bits);
    const dOut = counterDelta(p.out, c.out, c.bits);
    out[idx] = {
      rxBps: dIn == null ? null : Math.round((dIn * 8) / dtSec),
      txBps: dOut == null ? null : Math.round((dOut * 8) / dtSec),
      errors: counterDelta(p.err, c.err, 32),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Construction du snapshot
// ---------------------------------------------------------------------------

function round1(v) { return v == null ? null : Math.round(v * 10) / 10; }

function utilOf(rx, tx, speed) {
  if (!speed || (rx == null && tx == null)) return null;
  return round1((Math.max(rx || 0, tx || 0) / speed) * 100);
}

function isIpHost(h) { return isIPv4(h) || String(h).includes(':'); }

function deviceEntity(r) {
  const t = r.target;
  const d = r.data;
  const info = d || r.last || {};
  const id = `snmp:${t.host}`;
  const sysName = info.sysName || '';
  const keys = new Set(buildKeys({ hostname: sysName || undefined, serial: info.serial, ip: isIpHost(t.host) ? t.host : undefined }));
  if (!isIpHost(t.host)) {
    for (const k of [hostKey(t.host), fqdnKey(t.host)]) if (k) keys.add(k);
  }
  if (!sysName && t.name && /^[a-z0-9][a-z0-9._-]*$/i.test(t.name)) {
    const k = hostKey(t.name);
    if (k) keys.add(k);
  }
  const e = {
    id,
    type: t.type || (d ? guessDeviceType(d) : info.type) || 'switch',
    name: t.name || sysName || t.host,
    keys: [...keys],
    status: 'ok',
    attrs: {
      vendor: info.vendor || null,
      model: info.model || null,
      serial: info.serial || null,
      sysDescr: info.sysDescr || null,
      location: info.location || null,
      ip: isIpHost(t.host) ? [t.host] : [],
    },
    metrics: {},
  };
  if (!d) {
    e.status = 'critical';
    e.statusText = `Injoignable en SNMP : ${r.error || 'pas de reponse'}`;
    return e;
  }
  const rates = r.rates || {};
  const ifaces = d.interfaces.filter((i) => PHYS_IF_TYPES.has(i.type));
  const ports = ifaces.filter((i) => i.type !== LAG_IF_TYPE);
  let rxSum = 0;
  let txSum = 0;
  let hasRate = false;
  e.attrs.sysObjectID = d.sysObjectID || null;
  e.attrs.interfaces = ifaces.map((i) => {
    const rt = rates[i.index] || {};
    if (i.type !== LAG_IF_TYPE && (rt.rxBps != null || rt.txBps != null)) {
      hasRate = true;
      rxSum += rt.rxBps || 0;
      txSum += rt.txBps || 0;
    }
    return {
      index: i.index,
      name: i.name,
      alias: i.alias || null,
      speedBps: i.speedBps,
      oper: i.oper,
      admin: i.admin,
      rxBps: rt.rxBps ?? null,
      txBps: rt.txBps ?? null,
      util: utilOf(rt.rxBps, rt.txBps, i.speedBps),
    };
  });
  const portsUp = ports.filter((i) => i.oper === 'up').length;
  e.attrs.portsUp = portsUp;
  e.attrs.portsTotal = ports.length;
  e.metrics = { uptimeS: d.uptimeS, portsUp };
  if (hasRate) { e.metrics.rxBps = rxSum; e.metrics.txBps = txSum; }
  // port documente (ifAlias) actif administrativement mais tombe
  const down = ifaces.filter((i) => i.alias && i.admin === 'up' && i.oper === 'down');
  if (down.length) {
    e.status = 'warning';
    const list = down.slice(0, 5).map((i) => `${i.name} (${i.alias})`).join(', ');
    e.statusText = `Port${down.length > 1 ? 's' : ''} hors service : ${list}${down.length > 5 ? ` (+${down.length - 5})` : ''}`;
  }
  return e;
}

function neighborStub(n, type) {
  const key = (n.sysName || n.chassisId || '').toLowerCase();
  if (!key) return null;
  return {
    id: `snmp:nbr:${key}`,
    type,
    name: n.sysName || n.chassisId,
    keys: buildKeys({ hostname: n.sysName || undefined, mac: n.chassisIdSubtype === 4 ? n.chassisId : undefined, ip: n.mgmtIp }),
    status: 'unknown',
    attrs: {
      sysDescr: n.sysDesc || null,
      ip: n.mgmtIp,
      mac: n.chassisIdSubtype === 4 && n.chassisId ? [n.chassisId] : [],
      lldpCapabilities: n.caps,
    },
    metrics: {},
  };
}

/** Nom du port distant : identifiant lisible, sinon description. */
function remotePortName(n) {
  if (n.portIdSubtype === 3 || n.portIdSubtype === 4) return n.portDesc || n.portId;
  return n.portId || n.portDesc;
}

/**
 * Resultats par cible -> snapshot.
 * @param {Array<{target, ok, data?, rates?, error?, last?}>} results
 */
export function buildSnmpSnapshot(results = []) {
  const entities = [];
  const links = [];
  const stubs = new Map();
  const linkIds = new Set();

  // voisin qui est lui-meme une cible interrogee : lien direct vers la cible
  const targetByHost = new Map();
  for (const r of results) {
    const info = r.data || r.last || {};
    const k = hostKey(info.sysName);
    if (k && !targetByHost.has(k)) targetByHost.set(k, `snmp:${r.target.host}`);
  }

  for (const r of results) {
    const dev = deviceEntity(r);
    entities.push(dev);
    if (!r.data) continue;
    const ifByIndex = new Map(r.data.interfaces.map((i) => [i.index, i]));
    const rates = r.rates || {};
    for (const n of r.data.neighbors) {
      const type = neighborType(n.caps, n.sysDesc);
      if (type === null) continue;
      let b = targetByHost.get(hostKey(n.sysName));
      if (!b) {
        const stub = neighborStub(n, type);
        if (!stub) continue;
        b = stub.id;
        const known = stubs.get(b);
        if (known) {
          known.keys = [...new Set([...known.keys, ...stub.keys])];
          known.attrs.ip = [...new Set([...known.attrs.ip, ...stub.attrs.ip])];
        } else {
          stubs.set(b, stub);
          entities.push(stub);
        }
      }
      if (b === dev.id) continue;
      const iface = n.ifIndex != null ? ifByIndex.get(n.ifIndex) : null;
      const aPort = iface?.name || n.localPort;
      const bPort = remotePortName(n);
      // lien deja vu depuis l'autre extremite (deux cibles voisines)
      const aNames = [aPort, iface?.descr].filter(Boolean).map((s) => s.toLowerCase());
      const bNames = [n.portId, n.portDesc].filter(Boolean).map((s) => s.toLowerCase());
      if (aNames.some((x) => bNames.some((y) => linkIds.has(`${b}|${y}|${dev.id}|${x}`)))) continue;
      for (const x of aNames) for (const y of bNames) linkIds.add(`${dev.id}|${x}|${b}|${y}`);

      const speed = iface?.speedBps || null;
      const rt = (iface && rates[iface.index]) || {};
      const metrics = { rxBps: rt.rxBps ?? null, txBps: rt.txBps ?? null, util: utilOf(rt.rxBps, rt.txBps, speed) };
      if (rt.errors != null) metrics.errors = rt.errors;
      links.push({
        a: dev.id,
        aPort,
        b,
        bPort: bPort || null,
        kind: speed >= 40e9 ? 'fiber' : 'ethernet',
        speedBps: speed,
        status: iface?.oper ? (iface.oper === 'up' ? 'ok' : 'critical') : 'unknown',
        metrics,
      });
    }
  }
  return { entities, links, flows: [] };
}

// ---------------------------------------------------------------------------
// E/S SNMP (net-snmp)
// ---------------------------------------------------------------------------

let snmpModule = null;

/** Charge net-snmp (dependance optionnelle). */
export async function loadSnmp() {
  if (snmpModule) return snmpModule;
  try {
    const m = await import('net-snmp');
    snmpModule = m.default || m;
  } catch (err) {
    throw new Error(`module 'net-snmp' introuvable (dependance optionnelle) : executez « npm install net-snmp » (${err.code || err.message})`);
  }
  return snmpModule;
}

/** Fusionne les valeurs par defaut et normalise la liste des cibles. */
export function normalizeTargets(cfg = {}) {
  const defaults = cfg.defaults || {};
  return (cfg.targets || [])
    .map((t) => (typeof t === 'string' ? { host: t } : t))
    .filter((t) => t && t.host)
    .map((t) => {
      const m = { version: '2c', community: 'public', port: 161, lldp: true, interfaces: true, retries: 1, ...defaults, ...t };
      m.host = String(m.host).trim();
      if (m.type) m.type = String(m.type).toLowerCase();
      m.version = String(m.version).toLowerCase().replace(/^v/, '');
      if (m.version === '2') m.version = '2c';
      return m;
    });
}

function openSession(snmp, t) {
  const timeoutS = Number(t.requestTimeout ?? t.timeout ?? 5);
  const opts = {
    port: Number(t.port) || 161,
    retries: Number(t.retries ?? 1),
    timeout: Math.max(1, timeoutS) * 1000,
    transport: t.host.includes(':') ? 'udp6' : 'udp4',
  };
  if (t.version === '3') {
    if (!t.user) throw new Error('SNMPv3 : "user" manquant');
    const alias = { sha1: 'sha', aes128: 'aes', aes256: 'aes256b' };
    const authName = String(t.authProtocol || 'sha').toLowerCase().replace('-', '');
    const privName = String(t.privProtocol || 'aes').toLowerCase().replace('-', '');
    const authProtocol = snmp.AuthProtocols[alias[authName] || authName];
    const privProtocol = snmp.PrivProtocols[alias[privName] || privName];
    if (t.authKey && !authProtocol) throw new Error(`SNMPv3 : authProtocol inconnu "${t.authProtocol}"`);
    if (t.privKey && !privProtocol) throw new Error(`SNMPv3 : privProtocol inconnu "${t.privProtocol}"`);
    const level = t.privKey ? snmp.SecurityLevel.authPriv : t.authKey ? snmp.SecurityLevel.authNoPriv : snmp.SecurityLevel.noAuthNoPriv;
    const user = { name: t.user, level };
    if (t.authKey) { user.authProtocol = authProtocol; user.authKey = t.authKey; }
    if (t.privKey) { user.privProtocol = privProtocol; user.privKey = t.privKey; }
    return snmp.createV3Session(t.host, user, { ...opts, version: snmp.Version3, context: t.context || '' });
  }
  if (t.version !== '2c') throw new Error(`version SNMP non supportee : ${t.version} (2c ou 3)`);
  return snmp.createSession(t.host, String(t.community ?? 'public'), { ...opts, version: snmp.Version2c });
}

function snmpGet(snmp, session, oids) {
  return new Promise((resolve, reject) => {
    session.get(oids, (err, varbinds) => {
      if (err) return reject(err);
      resolve(varbinds.map((vb) => (snmp.isVarbindError(vb) ? null : vb.value)));
    });
  });
}

/** Comparaison numerique de deux OID. */
export function compareOids(a, b) {
  const x = a.split('.');
  const y = b.split('.');
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d) return d;
  }
  return x.length - y.length;
}

const MAX_WALK_ROWS = 50000;

/**
 * Parcours d'une colonne -> { suffixe d'index: valeur }.
 * S'arrete sur fin de MIB / objet absent, sur OID non croissant (agent
 * defectueux : net-snmp bouclerait indefiniment) et au-dela de MAX_WALK_ROWS.
 */
function walkColumn(snmp, session, oid, maxRepetitions) {
  return new Promise((resolve, reject) => {
    const out = {};
    const prefix = `${oid}.`;
    let last = null;
    let rows = 0;
    session.subtree(oid, maxRepetitions, (varbinds) => {
      for (const vb of varbinds) {
        if (snmp.isVarbindError(vb) || !vb.oid.startsWith(prefix)) return true;
        if (last && compareOids(vb.oid, last) <= 0) return true;
        last = vb.oid;
        out[vb.oid.slice(prefix.length)] = vb.value;
        if (++rows >= MAX_WALK_ROWS) return true;
      }
      return false;
    }, (err) => (err ? reject(err) : resolve(out)));
  });
}

function isTimeout(snmp, err) {
  return (snmp.RequestTimedOutError && err instanceof snmp.RequestTimedOutError) || err?.name === 'RequestTimedOutError';
}

/**
 * Interroge une cible et retourne les donnees brutes (colonnes par suffixe d'index).
 * `opts.session` permet d'injecter une session (tests).
 */
export async function collectTarget(snmp, t, opts = {}) {
  const session = opts.session || openSession(snmp, t);
  session.on?.('error', () => { /* erreurs de socket : remontees par les requetes */ });
  const maxRep = Number(t.maxRepetitions) || 20;
  // une colonne absente ne bloque pas la collecte ; un delai depasse l'interrompt
  const walk = (oid) => walkColumn(snmp, session, oid, maxRep).catch((err) => {
    if (isTimeout(snmp, err)) throw err;
    return {};
  });
  const walkAll = async (cols, into) => {
    for (const [k, oid] of Object.entries(cols)) into[k] = await walk(oid);
    return into;
  };
  try {
    const names = Object.keys(SYSTEM_OIDS);
    const values = await snmpGet(snmp, session, Object.values(SYSTEM_OIDS));
    if (values.every((v) => v == null)) throw new Error('groupe systeme SNMP absent');
    const raw = {
      system: Object.fromEntries(names.map((k, i) => [k, values[i]])),
      entity: {}, ifaces: {}, lldpLoc: {}, lldpRem: {}, lldpMan: {}, t: null,
    };
    await walkAll(ENTITY_COLS, raw.entity);
    const wantIf = t.interfaces !== false;
    const wantLldp = t.lldp !== false;
    if (wantIf || wantLldp) await walkAll(IF_NAME_COLS, raw.ifaces);
    if (wantIf) {
      raw.t = Date.now();
      await walkAll(IF_COLS, raw.ifaces);
      if (!Object.keys(raw.ifaces.hcIn || {}).length) await walkAll(IF_COLS_32, raw.ifaces);
    }
    if (wantLldp) {
      raw.lldpRem.chassisId = await walk(LLDP_REM_COLS.chassisId);
      if (Object.keys(raw.lldpRem.chassisId).length) {
        const { chassisId, ...others } = LLDP_REM_COLS;
        await walkAll(others, raw.lldpRem);
        await walkAll(LLDP_LOC_COLS, raw.lldpLoc);
        raw.lldpMan = await walk(LLDP_MAN_ADDR);
      }
    }
    return raw;
  } finally {
    if (!opts.session) {
      try { session.close(); } catch { /* deja fermee */ }
    }
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

class SnmpCollector extends Collector {
  constructor(cfg, ctx) {
    super(cfg, ctx);
    this.counters = new Map(); // host -> {t, uptimeS, counters}
    this.identity = new Map(); // host -> derniere identite connue (si injoignable)
    this.down = new Set();
  }

  defaultInterval() { return 60; }

  async poll() {
    const targets = normalizeTargets(this.cfg);
    if (!targets.length) return { entities: [], links: [], flows: [] };
    const snmp = await loadSnmp();
    const results = await mapLimit(targets, Number(this.cfg.concurrency) || 8, (t) => this.pollTarget(snmp, t));
    return buildSnmpSnapshot(results);
  }

  async pollTarget(snmp, t) {
    try {
      const raw = await collectTarget(snmp, t);
      const data = parseTargetData(raw);
      const rates = this.updateRates(t.host, data, raw.t ?? Date.now());
      this.identity.set(t.host, {
        sysName: data.sysName, serial: data.serial, model: data.model, vendor: data.vendor,
        sysDescr: data.sysDescr, location: data.location, type: guessDeviceType(data),
      });
      if (this.down.delete(t.host)) this.log.info(`${t.host} : de nouveau joignable`);
      return { target: t, ok: true, data, rates };
    } catch (err) {
      const msg = err?.message || String(err);
      if (!this.down.has(t.host)) {
        this.down.add(t.host);
        this.log.warn(`${t.host} : ${msg}`);
      }
      return { target: t, ok: false, error: msg, last: this.identity.get(t.host) };
    }
  }

  updateRates(host, data, t) {
    const cur = interfaceCounters(data.interfaces);
    const prev = this.counters.get(host);
    this.counters.set(host, { t, uptimeS: data.uptimeS, counters: cur });
    if (!prev) return {};
    // redemarrage de l'equipement : compteurs remis a zero
    if (data.uptimeS != null && prev.uptimeS != null && data.uptimeS < prev.uptimeS) return {};
    return computeRates(prev.counters, cur, (t - prev.t) / 1000);
  }
}

export default function create(cfg, ctx) {
  return new SnmpCollector(cfg, ctx);
}
