// Decodeur NetFlow v5 / v9 et IPFIX (v10). Fonctions pures, sans E/S.
//
// parsePacket(buf, { exporter, templates, sampling }) retourne des
// enregistrements normalises :
//   { src, dst, srcPort, dstPort, proto, bytes, packets, exporter, ... }
// Les gabarits (v9 / IPFIX) sont memorises dans un TemplateCache, par
// exportateur + source id (domaine d'observation) + id de gabarit.

export class FlowParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FlowParseError';
  }
}

/** Cache des gabarits v9 / IPFIX. */
export class TemplateCache {
  constructor(max = 20000) {
    this.map = new Map();
    this.max = max;
  }

  static key(exporter, domain, id) { return `${exporter}|${domain}|${id}`; }

  get(exporter, domain, id) { return this.map.get(TemplateCache.key(exporter, domain, id)); }

  set(exporter, domain, id, tpl) {
    const k = TemplateCache.key(exporter, domain, id);
    // borne memoire : on oublie le plus ancien gabarit
    if (!this.map.has(k) && this.map.size >= this.max) this.map.delete(this.map.keys().next().value);
    this.map.set(k, tpl);
  }

  delete(exporter, domain, id) { this.map.delete(TemplateCache.key(exporter, domain, id)); }

  get size() { return this.map.size; }

  /** Nombre de gabarits connus pour un exportateur. */
  countFor(exporter) {
    const prefix = `${exporter}|`;
    let n = 0;
    for (const k of this.map.keys()) if (k.startsWith(prefix)) n++;
    return n;
  }
}

// ---------------------------------------------------------------------------
// Utilitaires binaires
// ---------------------------------------------------------------------------

/** Entier non signe big-endian de 1 a 8 octets (precision double au-dela de 2^53). */
export function readUint(buf, off, len) {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + buf[off + i];
  return v;
}

export function ipv4ToString(buf, off = 0) {
  return `${buf[off]}.${buf[off + 1]}.${buf[off + 2]}.${buf[off + 3]}`;
}

/** Adresse IPv6 (16 octets) en notation compressee ; ::ffff:a.b.c.d -> a.b.c.d. */
export function ipv6ToString(buf, off = 0) {
  const g = [];
  for (let i = 0; i < 8; i++) g.push(buf.readUInt16BE(off + i * 2));
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return ipv4ToString(buf, off + 12);
  // plus longue suite de groupes nuls (>= 2) remplacee par ::
  let best = -1;
  let bestLen = 0;
  for (let i = 0; i < 8;) {
    if (g[i] !== 0) { i++; continue; }
    let j = i;
    while (j < 8 && g[j] === 0) j++;
    if (j - i > bestLen) { best = i; bestLen = j - i; }
    i = j;
  }
  const hex = g.map((x) => x.toString(16));
  if (bestLen < 2) return hex.join(':');
  return `${hex.slice(0, best).join(':')}::${hex.slice(best + bestLen).join(':')}`;
}

// ---------------------------------------------------------------------------
// Champs (numeros d'element d'information IANA, communs a v9 et IPFIX)
// ---------------------------------------------------------------------------

function setField(r, id, buf, off, len) {
  switch (id) {
    case 1: r.bytes = readUint(buf, off, len); break;            // octetDeltaCount / IN_BYTES
    case 2: r.packets = readUint(buf, off, len); break;          // packetDeltaCount / IN_PKTS
    case 4: r.proto = readUint(buf, off, len); break;            // protocolIdentifier
    case 7: r.srcPort = readUint(buf, off, len); break;
    case 8: if (len === 4) r.src = ipv4ToString(buf, off); break;
    case 10: r.inIf = readUint(buf, off, len); break;
    case 11: r.dstPort = readUint(buf, off, len); break;
    case 12: if (len === 4) r.dst = ipv4ToString(buf, off); break;
    case 14: r.outIf = readUint(buf, off, len); break;
    case 21: r.lastUp = readUint(buf, off, len); break;          // LAST_SWITCHED (ms depuis demarrage)
    case 22: r.firstUp = readUint(buf, off, len); break;         // FIRST_SWITCHED
    case 23: r.outBytes = readUint(buf, off, len); break;        // OUT_BYTES (v9)
    case 24: r.outPackets = readUint(buf, off, len); break;      // OUT_PKTS (v9)
    case 27: if (len === 16) r.src6 = ipv6ToString(buf, off); break;
    case 28: if (len === 16) r.dst6 = ipv6ToString(buf, off); break;
    case 34: case 50: r.sampling = readUint(buf, off, len); break; // intervalle d'echantillonnage
    case 85: r.bytesTotal = readUint(buf, off, len); break;      // octetTotalCount
    case 86: r.packetsTotal = readUint(buf, off, len); break;    // packetTotalCount
    case 150: r.startS = readUint(buf, off, len); break;         // flowStartSeconds
    case 151: r.endS = readUint(buf, off, len); break;
    case 152: r.startMs = readUint(buf, off, len); break;        // flowStartMilliseconds
    case 153: r.endMs = readUint(buf, off, len); break;
    default: break;                                              // champ ignore
  }
}

/** Enregistrement brut -> enregistrement normalise (null si pas d'adresses). */
function normalize(r, exporter, sampling, clock) {
  const src = r.src || r.src6;
  const dst = r.dst || r.dst6;
  if (!src || !dst) return null;
  // echantillonnage annonce dans l'enregistrement prioritaire sur la configuration
  const mult = r.sampling > 1 ? r.sampling : sampling;
  const bytes = r.bytes ?? r.bytesTotal ?? r.outBytes ?? 0;
  const packets = r.packets ?? r.packetsTotal ?? r.outPackets ?? 0;
  const rec = {
    src, dst,
    srcPort: r.srcPort ?? 0,
    dstPort: r.dstPort ?? 0,
    proto: r.proto ?? 0,
    bytes: bytes * mult,
    packets: packets * mult,
    exporter,
  };
  if (r.inIf != null) rec.inIf = r.inIf;
  if (r.outIf != null) rec.outIf = r.outIf;
  if (mult !== 1) rec.sampling = mult;
  // horodatage absolu (ms) si calculable
  const start = r.startMs ?? (r.startS != null ? r.startS * 1000 : null) ??
    (clock && r.firstUp != null ? clock.unixMs - (clock.uptimeMs - r.firstUp) : null);
  const end = r.endMs ?? (r.endS != null ? r.endS * 1000 : null) ??
    (clock && r.lastUp != null ? clock.unixMs - (clock.uptimeMs - r.lastUp) : null);
  if (start != null) rec.start = start;
  if (end != null) rec.end = end;
  return rec;
}

// ---------------------------------------------------------------------------
// NetFlow v5
// ---------------------------------------------------------------------------

const V5_HEADER = 24;
const V5_RECORD = 48;

function parseV5(buf, exporter, sampling, out) {
  if (buf.length < V5_HEADER) throw new FlowParseError('NetFlow v5 : en-tete tronque');
  const count = buf.readUInt16BE(2);
  if (buf.length < V5_HEADER + count * V5_RECORD) throw new FlowParseError(`NetFlow v5 : ${count} enregistrements annonces, paquet tronque`);
  const clock = { uptimeMs: buf.readUInt32BE(4), unixMs: buf.readUInt32BE(8) * 1000 + Math.floor(buf.readUInt32BE(12) / 1e6) };
  // 2 bits de mode + 14 bits d'intervalle d'echantillonnage
  const interval = buf.readUInt16BE(22) & 0x3fff;
  const mult = interval > 0 ? interval : sampling;
  for (let i = 0; i < count; i++) {
    const o = V5_HEADER + i * V5_RECORD;
    const r = {
      src: ipv4ToString(buf, o),
      dst: ipv4ToString(buf, o + 4),
      inIf: buf.readUInt16BE(o + 12),
      outIf: buf.readUInt16BE(o + 14),
      packets: buf.readUInt32BE(o + 16),
      bytes: buf.readUInt32BE(o + 20),
      firstUp: buf.readUInt32BE(o + 24),
      lastUp: buf.readUInt32BE(o + 28),
      srcPort: buf.readUInt16BE(o + 32),
      dstPort: buf.readUInt16BE(o + 34),
      proto: buf[o + 38],
    };
    out.records.push(normalize(r, exporter, mult, clock));
  }
}

// ---------------------------------------------------------------------------
// NetFlow v9 / IPFIX : gabarits et donnees
// ---------------------------------------------------------------------------

/** Longueur fixe d'un gabarit (-1 si champs de longueur variable). */
function makeTemplate(fields) {
  let len = 0;
  let minLen = 0;
  let variable = false;
  for (const f of fields) {
    if (f.len === 0xffff) { variable = true; minLen += 1; } else { len += f.len; minLen += f.len; }
  }
  return { fields, len: variable ? -1 : len, minLen };
}

function parseV9Templates(buf, p, end, exporter, domain, templates, out) {
  while (p + 4 <= end) {
    const tid = buf.readUInt16BE(p);
    const count = buf.readUInt16BE(p + 2);
    p += 4;
    if (tid < 256) break; // bourrage
    if (p + count * 4 > end) throw new FlowParseError(`NetFlow v9 : gabarit ${tid} tronque`);
    const fields = [];
    for (let i = 0; i < count; i++, p += 4) fields.push({ id: buf.readUInt16BE(p), len: buf.readUInt16BE(p + 2) });
    templates.set(exporter, domain, tid, makeTemplate(fields));
    out.templates++;
  }
}

function parseIpfixTemplates(buf, p, end, exporter, domain, templates, out) {
  while (p + 4 <= end) {
    const tid = buf.readUInt16BE(p);
    const count = buf.readUInt16BE(p + 2);
    p += 4;
    if (tid < 256) break; // bourrage (ou retrait global, ignore)
    if (count === 0) { templates.delete(exporter, domain, tid); continue; } // retrait du gabarit
    const fields = [];
    for (let i = 0; i < count; i++) {
      if (p + 4 > end) throw new FlowParseError(`IPFIX : gabarit ${tid} tronque`);
      const ie = buf.readUInt16BE(p);
      const len = buf.readUInt16BE(p + 2);
      p += 4;
      const ent = (ie & 0x8000) !== 0;
      if (ent) {
        // champ proprietaire : numero d'entreprise sur 4 octets, champ ignore au decodage
        if (p + 4 > end) throw new FlowParseError(`IPFIX : gabarit ${tid} tronque`);
        p += 4;
      }
      fields.push({ id: ie & 0x7fff, len, ent });
    }
    templates.set(exporter, domain, tid, makeTemplate(fields));
    out.templates++;
  }
}

function parseDataSet(buf, p, end, tpl, exporter, sampling, clock, out) {
  if (tpl.minLen <= 0) return;
  while (end - p >= tpl.minLen) {
    const r = {};
    for (const f of tpl.fields) {
      let len = f.len;
      if (len === 0xffff) {
        // longueur variable : 1 octet, ou 255 puis 2 octets
        if (p + 1 > end) throw new FlowParseError('IPFIX : champ variable tronque');
        len = buf[p]; p += 1;
        if (len === 255) {
          if (p + 2 > end) throw new FlowParseError('IPFIX : champ variable tronque');
          len = buf.readUInt16BE(p); p += 2;
        }
      }
      if (p + len > end) throw new FlowParseError('enregistrement de donnees tronque');
      if (!f.ent && len > 0) setField(r, f.id, buf, p, len);
      p += len;
    }
    const rec = normalize(r, exporter, sampling, clock);
    if (rec) out.records.push(rec);
  }
}

function parseV9(buf, exporter, templates, sampling, out) {
  if (buf.length < 20) throw new FlowParseError('NetFlow v9 : en-tete tronque');
  const clock = { uptimeMs: buf.readUInt32BE(4), unixMs: buf.readUInt32BE(8) * 1000 };
  const domain = buf.readUInt32BE(16);
  let off = 20;
  while (off + 4 <= buf.length) {
    const id = buf.readUInt16BE(off);
    const len = buf.readUInt16BE(off + 2);
    if (len < 4 || off + len > buf.length) throw new FlowParseError(`NetFlow v9 : flowset ${id} de longueur invalide`);
    const end = off + len;
    if (id === 0) parseV9Templates(buf, off + 4, end, exporter, domain, templates, out);
    else if (id >= 256) {
      const tpl = templates.get(exporter, domain, id);
      if (tpl) parseDataSet(buf, off + 4, end, tpl, exporter, sampling, clock, out);
      else out.missingTemplate++;
    }
    // id 1 (gabarits d'options) et 2..255 : ignores
    off = end;
  }
}

function parseIpfix(buf, exporter, templates, sampling, out) {
  if (buf.length < 16) throw new FlowParseError('IPFIX : en-tete tronque');
  const total = buf.readUInt16BE(2);
  if (total < 16 || total > buf.length) throw new FlowParseError('IPFIX : longueur de message invalide');
  const domain = buf.readUInt32BE(12);
  let off = 16;
  while (off + 4 <= total) {
    const id = buf.readUInt16BE(off);
    const len = buf.readUInt16BE(off + 2);
    if (len < 4 || off + len > total) throw new FlowParseError(`IPFIX : set ${id} de longueur invalide`);
    const end = off + len;
    if (id === 2) parseIpfixTemplates(buf, off + 4, end, exporter, domain, templates, out);
    else if (id >= 256) {
      const tpl = templates.get(exporter, domain, id);
      if (tpl) parseDataSet(buf, off + 4, end, tpl, exporter, sampling, null, out);
      else out.missingTemplate++;
    }
    // id 3 (gabarits d'options) : ignore
    off = end;
  }
}

/**
 * Decode un datagramme NetFlow v5/v9 ou IPFIX.
 * @param {Buffer} buf
 * @param {{exporter?:string, templates?:TemplateCache, sampling?:number}} opts
 * @returns {{version:number, records:object[], templates:number, missingTemplate:number}}
 * @throws {FlowParseError} paquet invalide ou version inconnue
 */
export function parsePacket(buf, opts = {}) {
  const exporter = opts.exporter || '';
  const templates = opts.templates || new TemplateCache();
  const sampling = Number(opts.sampling) > 0 ? Number(opts.sampling) : 1;
  if (!buf || buf.length < 4) throw new FlowParseError('paquet trop court');
  const version = buf.readUInt16BE(0);
  const out = { version, records: [], templates: 0, missingTemplate: 0 };
  if (version === 5) parseV5(buf, exporter, sampling, out);
  else if (version === 9) parseV9(buf, exporter, templates, sampling, out);
  else if (version === 10) parseIpfix(buf, exporter, templates, sampling, out);
  else throw new FlowParseError(`version NetFlow non supportee : ${version}`);
  out.records = out.records.filter(Boolean);
  return out;
}
