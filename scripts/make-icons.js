// Draws the app icon (green rounded square with a white check) and writes
// PNGs to public/icons. No dependencies: rasterizes and encodes PNG by hand.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [61, 107, 90];
const FG = [255, 255, 255];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Distance from point p to segment a-b.
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function icon(size) {
  const SS = 4; // supersampling for smooth edges
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const stroke = 0.085;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          const d = Math.min(segDist(u, v, 0.29, 0.52, 0.44, 0.67), segDist(u, v, 0.44, 0.67, 0.72, 0.36));
          if (d < stroke / 2) fg++;
        }
      }
      const a = fg / (SS * SS);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(BG[i] * (1 - a) + FG[i] * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// iOS and Android apply their own rounded mask, so the PNG stays square.
for (const size of [180, 192, 512]) writeFileSync(`public/icons/icon-${size}.png`, icon(size));
console.log('icons written');
