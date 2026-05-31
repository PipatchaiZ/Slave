// Builds the brand image set FROM the supplied 4-suit artwork:
//   favicon.ico (16/32/48) + favicon.png  — spade, black on white
//   apple-touch-icon.png (180)            — spade on a cream card, padded
//   og-image.png (1200x630)               — navy banner: "SLAVE" + the 4 suits
// Node built-ins only (zlib + manual PNG decode/encode + CRC32 + ICO + pixel font).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import zlib from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2];
if (!SRC) throw new Error('usage: node build-brand-assets.mjs <source-suits.png>');

// palette
const NAVY_TOP = [32, 36, 58];
const NAVY_BOT = [20, 16, 31];
const CREAM = [244, 236, 208];
const INK = [22, 19, 30];
const YELLOW = [245, 209, 102];
const WHITE = [255, 255, 255];

// ---------- PNG decode (8-bit, non-interlaced) ----------
function paeth(a, b, c) {
  const p = a + b - c,
    pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
function decodePNG(buf) {
  let pos = 8,
    w = 0,
    h = 0,
    colorType = 6,
    bitDepth = 8,
    interlace = 0;
  const idat = [];
  let plte = null,
    trns = null;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error('unsupported PNG (need 8-bit, non-interlaced)');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const recon = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[rp++];
    const row = recon.subarray(y * stride, y * stride + stride);
    const prev = y > 0 ? recon.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const v = raw[rp++];
      const a = x >= ch ? row[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      row[x] =
        (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 0xff;
    }
  }
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * ch;
    let r, g, b;
    if (colorType === 6 || colorType === 2) [r, g, b] = [recon[o], recon[o + 1], recon[o + 2]];
    else if (colorType === 0 || colorType === 4) [r, g, b] = [recon[o], recon[o], recon[o]];
    else {
      const idx = recon[o];
      [r, g, b] = [plte[idx * 3], plte[idx * 3 + 1], plte[idx * 3 + 2]];
    }
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }
  return { w, h, rgba };
}

// ---------- crop one suit (bbox of non-white ink in a quadrant), squared ----------
function cropSuit(img, qx, qy, qw, qh) {
  const { w, rgba } = img;
  let minX = qx + qw,
    minY = qy + qh,
    maxX = qx,
    maxY = qy,
    found = false;
  for (let y = qy; y < qy + qh; y++)
    for (let x = qx; x < qx + qw; x++) {
      const i = (y * w + x) * 4;
      if (Math.min(rgba[i], rgba[i + 1], rgba[i + 2]) < 200) {
        found = true;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  if (!found) throw new Error('no ink found in quadrant');
  const bw = maxX - minX + 1,
    bh = maxY - minY + 1;
  const pad = Math.round(Math.max(bw, bh) * 0.1);
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2;
  const side = Math.max(bw, bh) + pad * 2;
  return { x0: Math.round(cx - side / 2), y0: Math.round(cy - side / 2), w: side, h: side, src: img };
}

// ---------- composite a suit crop into a target rect over a bg colour ----------
function blit(dst, W, crop, dx, dy, dw, dh, bg) {
  const { x0, y0, w: cw, h: chh, src } = crop;
  for (let ty = 0; ty < dh; ty++)
    for (let tx = 0; tx < dw; tx++) {
      const sx0 = x0 + (tx / dw) * cw,
        sx1 = x0 + ((tx + 1) / dw) * cw;
      const sy0 = y0 + (ty / dh) * chh,
        sy1 = y0 + ((ty + 1) / dh) * chh;
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
      for (let yy = Math.floor(sy0); yy < Math.ceil(sy1); yy++)
        for (let xx = Math.floor(sx0); xx < Math.ceil(sx1); xx++) {
          let sr = 255,
            sg = 255,
            sb = 255;
          if (xx >= 0 && xx < src.w && yy >= 0 && yy < src.h) {
            const i = (yy * src.w + xx) * 4;
            sr = src.rgba[i];
            sg = src.rgba[i + 1];
            sb = src.rgba[i + 2];
          }
          const cov = 1 - Math.min(sr, sg, sb) / 255; // white->0, black/red->1
          r += bg[0] * (1 - cov) + sr * cov;
          g += bg[1] * (1 - cov) + sg * cov;
          b += bg[2] * (1 - cov) + sb * cov;
          n++;
        }
      const px = dx + tx,
        py = dy + ty;
      if (px < 0 || px >= W || py < 0) continue;
      const i = (py * W + px) * 4;
      dst[i] = Math.round(r / n);
      dst[i + 1] = Math.round(g / n);
      dst[i + 2] = Math.round(b / n);
      dst[i + 3] = 255;
    }
}

function fill(dst, W, H, color) {
  for (let i = 0; i < W * H; i++) {
    dst[i * 4] = color[0];
    dst[i * 4 + 1] = color[1];
    dst[i * 4 + 2] = color[2];
    dst[i * 4 + 3] = 255;
  }
}
function rect(dst, W, x, y, rw, rh, color) {
  for (let yy = y; yy < y + rh; yy++)
    for (let xx = x; xx < x + rw; xx++) {
      const i = (yy * W + xx) * 4;
      dst[i] = color[0];
      dst[i + 1] = color[1];
      dst[i + 2] = color[2];
      dst[i + 3] = 255;
    }
}

// ---------- pixel font (just the glyphs we need) ----------
const FONT = {
  S: ['11111', '10000', '10000', '11111', '00001', '00001', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};
function textWidth(text, sc) {
  return text.length * 5 * sc + (text.length - 1) * sc;
}
function drawText(dst, W, text, x, y, sc, color) {
  let cx = x;
  for (const ch of text) {
    const g = FONT[ch];
    if (g) for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (g[r][c] === '1') rect(dst, W, cx + c * sc, y + r * sc, sc, sc, color);
    cx += 6 * sc;
  }
}

// ---------- CRC32 / PNG encode / ICO ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  let p = 0;
  for (let y = 0; y < h; y++) {
    raw[p++] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
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
function squareIcon(crop, size, bg, padFrac) {
  const buf = Buffer.alloc(size * size * 4);
  fill(buf, size, size, bg);
  const pad = Math.round(size * padFrac);
  blit(buf, size, crop, pad, pad, size - 2 * pad, size - 2 * pad, bg);
  return buf;
}
function buildICO(crop, sizes) {
  const pngs = sizes.map((s) => encodePNG(s, s, squareIcon(crop, s, WHITE, 0.04)));
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(sizes.length, 4);
  let off = 6 + 16 * sizes.length;
  const entries = sizes.map((s, i) => {
    const e = Buffer.alloc(16);
    e[0] = s;
    e[1] = s;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(pngs[i].length, 8);
    e.writeUInt32LE(off, 12);
    off += pngs[i].length;
    return e;
  });
  return Buffer.concat([dir, ...entries, ...pngs]);
}

// ---------- run ----------
const img = decodePNG(readFileSync(SRC));
const W = img.w,
  H = img.h,
  hw = Math.floor(W / 2),
  hh = Math.floor(H / 2);
const spade = cropSuit(img, 0, 0, hw, hh);
const heart = cropSuit(img, hw, 0, W - hw, hh);
const diamond = cropSuit(img, 0, hh, hw, H - hh);
const club = cropSuit(img, hw, hh, W - hw, H - hh);
console.log(`source ${W}x${H}; cropped 4 suits`);

// favicon: spade, black on white
writeFileSync(resolve(ROOT, 'apps/web/public/favicon.ico'), buildICO(spade, [16, 32, 48]));
writeFileSync(resolve(ROOT, 'apps/web/public/favicon.png'), encodePNG(48, 48, squareIcon(spade, 48, WHITE, 0.04)));

// apple-touch: spade on a cream card, padded (no transparency, OS rounds corners)
const APPLE = 180;
const apple = squareIcon(spade, APPLE, CREAM, 0.16);
rect(apple, APPLE, 0, 0, APPLE, 4, [216, 200, 154]); // subtle card edge
rect(apple, APPLE, 0, APPLE - 4, APPLE, 4, [216, 200, 154]);
rect(apple, APPLE, 0, 0, 4, APPLE, [216, 200, 154]);
rect(apple, APPLE, APPLE - 4, 0, 4, APPLE, [216, 200, 154]);
writeFileSync(resolve(ROOT, 'apps/web/public/apple-touch-icon.png'), encodePNG(APPLE, APPLE, apple));

// og-image: navy banner, "SLAVE" title, cream panel with the 4 suits
const OW = 1200,
  OH = 630;
const og = Buffer.alloc(OW * OH * 4);
for (let y = 0; y < OH; y++) {
  const t = y / OH;
  const col = [0, 1, 2].map((k) => Math.round(NAVY_TOP[k] * (1 - t) + NAVY_BOT[k] * t));
  for (let x = 0; x < OW; x++) {
    const i = (y * OW + x) * 4;
    og[i] = col[0];
    og[i + 1] = col[1];
    og[i + 2] = col[2];
    og[i + 3] = 255;
  }
}
// title
const sc = 20;
const title = 'SLAVE';
const tw = textWidth(title, sc);
const tx = Math.round((OW - tw) / 2),
  ty = 70;
const sh = Math.round(sc * 0.5);
drawText(og, OW, title, tx + sh, ty + sh, sc, [10, 10, 16]); // shadow
drawText(og, OW, title, tx, ty, sc, YELLOW);
// cream panel
const px = 200,
  py = 250,
  pw = 800,
  ph = 300;
rect(og, OW, px - 4, py - 4, pw + 8, ph + 8, [216, 200, 154]); // border
rect(og, OW, px, py, pw, ph, CREAM);
// 4 suits on the panel
const suits = [spade, heart, diamond, club];
const ss = 190,
  gap = 28;
const totalW = suits.length * ss + (suits.length - 1) * gap;
let sxp = px + Math.round((pw - totalW) / 2);
const syp = py + Math.round((ph - ss) / 2);
for (const s of suits) {
  blit(og, OW, s, sxp, syp, ss, ss, CREAM);
  sxp += ss + gap;
}
writeFileSync(resolve(ROOT, 'apps/web/public/og-image.png'), encodePNG(OW, OH, og));

console.log('wrote favicon.ico/.png, apple-touch-icon.png (180), og-image.png (1200x630)');
