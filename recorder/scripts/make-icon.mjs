// Generates the recorder's app icon with no image dependencies.
//
// Draws into an RGBA buffer at 4x, box-downsamples for antialiasing, encodes
// PNG with Node's zlib, and assembles a multi-size .ico (the format allows
// PNG-compressed entries). Run: node scripts/make-icon.mjs
//
// The mark is the site's civic dome (see the header in src/app/layout.tsx),
// traced from the same 24x24 viewBox geometry so the app and the website carry
// one identity, plus a red dot: this is the recorder.

import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";

const SS = 4; // supersample factor
const BASE = 256;

const NAVY = [18, 46, 82, 255];
const NAVY_TOP = [31, 74, 128, 255];
const WHITE = [255, 255, 255, 255];
const RED = [229, 72, 77, 255];

function makeCanvas(size) {
  return { size, data: new Uint8Array(size * size * 4) };
}

function blend(c, x, y, rgba) {
  if (x < 0 || y < 0 || x >= c.size || y >= c.size) return;
  const i = (y * c.size + x) * 4;
  const a = rgba[3] / 255;
  if (a >= 1) {
    c.data[i] = rgba[0];
    c.data[i + 1] = rgba[1];
    c.data[i + 2] = rgba[2];
    c.data[i + 3] = 255;
    return;
  }
  for (let k = 0; k < 3; k++) {
    c.data[i + k] = Math.round(c.data[i + k] * (1 - a) + rgba[k] * a);
  }
  c.data[i + 3] = Math.max(c.data[i + 3], rgba[3]);
}

/** Rounded rectangle, optionally vertically gradient-filled. */
function roundedRect(c, x0, y0, w, h, r, top, bottom = top) {
  for (let y = Math.floor(y0); y < y0 + h; y++) {
    for (let x = Math.floor(x0); x < x0 + w; x++) {
      const dx = Math.max(x0 + r - x, x - (x0 + w - 1 - r), 0);
      const dy = Math.max(y0 + r - y, y - (y0 + h - 1 - r), 0);
      if (dx * dx + dy * dy > r * r) continue;
      const t = (y - y0) / h;
      const col = [
        Math.round(top[0] * (1 - t) + bottom[0] * t),
        Math.round(top[1] * (1 - t) + bottom[1] * t),
        Math.round(top[2] * (1 - t) + bottom[2] * t),
        255,
      ];
      blend(c, x, y, col);
    }
  }
}

function circle(c, cx, cy, r, rgba) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) blend(c, x, y, rgba);
    }
  }
}

/** Distance from a point to a line segment. */
function distToSegment(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x0) * dx + (py - y0) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

/** Round-capped stroked line, drawn as a distance field. */
function strokeLine(c, x0, y0, x1, y1, width, rgba) {
  const r = width / 2;
  const minX = Math.floor(Math.min(x0, x1) - r - 1);
  const maxX = Math.ceil(Math.max(x0, x1) + r + 1);
  const minY = Math.floor(Math.min(y0, y1) - r - 1);
  const maxY = Math.ceil(Math.max(y0, y1) + r + 1);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (distToSegment(x + 0.5, y + 0.5, x0, y0, x1, y1) <= r) {
        blend(c, x, y, rgba);
      }
    }
  }
}

/** Round-capped stroked arc. Angles in radians, screen coords (y grows down). */
function strokeArc(c, cx, cy, radius, a0, a1, width, rgba) {
  const r = width / 2;
  const outer = radius + r + 1;
  for (let y = Math.floor(cy - outer); y <= cy + outer; y++) {
    for (let x = Math.floor(cx - outer); x <= cx + outer; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const dx = px - cx;
      const dy = py - cy;
      let ang = Math.atan2(dy, dx);
      if (ang < 0) ang += Math.PI * 2;
      let inRange = ang >= a0 && ang <= a1;
      // Handle a range that wraps past 2*PI.
      if (!inRange && a1 > Math.PI * 2) {
        inRange = ang + Math.PI * 2 >= a0 && ang + Math.PI * 2 <= a1;
      }
      const d = inRange
        ? Math.abs(Math.hypot(dx, dy) - radius)
        : Math.min(
            Math.hypot(px - (cx + radius * Math.cos(a0)), py - (cy + radius * Math.sin(a0))),
            Math.hypot(px - (cx + radius * Math.cos(a1)), py - (cy + radius * Math.sin(a1)))
          );
      if (d <= r) blend(c, x, y, rgba);
    }
  }
}

function draw() {
  const size = BASE * SS;
  const c = makeCanvas(size);
  const s = (v) => v * SS;

  // Tile
  roundedRect(c, s(8), s(8), s(240), s(240), s(54), NAVY_TOP, NAVY);

  // The site mark lives in a 24x24 viewBox spanning x 4..20, y 3..20.
  // Map that box into the tile, nudged up slightly to sit optically centred
  // once the record dot is added at bottom right.
  const SCALE = 8.2;
  const vb = (vx, vy) => [
    s(124 + (vx - 12) * SCALE),
    s(124 + (vy - 12.2) * SCALE),
  ];
  // The site draws this at 2 units, where the outer columns exactly touch the
  // walls. That is fine at 28px in a header but turns to mush in a 16px icon,
  // so the stroke is thinned until all three columns read as separate.
  const stroke = s(1.6 * SCALE);
  const line = (x0, y0, x1, y1) => {
    const [ax, ay] = vb(x0, y0);
    const [bx, by] = vb(x1, y1);
    strokeLine(c, ax, ay, bx, by, stroke, WHITE);
  };

  // Same elements as the site mark (steps, columns, entablature, dome, finial)
  // but with the dome narrower than the base. A dome the full width of the body
  // silhouettes as a bell; setting it back is what makes it read as a capitol.

  // Steps: the widest line, grounding the building.
  line(3.5, 20, 20.5, 20);
  // Floor the columns stand on.
  line(5, 18.4, 19, 18.4);
  // Three columns.
  line(7.5, 18.4, 7.5, 13.4);
  line(12, 18.4, 12, 13.4);
  line(16.5, 18.4, 16.5, 13.4);
  // Entablature above the columns.
  line(5.5, 12.6, 18.5, 12.6);
  // Dome, set back from the building's edges.
  const [dcx, dcy] = vb(12, 12.6);
  strokeArc(c, dcx, dcy, s(5.4 * SCALE), Math.PI, Math.PI * 2, stroke, WHITE);
  // Finial above the dome.
  line(12, 7.2, 12, 4.4);

  // Recording indicator, with a tile-coloured halo so it reads as a separate
  // element instead of blurring into the building's strokes.
  circle(c, s(205), s(205), s(33), NAVY);
  circle(c, s(205), s(205), s(24), RED);

  return c;
}

/** Box-downsample by an integer factor. */
function downsample(c, factor) {
  const size = c.size / factor;
  const out = makeCanvas(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const i = ((y * factor + dy) * c.size + (x * factor + dx)) * 4;
          const af = c.data[i + 3] / 255;
          r += c.data[i] * af;
          g += c.data[i + 1] * af;
          b += c.data[i + 2] * af;
          a += c.data[i + 3];
        }
      }
      const n = factor * factor;
      const alpha = a / n;
      const norm = alpha > 0 ? alpha / 255 : 1;
      const o = (y * size + x) * 4;
      out.data[o] = Math.round(r / n / norm);
      out.data[o + 1] = Math.round(g / n / norm);
      out.data[o + 2] = Math.round(b / n / norm);
      out.data[o + 3] = Math.round(alpha);
    }
  }
  return out;
}

/** Nearest-neighbour resize of an already-antialiased canvas. */
function resize(c, size) {
  const out = makeCanvas(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.floor((x * c.size) / size);
      const sy = Math.floor((y * c.size) / size);
      const i = (sy * c.size + sx) * 4;
      const o = (y * size + x) * 4;
      out.data.set(c.data.subarray(i, i + 4), o);
    }
  }
  return out;
}

// --- PNG encoding ----------------------------------------------------------

const CRC_TABLE = (() => {
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
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(c) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.size, 0);
  ihdr.writeUInt32BE(c.size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(c.size * (c.size * 4 + 1));
  for (let y = 0; y < c.size; y++) {
    const off = y * (c.size * 4 + 1);
    raw[off] = 0; // filter: none
    Buffer.from(c.data.subarray(y * c.size * 4, (y + 1) * c.size * 4)).copy(
      raw,
      off + 1
    );
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** ICO with PNG-compressed entries (supported since Vista). */
function encodeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);

  let offset = 6 + pngs.length * 16;
  const entries = [];
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0;
    e[3] = 0;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }
  return Buffer.concat([
    header,
    ...entries,
    ...pngs.map((p) => p.data),
  ]);
}

// --- main ------------------------------------------------------------------

const master = downsample(draw(), SS);
await mkdir("build", { recursive: true });

await writeFile("build/icon.png", encodePng(master));

const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map((size) => ({
  size,
  data: encodePng(size === BASE ? master : resize(master, size)),
}));
await writeFile("build/icon.ico", encodeIco(pngs));

console.log(
  `wrote build/icon.png (${BASE}px) and build/icon.ico (${sizes.join(", ")})`
);
