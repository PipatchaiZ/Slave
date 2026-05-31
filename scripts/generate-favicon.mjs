// Generates an 8-bit spade favicon (favicon.ico with 16/32/48 px frames) plus a
// large PNG preview, using only Node built-ins (zlib + manual CRC32/PNG/ICO).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import zlib from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..'); // repo root

// ---- colours (game palette) ----
const NAVY = [21, 35, 59, 255]; // table-felt navy background
const CREAM = [245, 236, 207, 255]; // card cream spade
const EDGE = [11, 12, 26, 255]; // dark frame

// ---- spade shape, in normalised 0..1 coords ----
function inTriangle(x, y, ax, ay, bx, by, cx, cy) {
  const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
  const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
  const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}
function isSpade(nx, ny) {
  // top triangle
  if (inTriangle(nx, ny, 0.5, 0.08, 0.03, 0.62, 0.97, 0.62)) return true;
  // two rounded lobes
  const r = 0.27;
  if ((nx - 0.3) ** 2 + (ny - 0.6) ** 2 <= r * r) return true;
  if ((nx - 0.7) ** 2 + (ny - 0.6) ** 2 <= r * r) return true;
  // stem (trapezoid, flaring downward)
  if (ny >= 0.74 && ny <= 0.95) {
    const t = (ny - 0.74) / (0.95 - 0.74);
    const half = 0.07 + t * 0.1;
    if (Math.abs(nx - 0.5) <= half) return true;
  }
  return false;
}

function renderRGBA(size) {
  const buf = Buffer.alloc(size * size * 4);
  const b = Math.max(1, Math.round(size / 16)); // frame thickness
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let c;
      if (x < b || x >= size - b || y < b || y >= size - b) c = EDGE;
      else {
        // sample shape at the pixel centre
        const nx = (x + 0.5) / size;
        const ny = (y + 0.5) / size;
        c = isSpade(nx, ny) ? CREAM : NAVY;
      }
      buf[i] = c[0];
      buf[i + 1] = c[1];
      buf[i + 2] = c[2];
      buf[i + 3] = c[3];
    }
  }
  return buf;
}

// ---- CRC32 ----
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- PNG encode (8-bit RGBA) ----
function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      raw[p++] = rgba[i];
      raw[p++] = rgba[i + 1];
      raw[p++] = rgba[i + 2];
      raw[p++] = rgba[i + 3];
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  };
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- ICO (PNG-encoded frames) ----
function buildICO(sizes) {
  const pngs = sizes.map((s) => encodePNG(s, renderRGBA(s)));
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2); // type: icon
  dir.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const entries = sizes.map((s, idx) => {
    const e = Buffer.alloc(16);
    e[0] = s >= 256 ? 0 : s;
    e[1] = s >= 256 ? 0 : s;
    e[2] = 0;
    e[3] = 0;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(pngs[idx].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += pngs[idx].length;
    return e;
  });
  return Buffer.concat([dir, ...entries, ...pngs]);
}

const ico = buildICO([16, 32, 48]);
writeFileSync(resolve(ROOT, 'apps/web/public/favicon.ico'), ico);
writeFileSync(resolve(ROOT, 'apps/web/public/favicon.png'), encodePNG(32, renderRGBA(32)));
writeFileSync(resolve(ROOT, 'scripts/favicon-preview.png'), encodePNG(256, renderRGBA(256)));
console.log(`favicon.ico ${ico.length} bytes (16/32/48) + favicon.png + 256px preview written`);
