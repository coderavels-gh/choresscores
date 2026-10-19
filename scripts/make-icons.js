// Draws the app icon (red broom on white, laid out like the Apple Health
// heart) and writes PNGs to public/icons. No dependencies: rasterizes and
// encodes PNG by hand.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [255, 255, 255];
const TOP = [255, 105, 97]; // gradient across the broom, light red at the top...
const BOTTOM = [228, 30, 46]; // ...to deep red at the bottom

// Broom placement: centre, size and tilt (handle pointing up-right).
const CENTER = [0.66, 0.34];
const SCALE = 0.54;
const ANGLE = (38 * Math.PI) / 180;

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

// Is (u, v) inside the upright broom? Local units: handle top at v = -0.5,
// bristle tips at v = 0.5.
function inBroom(u, v) {
  if (segDist(u, v, 0, -0.48, 0, 0.04) < 0.034) return true; // handle
  if (Math.abs(u) <= 0.1 && v >= 0.04 && v <= 0.13) return true; // binding
  if (v >= 0.16 && v <= 0.5) {
    const half = 0.09 + ((v - 0.16) / 0.34) * 0.12; // bristles fan out
    if (Math.abs(u) > half) return false;
    // Thin gaps between bristle bunches.
    if (v > 0.24) for (const t of [-0.5, 0, 0.5]) if (Math.abs(u - t * half) < 0.011) return false;
    // Rounded bottom corners.
    if (v > 0.45 && Math.abs(u) > half - 0.05 && Math.hypot(Math.abs(u) - (half - 0.05), v - 0.45) > 0.05) return false;
    return true;
  }
  return false;
}

function icon(size) {
  const SS = 4; // supersampling for smooth edges
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const cos = Math.cos(ANGLE), sin = Math.sin(ANGLE);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const dx = (x + (sx + 0.5) / SS) / size - CENTER[0];
          const dy = (y + (sy + 0.5) / SS) / size - CENTER[1];
          // Rotate the sample back into broom-local coordinates.
          if (inBroom((dx * cos + dy * sin) / SCALE, (-dx * sin + dy * cos) / SCALE)) hits++;
        }
      }
      const a = hits / (SS * SS);
      const g = Math.min(1, Math.max(0, (y / size - 0.1) / 0.6));
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let i = 0; i < 3; i++) {
        const fg = TOP[i] * (1 - g) + BOTTOM[i] * g;
        raw[o + i] = Math.round(BG[i] * (1 - a) + fg * a);
      }
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
