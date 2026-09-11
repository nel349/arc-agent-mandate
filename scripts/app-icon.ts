/**
 * Draws the app icon: the ring alone, on the Machine ground, as `BRAND.md` settles it.
 *
 *   node --experimental-transform-types scripts/app-icon.ts
 *
 * Writes `assets/icon.png`, which `app.json` names as the icon. Drawn here rather than exported
 * from a design tool so it cannot drift from the ring in the app: the stroke ratio comes from
 * `tokens.ts` and the colours from the Machine palette in `themes.ts`, the same values `ArcRing`
 * draws with. Nothing to install: a PNG is a few chunks around a deflated grid of pixels, and Node
 * has deflate and CRC-32 built in.
 */
import { writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { THEMES } from "../src/ui/themes.ts";
import { tokens } from "../src/ui/tokens.ts";

/** Apple's single icon size; the system scales it down for every other place it appears. */
const SIZE = 1024;
/** The ring's diameter as a share of the canvas, clear of the rounded mask iOS cuts. */
const RING_SHARE = 0.62;
/** A third drawn: a limit partly used, which neither a spinner nor a finished goal looks like. */
const SPENT = 0.35;
/** Samples per pixel along each axis, for smooth edges without a graphics library. */
const SUPERSAMPLE = 4;
// A path string, beside this script whatever directory it is run from. `fileURLToPath` would be the
// usual way, but the typecheck sees the DOM's `URL` here rather than Node's, and the two do not mix.
const OUT = decodeURIComponent(new URL("../assets/icon.png", import.meta.url).pathname);

const machine = THEMES.find((theme) => theme.id === "machine");
if (machine === undefined) throw new Error("The Machine palette is missing from themes.ts.");
const { groundMid, paper, untested } = machine.color;

type Rgb = readonly [number, number, number];
const rgb = (hex: string): Rgb => [0, 2, 4].map((i) => Number.parseInt(hex.slice(1 + i, 3 + i), 16)) as unknown as Rgb;
const GROUND = rgb(groundMid);
const INK = rgb(paper);
const ALLOWED = rgb(untested);

const diameter = SIZE * RING_SHARE;
const stroke = diameter * tokens.size.ring.strokeRatio;
const radius = (diameter - stroke) / 2;
const centre = SIZE / 2;
const endAngle = SPENT * 2 * Math.PI;
/** Where the spent arc's round ends sit, as `ArcRing` draws them with `strokeLinecap="round"`. */
const caps = [0, endAngle].map((angle) => [centre + radius * Math.sin(angle), centre - radius * Math.cos(angle)] as const);

/** The colour at one point: ground, the allowed part of the ring, or the spent part. */
function colourAt(x: number, y: number): Rgb {
  const dx = x - centre;
  const dy = y - centre;
  const onCap = caps.some(([cx, cy]) => Math.hypot(x - cx, y - cy) <= stroke / 2);
  if (onCap) return INK;
  if (Math.abs(Math.hypot(dx, dy) - radius) > stroke / 2) return GROUND;
  // Clockwise from twelve o'clock, where the app's ring starts.
  const angle = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI);
  return angle <= endAngle ? INK : ALLOWED;
}

// One filter byte per row, then RGB. No alpha channel: App Store icons may not carry one.
const rowLength = 1 + SIZE * 3;
const pixels = Buffer.alloc(rowLength * SIZE);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const sum = [0, 0, 0];
    for (let sy = 0; sy < SUPERSAMPLE; sy++) {
      for (let sx = 0; sx < SUPERSAMPLE; sx++) {
        const colour = colourAt(x + (sx + 0.5) / SUPERSAMPLE, y + (sy + 0.5) / SUPERSAMPLE);
        for (let c = 0; c < 3; c++) sum[c]! += colour[c]!;
      }
    }
    const at = y * rowLength + 1 + x * 3;
    for (let c = 0; c < 3; c++) pixels[at + c] = Math.round(sum[c]! / (SUPERSAMPLE * SUPERSAMPLE));
  }
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // bits per channel
header[9] = 2; // colour type: RGB, no alpha
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

writeFileSync(OUT, Buffer.concat([
  SIGNATURE,
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(pixels)),
  chunk("IEND", Buffer.alloc(0)),
]));
console.log(`wrote ${OUT}`);
