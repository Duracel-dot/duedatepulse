// Modele de donnees partage entre le serveur (Node.js) et le client (navigateur).
// Aucune dependance : ce fichier est servi tel quel au navigateur sous /shared/.

/**
 * Types d'entites.
 *  - cls   : classe de correlation. Deux entites ne peuvent etre fusionnees
 *            (meme serveur vu par plusieurs collecteurs) que si elles ont la meme classe.
 *  - layer : couche d'affichage dans la vue 3D.
 */
export const ENTITY_TYPES = {
  site:         { cls: 'physical',   layer: 'building',   label: 'Site' },
  room:         { cls: 'physical',   layer: 'building',   label: 'Salle' },
  rack:         { cls: 'physical',   layer: 'physical',   label: 'Baie' },
  server:       { cls: 'physical',   layer: 'physical',   label: 'Serveur' },
  storage:      { cls: 'physical',   layer: 'physical',   label: 'Stockage' },
  appliance:    { cls: 'physical',   layer: 'physical',   label: 'Appliance' },
  pdu:          { cls: 'physical',   layer: 'physical',   label: 'PDU' },
  ups:          { cls: 'physical',   layer: 'physical',   label: 'Onduleur' },
  switch:       { cls: 'physical',   layer: 'network',    label: 'Commutateur' },
  router:       { cls: 'physical',   layer: 'network',    label: 'Routeur' },
  firewall:     { cls: 'physical',   layer: 'network',    label: 'Pare-feu' },
  loadbalancer: { cls: 'physical',   layer: 'network',    label: 'Répartiteur de charge' },
  accesspoint:  { cls: 'physical',   layer: 'network',    label: 'Borne Wi-Fi' },
  hypervisor:   { cls: 'hypervisor', layer: 'hypervisor', label: 'Hyperviseur' },
  vm:           { cls: 'vm',         layer: 'vm',         label: 'Machine virtuelle' },
  container:    { cls: 'vm',         layer: 'vm',         label: 'Conteneur' },
  external:     { cls: 'external',   layer: 'external',   label: 'Externe' },
};

/** Types physiques qui se montent dans une baie. */
export const RACK_DEVICE_TYPES = new Set([
  'server', 'storage', 'appliance', 'pdu', 'ups', 'switch', 'router', 'firewall', 'loadbalancer',
]);

export const NETWORK_TYPES = new Set(['switch', 'router', 'firewall', 'loadbalancer', 'accesspoint']);

/** Couches affichables (ordre = ordre du panneau). */
export const LAYERS = [
  { id: 'building',   label: 'Sites & salles' },
  { id: 'physical',   label: 'Baies & équipements' },
  { id: 'network',    label: 'Réseau & câblage' },
  { id: 'hypervisor', label: 'Hyperviseurs' },
  { id: 'vm',         label: 'Machines virtuelles' },
  { id: 'flow',       label: 'Flux' },
  { id: 'external',   label: 'Externes (WAN, Internet)' },
];

export const STATUSES = ['unknown', 'ok', 'off', 'warning', 'critical'];
const STATUS_RANK = { unknown: 0, ok: 1, off: 2, warning: 3, critical: 4 };

export const STATUS_LABELS = {
  ok: 'OK', warning: 'Avertissement', critical: 'Critique', unknown: 'Inconnu', off: 'Arrêté',
};

export function isStatus(s) {
  return Object.prototype.hasOwnProperty.call(STATUS_RANK, s);
}

export function statusRank(s) {
  return STATUS_RANK[s] ?? 0;
}

/** Retourne le pire des deux statuts (critical > warning > off > ok > unknown). */
export function worstStatus(a, b) {
  return statusRank(b) > statusRank(a) ? b : a;
}

export function typeInfo(type) {
  return ENTITY_TYPES[type] || ENTITY_TYPES.external;
}

export function clsOf(type) {
  return typeInfo(type).cls;
}

export function layerOf(type) {
  return typeInfo(type).layer;
}

// ---------------------------------------------------------------------------
// Cles de correlation. Une cle est une chaine "<nature>:<valeur normalisee>".
// Les cles "fortes" servent a fusionner les entites d'une meme classe vues par
// plusieurs sources ; les cles "ip" servent uniquement a la recherche
// (extremites de flux, ping...) car une IP peut etre partagee (VIP, NAT).
// ---------------------------------------------------------------------------

export const MERGE_KEY_KINDS = new Set(['host', 'fqdn', 'serial', 'uuid', 'mac']);

const BAD_SERIALS = new Set([
  '', '0', 'none', 'n/a', 'na', 'null', 'unknown', 'default string', 'to be filled by o.e.m.',
  'system serial number', '0123456789', 'not specified', 'not available', '.',
]);

export function hostKey(name) {
  if (!name) return null;
  const s = String(name).trim().toLowerCase();
  if (!s || isIPv4(s) || s.includes(':')) return null;
  const short = s.split('.')[0];
  return short ? `host:${short}` : null;
}

export function fqdnKey(name) {
  if (!name) return null;
  const s = String(name).trim().toLowerCase();
  if (!s.includes('.') || isIPv4(s)) return null;
  return `fqdn:${s}`;
}

export function serialKey(serial) {
  if (serial == null) return null;
  const s = String(serial).trim();
  if (BAD_SERIALS.has(s.toLowerCase())) return null;
  return `serial:${s.toUpperCase()}`;
}

export function uuidKey(uuid) {
  if (!uuid) return null;
  const s = String(uuid).trim().toLowerCase().replace(/[{}]/g, '');
  if (!s || /^0+(-0+)*$/.test(s)) return null;
  return `uuid:${s}`;
}

export function normalizeMac(mac) {
  if (!mac) return null;
  const hex = String(mac).toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12 || /^0+$/.test(hex) || /^f+$/.test(hex)) return null;
  return hex.match(/../g).join(':');
}

export function macKey(mac) {
  const m = normalizeMac(mac);
  return m ? `mac:${m}` : null;
}

export function ipKey(ip) {
  if (!ip) return null;
  const s = String(ip).trim().toLowerCase().split('%')[0];
  if (!s || s === '0.0.0.0' || s === '::' || s === '::1' || s.startsWith('127.') || s.startsWith('169.254.') || s.startsWith('fe80:')) return null;
  return `ip:${s}`;
}

export function keyKind(key) {
  const i = key.indexOf(':');
  return i < 0 ? '' : key.slice(0, i);
}

/**
 * Construit la liste des cles a partir de champs usuels.
 * @param {{hostname?, fqdn?, serial?, uuid?, mac?, ip?}} o  mac/ip peuvent etre des tableaux
 */
export function buildKeys(o = {}) {
  const keys = new Set();
  const add = (k) => { if (k) keys.add(k); };
  add(hostKey(o.hostname));
  add(fqdnKey(o.fqdn || o.hostname));
  add(serialKey(o.serial));
  add(uuidKey(o.uuid));
  for (const m of toArray(o.mac)) add(macKey(m));
  for (const ip of toArray(o.ip)) add(ipKey(ip));
  return [...keys];
}

export function toArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// ---------------------------------------------------------------------------
// IPv4
// ---------------------------------------------------------------------------

export function isIPv4(s) {
  return /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(String(s)) &&
    String(s).split('.').every((p) => Number(p) <= 255);
}

export function ipv4ToInt(ip) {
  const p = String(ip).split('.').map(Number);
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

export function parseCidr(cidr) {
  const [ip, bitsStr] = String(cidr).split('/');
  const bits = bitsStr == null ? 32 : Number(bitsStr);
  if (!isIPv4(ip) || !(bits >= 0 && bits <= 32)) return null;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { base: (ipv4ToInt(ip) & mask) >>> 0, mask, bits };
}

export function cidrContains(parsed, ip) {
  if (!parsed || !isIPv4(ip)) return false;
  return ((ipv4ToInt(ip) & parsed.mask) >>> 0) === parsed.base;
}

export function isPrivateIPv4(ip) {
  if (!isIPv4(ip)) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || a === 127 || (a === 169 && b === 254);
}

// ---------------------------------------------------------------------------
// Applications (port -> nom) et categories de flux
// ---------------------------------------------------------------------------

export const WELL_KNOWN_PORTS = {
  20: 'ftp-data', 21: 'ftp', 22: 'ssh', 23: 'telnet', 25: 'smtp', 53: 'dns', 67: 'dhcp', 69: 'tftp',
  80: 'http', 88: 'kerberos', 110: 'pop3', 123: 'ntp', 135: 'msrpc', 137: 'netbios', 139: 'netbios',
  143: 'imap', 161: 'snmp', 162: 'snmp-trap', 389: 'ldap', 443: 'https', 445: 'smb', 465: 'smtps',
  514: 'syslog', 587: 'smtp', 636: 'ldaps', 902: 'vmware', 993: 'imaps', 1433: 'mssql', 1521: 'oracle',
  2049: 'nfs', 3260: 'iscsi', 3268: 'ldap-gc', 3306: 'mysql', 3389: 'rdp', 5432: 'postgresql',
  5672: 'amqp', 5985: 'winrm', 5986: 'winrm', 6379: 'redis', 8006: 'proxmox', 8080: 'http-alt',
  8443: 'https-alt', 9000: 'http-alt', 9092: 'kafka', 9200: 'elasticsearch', 10050: 'zabbix',
  27017: 'mongodb',
};

export const FLOW_CATEGORIES = {
  web:         { label: 'Web',                  color: '#38bdf8' },
  database:    { label: 'Base de données',      color: '#a78bfa' },
  auth:        { label: 'Annuaire / auth',      color: '#facc15' },
  storage:     { label: 'Stockage / sauvegarde', color: '#fb923c' },
  replication: { label: 'Réplication / vMotion', color: '#f472b6' },
  mail:        { label: 'Messagerie',           color: '#34d399' },
  remote:      { label: 'Accès distant',        color: '#2dd4bf' },
  infra:       { label: 'Services d’infra',     color: '#94a3b8' },
  other:       { label: 'Autre',                color: '#cbd5e1' },
};

const APP_CATEGORY = {
  http: 'web', https: 'web', 'http-alt': 'web', 'https-alt': 'web',
  mssql: 'database', oracle: 'database', mysql: 'database', postgresql: 'database', mongodb: 'database',
  redis: 'database', elasticsearch: 'database',
  kerberos: 'auth', ldap: 'auth', ldaps: 'auth', 'ldap-gc': 'auth', msrpc: 'auth', netbios: 'auth',
  smb: 'storage', nfs: 'storage', iscsi: 'storage', backup: 'storage', 'ftp-data': 'storage', ftp: 'storage',
  vmware: 'replication', vmotion: 'replication', replication: 'replication', 'live-migration': 'replication',
  smtp: 'mail', smtps: 'mail', imap: 'mail', imaps: 'mail', pop3: 'mail',
  rdp: 'remote', ssh: 'remote', winrm: 'remote', telnet: 'remote',
  dns: 'infra', ntp: 'infra', dhcp: 'infra', snmp: 'infra', syslog: 'infra', tftp: 'infra', zabbix: 'infra',
  amqp: 'other', kafka: 'other', proxmox: 'remote',
};

export function appForPort(port) {
  return WELL_KNOWN_PORTS[Number(port)] || null;
}

export function flowCategory(app, port) {
  const a = app || appForPort(port);
  return (a && APP_CATEGORY[String(a).toLowerCase()]) || 'other';
}

// ---------------------------------------------------------------------------
// Formatage
// ---------------------------------------------------------------------------

export function formatBps(bps) {
  if (bps == null || !Number.isFinite(bps)) return '-';
  const units = ['bit/s', 'kbit/s', 'Mbit/s', 'Gbit/s', 'Tbit/s'];
  let v = bps;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
}

/** "10G", "1Gb", "100M", 10000000000 -> bit/s */
export function parseSpeed(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const m = String(v).trim().match(/^([\d.]+)\s*([kmgt]?)/i);
  if (!m) return null;
  const mult = { '': 1, k: 1e3, m: 1e6, g: 1e9, t: 1e12 }[m[2].toLowerCase()];
  return Number(m[1]) * mult;
}
