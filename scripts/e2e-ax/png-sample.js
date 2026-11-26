// Minimal PNG decoder (8-bit RGB/RGBA, all filters) + pixel sampling.
'use strict';
const fs = require('fs');
const zlib = require('zlib');

function decode(file) {
  const buf = fs.readFileSync(file);
  let o = 8;
  let w = 0, h = 0, depth = 0, color = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    const data = buf.slice(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; color = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  if (depth !== 8) throw new Error('unsupported bit depth ' + depth);
  const channels = color === 6 ? 4 : color === 2 ? 3 : color === 0 ? 1 : 0;
  if (!channels) throw new Error('unsupported color type ' + color);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    const line = raw.slice(pos, pos + stride); pos += stride;
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.slice(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, channels, data: out };
}

function px(img, x, y) {
  const i = (y * img.w + x) * img.channels;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

const file = process.argv[2];
const img = decode(file);
console.log(`${file}: ${img.w}x${img.h} ch=${img.channels}`);
const pts = (process.argv[3] || '').split(';').filter(Boolean).map((s) => s.split(',').map(Number));
for (const [x, y] of pts) {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) { console.log(`  (${x},${y}) out of bounds`); continue; }
  console.log(`  (${x},${y}) = rgb(${px(img, x, y).join(',')})`);
}
// Distinct colour count in a small box (is there content?)
if (process.argv[4]) {
  const [bx, by, bw, bh] = process.argv[4].split(',').map(Number);
  const seen = new Set();
  for (let y = by; y < Math.min(by + bh, img.h); y++) for (let x = bx; x < Math.min(bx + bw, img.w); x++) seen.add(px(img, x, y).join(','));
  console.log(`  box ${bx},${by} ${bw}x${bh}: ${seen.size} distinct colours`);
}
