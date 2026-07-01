// Renders the Gate Guide app icons as PNGs with no image dependencies.
// The icon is a teal wayfinding route from an amber "you are here" dot to a
// white gate dot, drawn with signed-distance sampling at 2x supersampling,
// then encoded as PNG by hand via node:zlib.
//
// Usage: node scripts/generate-icons.js

import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const NAVY = [16, 42, 58];
const TEAL = [26, 188, 182];
const AMBER = [240, 169, 46];
const WHITE = [255, 255, 255];

// Route waypoints in normalized icon coordinates.
const ROUTE = [
  [0.28, 0.73],
  [0.5, 0.73],
  [0.5, 0.42],
  [0.73, 0.42]
];
const ROUTE_WIDTH = 0.085;
const START = { center: ROUTE[0], radius: 0.085, fill: AMBER, ring: WHITE, ringWidth: 0.028 };
const END = { center: ROUTE.at(-1), radius: 0.075, fill: WHITE, ring: TEAL, ringWidth: 0.028 };

function segmentDistance(px, py, [ax, ay], [bx, by]) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

function routeDistance(px, py) {
  let best = Infinity;
  for (let index = 0; index < ROUTE.length - 1; index += 1) {
    best = Math.min(best, segmentDistance(px, py, ROUTE[index], ROUTE[index + 1]));
  }
  return best;
}

function roundedRectInside(px, py, inset, radius) {
  const cx = Math.max(inset + radius - px, px - (1 - inset - radius), 0);
  const cy = Math.max(inset + radius - py, py - (1 - inset - radius), 0);
  return Math.hypot(cx, cy) <= radius;
}

// Returns the RGBA color for one normalized sample point.
function samplePixel(px, py, { maskable }) {
  const inset = maskable ? 0 : 0.04;
  const radius = maskable ? 0 : 0.2;
  const inside = maskable || roundedRectInside(px, py, inset, radius);
  if (!inside) return [0, 0, 0, 0];

  // Maskable icons keep artwork inside the 80% safe zone so round masks
  // never clip the route endpoints.
  if (maskable) {
    px = 0.5 + (px - 0.5) / 0.78;
    py = 0.5 + (py - 0.5) / 0.78;
  }

  for (const dot of [START, END]) {
    const distance = Math.hypot(px - dot.center[0], py - dot.center[1]);
    if (distance <= dot.radius) return [...dot.fill, 255];
    if (distance <= dot.radius + dot.ringWidth) return [...dot.ring, 255];
  }

  if (routeDistance(px, py) <= ROUTE_WIDTH / 2) return [...TEAL, 255];
  return [...NAVY, 255];
}

function renderIcon(size, options) {
  const pixels = Buffer.alloc(size * size * 4);
  const subSamples = [0.25, 0.75];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const sy of subSamples) {
        for (const sx of subSamples) {
          const [sr, sg, sb, sa] = samplePixel((x + sx) / size, (y + sy) / size, options);
          r += sr;
          g += sg;
          b += sb;
          a += sa;
        }
      }
      const offset = (y * size + x) * 4;
      pixels[offset] = Math.round(r / 4);
      pixels[offset + 1] = Math.round(g / 4);
      pixels[offset + 2] = Math.round(b / 4);
      pixels[offset + 3] = Math.round(a / 4);
    }
  }
  return pixels;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(pixels, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const scanlines = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    scanlines[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(scanlines, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

const outputs = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "maskable-192.png", size: 192, maskable: true },
  { file: "maskable-512.png", size: 512, maskable: true },
  { file: "apple-touch-icon.png", size: 180, maskable: true }
];

await mkdir("public/icons", { recursive: true });
for (const { file, size, maskable } of outputs) {
  const png = encodePng(renderIcon(size, { maskable }), size);
  await writeFile(`public/icons/${file}`, png);
  console.log(`public/icons/${file} (${size}x${size}, ${png.length} bytes)`);
}
