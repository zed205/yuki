/*
 * Yuki Browser Control — icon generator.
 * Generates icons/icon{16,32,48,128}.png with zero dependencies:
 * a rounded square (indigo→violet gradient) with a white "Y".
 *
 * Run: node make-icons.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---- minimal PNG encoder (RGBA, 8-bit) ------------------------------------
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function encodePNG(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const tb = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
    return Buffer.concat([len, tb, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- drawing helpers -------------------------------------------------------
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp01(t);
  const cx = ax + t * dx, cy = ay + t * dy;
  const ex = px - cx, ey = py - cy;
  return Math.sqrt(ex * ex + ey * ey);
}
function insideRoundedRect(px, py, size, r) {
  let cx, cy;
  if (px < r && py < r) { cx = r; cy = r; }
  else if (px > size - r && py < r) { cx = size - r; cy = r; }
  else if (px < r && py > size - r) { cx = r; cy = size - r; }
  else if (px > size - r && py > size - r) { cx = size - r; cy = size - r; }
  else return 1;
  const d = Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
  return clamp01(r + 0.5 - d);
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const top = [79, 70, 229];     // #4f46e5
  const bottom = [124, 58, 237]; // #7c3aed
  const r = size * 0.24;
  const stroke = Math.max(size * 0.06, size >= 32 ? size * 0.08 : size * 0.1);
  const segs = [
    [0.30, 0.26, 0.50, 0.52], // left arm
    [0.70, 0.26, 0.50, 0.52], // right arm
    [0.50, 0.50, 0.50, 0.76], // stem
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cov = insideRoundedRect(x + 0.5, y + 0.5, size, r);
      if (cov <= 0) continue;
      const t = y / ((size - 1) || 1);
      let R = lerp(top[0], bottom[0], t);
      let G = lerp(top[1], bottom[1], t);
      let B = lerp(top[2], bottom[2], t);
      let minD = Infinity;
      for (const s of segs) minD = Math.min(minD, segDist(x + 0.5, y + 0.5, s[0] * size, s[1] * size, s[2] * size, s[3] * size));
      const w = clamp01(stroke / 2 + 0.5 - minD); // white coverage (AA)
      R = lerp(R, 255, w); G = lerp(G, 255, w); B = lerp(B, 255, w);
      const i = (y * size + x) * 4;
      rgba[i] = R; rgba[i + 1] = G; rgba[i + 2] = B; rgba[i + 3] = 255 * cov;
    }
  }
  return rgba;
}

const outDir = path.join(__dirname, 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const png = encodePNG(size, drawIcon(size));
  fs.writeFileSync(path.join(outDir, 'icon' + size + '.png'), png);
  console.log('wrote icons/icon' + size + '.png (' + png.length + ' bytes)');
}
