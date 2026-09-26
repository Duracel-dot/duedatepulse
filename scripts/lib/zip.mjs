// Lecture / ecriture minimale de fichiers ZIP (sans dependance), pour construire
// le paquet Windows autonome. Ecriture : methode "deflate" (8) ou "store" (0).
import fs from 'node:fs';
import zlib from 'node:zlib';

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** Ecrit une archive ZIP. entries : [{ name: 'dir/file', data: Buffer }] */
export function writeZip(file, entries) {
  const fd = fs.openSync(file, 'w');
  const central = [];
  let offset = 0;
  const { time, date } = dosDateTime();
  const write = (buf) => { fs.writeSync(fd, buf); offset += buf.length; };
  for (const e of entries) {
    const name = Buffer.from(e.name.replace(/\\/g, '/'), 'utf8');
    const raw = e.data;
    const deflated = raw.length > 64 ? zlib.deflateRawSync(raw, { level: 9 }) : null;
    const useDeflate = deflated && deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const crc = crc32(raw);
    if (body.length >= 0xffffffff || offset >= 0xffffffff) throw new Error('archive trop volumineuse (ZIP64 non gere)');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // noms en UTF-8
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const localOffset = offset;
    write(local);
    write(name);
    write(body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(useDeflate ? 8 : 0, 10);
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(0, 38);
    c.writeUInt32LE(localOffset, 42);
    central.push(Buffer.concat([c, name]));
  }
  const cdStart = offset;
  for (const c of central) write(c);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(offset - cdStart, 12);
  end.writeUInt32LE(cdStart, 16);
  write(end);
  fs.closeSync(fd);
}

/** Lit une archive ZIP : retourne [{ name, read(): Buffer }] */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('archive ZIP invalide');
  let count = buf.readUInt16LE(eocd + 10);
  let cd = buf.readUInt32LE(eocd + 16);
  // ZIP64 (archives Node.js volumineuses)
  if (cd === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20;
    if (buf.readUInt32LE(loc) !== 0x07064b50) throw new Error('ZIP64 invalide');
    const z64 = Number(buf.readBigUInt64LE(loc + 8));
    count = Number(buf.readBigUInt64LE(z64 + 32));
    cd = Number(buf.readBigUInt64LE(z64 + 48));
  }
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error('repertoire central ZIP invalide');
    const method = buf.readUInt16LE(cd + 10);
    let csize = buf.readUInt32LE(cd + 20);
    let usize = buf.readUInt32LE(cd + 24);
    const nlen = buf.readUInt16LE(cd + 28);
    const xlen = buf.readUInt16LE(cd + 30);
    const clen = buf.readUInt16LE(cd + 32);
    let lho = buf.readUInt32LE(cd + 42);
    const name = buf.toString('utf8', cd + 46, cd + 46 + nlen);
    // champ extra ZIP64
    let x = cd + 46 + nlen;
    const xend = x + xlen;
    while (x + 4 <= xend) {
      const id = buf.readUInt16LE(x);
      const sz = buf.readUInt16LE(x + 2);
      if (id === 0x0001) {
        let p = x + 4;
        if (usize === 0xffffffff) { usize = Number(buf.readBigUInt64LE(p)); p += 8; }
        if (csize === 0xffffffff) { csize = Number(buf.readBigUInt64LE(p)); p += 8; }
        if (lho === 0xffffffff) { lho = Number(buf.readBigUInt64LE(p)); }
      }
      x += 4 + sz;
    }
    const localName = buf.readUInt16LE(lho + 26);
    const localExtra = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + localName + localExtra;
    out.push({
      name,
      size: usize,
      read: () => {
        const data = buf.subarray(start, start + csize);
        if (method === 0) return Buffer.from(data);
        if (method === 8) return zlib.inflateRawSync(data);
        throw new Error(`methode de compression non geree : ${method}`);
      },
    });
    cd += 46 + nlen + xlen + clen;
  }
  return out;
}
