/**
 * Draws the brand: the ring, at every size and on every ground anything asks for.
 *
 *   node --experimental-transform-types scripts/brand.ts
 *
 * Writes `brand/`, which `app.json` names for the app's icon and Android's adaptive one. Drawn here
 * rather than exported from a design tool so it cannot drift from the ring in the app: the stroke
 * ratio comes from `tokens.ts` and the colours from the Machine palette in `themes.ts`, the same
 * values `ArcRing` draws with. Change the ring and every asset below changes with it.
 *
 * Nothing to install. A PNG is a few chunks around a deflated grid of pixels, and Node has deflate
 * and CRC-32 built in; an SVG is text.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { THEMES } from "../src/ui/themes.ts";
import { tokens } from "../src/ui/tokens.ts";

/** The ring's diameter as a share of a square icon, clear of the rounded mask iOS cuts. */
const RING_SHARE = 0.62;
/**
 * The share of an adaptive icon's canvas that is never masked away.
 *
 * Android hands the launcher a 108dp square and lets it cut any shape it likes out of the middle
 * 72dp; a circle, a squircle and a teardrop are all in use. Anything outside that is decoration at
 * best and clipped at worst, so the ring is drawn inside it and the rest of the canvas is empty.
 */
const ANDROID_SAFE = 72 / 108;
/** A third drawn: a limit partly used, which neither a spinner nor a finished goal looks like. */
const SPENT = 0.35;
/** Samples per pixel along each axis, for smooth edges without a graphics library. */
const SUPERSAMPLE = 4;
/**
 * How present the unspent part of the ring is in Android's themed icon.
 *
 * A themed icon is drawn from the alpha channel alone: the launcher throws the colours away and
 * tints what is left with the wallpaper's. One flat silhouette would turn the mark into a plain
 * hoop and lose the thing it says, so the two arcs are told apart by how solid they are instead of
 * by hue, and the shape survives the tinting.
 */
const MONOCHROME_TRACK_ALPHA = 0.42;

const here = (path: string): string => decodeURIComponent(new URL(`../${path}`, import.meta.url).pathname);

const machine = THEMES.find((theme) => theme.id === "machine");
if (machine === undefined) throw new Error("The Machine palette is missing from themes.ts.");
const { groundMid, paper, untested } = machine.color;

type Rgba = readonly [number, number, number, number];
const rgb = (hex: string, alpha = 255): Rgba =>
  [...[0, 2, 4].map((i) => Number.parseInt(hex.slice(1 + i, 3 + i), 16)), alpha] as unknown as Rgba;

const GROUND = rgb(groundMid);
const INK = rgb(paper);
const ALLOWED = rgb(untested);
const NOTHING: Rgba = [0, 0, 0, 0];

/** One drawing of the mark: how big, on what, and how much of the square it fills. */
interface Drawing {
  readonly size: number;
  /** The ground, or `null` for a transparent one. */
  readonly ground: Rgba | null;
  /** Ring diameter as a share of the canvas. */
  readonly share: number;
  /** Both arcs in one ink, told apart by alpha, as Android's themed icon needs. */
  readonly monochrome?: boolean;
}

/**
 * The colour at one point of the drawing.
 *
 * Written as a function of a position rather than as a path, because sampling it four times across
 * and four down is the whole anti-aliasing strategy and needs nothing but arithmetic.
 */
function shade({ size, ground, share, monochrome = false }: Drawing) {
  const diameter = size * share;
  const stroke = diameter * tokens.size.ring.strokeRatio;
  const radius = (diameter - stroke) / 2;
  const centre = size / 2;
  const endAngle = SPENT * 2 * Math.PI;
  /** Where the spent arc's round ends sit, as `ArcRing` draws them with `strokeLinecap="round"`. */
  const caps = [0, endAngle].map(
    (angle) => [centre + radius * Math.sin(angle), centre - radius * Math.cos(angle)] as const,
  );
  // The spent arc is full-strength ink either way; only the track changes between the two.
  const spentInk: Rgba = INK;
  const allowedInk: Rgba = monochrome
    ? [INK[0], INK[1], INK[2], Math.round(255 * MONOCHROME_TRACK_ALPHA)]
    : ALLOWED;

  return (x: number, y: number): Rgba => {
    const dx = x - centre;
    const dy = y - centre;
    if (caps.some(([cx, cy]) => Math.hypot(x - cx, y - cy) <= stroke / 2)) return spentInk;
    if (Math.abs(Math.hypot(dx, dy) - radius) > stroke / 2) return ground ?? NOTHING;
    // Clockwise from twelve o'clock, where the app's ring starts.
    const angle = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI);
    return angle <= endAngle ? spentInk : allowedInk;
  };
}

/**
 * The drawing as pixels, averaged over a grid of samples per pixel.
 *
 * Averaged **premultiplied**, which matters wherever the ground is transparent: mixing an opaque
 * cream with a transparent black the ordinary way drags the edge towards black and leaves a dark
 * fringe around every curve, on exactly the assets that go on somebody else's background.
 */
function render(drawing: Drawing): Buffer {
  const { size, ground } = drawing;
  const colourAt = shade(drawing);
  const opaque = ground !== null;
  const channels = opaque ? 3 : 4;
  const rowLength = 1 + size * channels; // One filter byte per row, then the pixels.
  const pixels = Buffer.alloc(rowLength * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const [cr, cg, cb, ca] = colourAt(x + (sx + 0.5) / SUPERSAMPLE, y + (sy + 0.5) / SUPERSAMPLE);
          const weight = ca / 255;
          r += cr * weight;
          g += cg * weight;
          b += cb * weight;
          a += ca;
        }
      }
      const samples = SUPERSAMPLE * SUPERSAMPLE;
      const alpha = a / samples;
      // Back out of premultiplied, so a half-covered pixel keeps its own colour at half coverage
      // rather than being darkened towards the nothing it was averaged against.
      const scale = alpha === 0 ? 0 : samples / (alpha / 255) / samples;
      const at = y * rowLength + 1 + x * channels;
      pixels[at] = Math.round(Math.min(255, (r / samples) * scale));
      pixels[at + 1] = Math.round(Math.min(255, (g / samples) * scale));
      pixels[at + 2] = Math.round(Math.min(255, (b / samples) * scale));
      if (!opaque) pixels[at + 3] = Math.round(alpha);
    }
  }
  return png(size, channels, pixels);
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function png(size: number, channels: number, pixels: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = channels === 4 ? 6 : 2; // RGBA, or RGB with no alpha
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * The same geometry as text, for everywhere a drawing should not be a grid of pixels: a README, a
 * slide, a page. Two circles and a dash array, which is all the mark has ever been.
 */
function svg({ ground, share, size = 100 }: { ground: string | null; share: number; size?: number }): string {
  const diameter = size * share;
  const stroke = diameter * tokens.size.ring.strokeRatio;
  const radius = (diameter - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const centre = size / 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" `,
    `role="img" aria-label="Arc Agent Mandate">`,
    ground === null ? "" : `<rect width="${size}" height="${size}" fill="${ground}"/>`,
    `<circle cx="${centre}" cy="${centre}" r="${radius.toFixed(3)}" fill="none" stroke="${untested}" `,
    `stroke-width="${stroke.toFixed(3)}"/>`,
    `<circle cx="${centre}" cy="${centre}" r="${radius.toFixed(3)}" fill="none" stroke="${paper}" `,
    `stroke-width="${stroke.toFixed(3)}" stroke-linecap="round" `,
    `stroke-dasharray="${(circumference * SPENT).toFixed(3)} ${circumference.toFixed(3)}" `,
    `transform="rotate(-90 ${centre} ${centre})"/>`,
    `</svg>`,
  ].join("");
}

/**
 * Why each size exists.
 *
 * A brand directory that is a pile of powers of two is a directory nobody can prune, because no file
 * in it says what would break if it went. Every number below is somewhere a thing is actually asked
 * for at that size.
 */
const ICON_SIZES: readonly (readonly [number, string])[] = [
  [1024, "App Store, and the master every other size is checked against"],
  [512, "Play Store listing"],
  [256, "desktop and documentation"],
  [192, "Android xxxhdpi launcher, and a web app manifest"],
  [180, "iPhone home screen at 3x"],
  [128, "a README or a slide"],
  [96, "Android xhdpi launcher"],
  [64, "a list row"],
  [48, "Android mdpi launcher, and the smallest the two arcs still read at"],
  [32, "favicon at 2x"],
  [16, "favicon"],
];

/** Transparent, for putting the mark on something that is not our ground. */
const MARK_SIZES: readonly number[] = [1024, 512, 256, 128, 64];

/** Android hands the launcher a 108dp square and masks it; these are that square at 4x. */
const ADAPTIVE = 1024;

const write = (path: string, data: Buffer | string): void => {
  const full = here(path);
  mkdirSync(full.slice(0, full.lastIndexOf("/")), { recursive: true });
  writeFileSync(full, data);
  console.log(`  ${path}`);
};

console.log("brand/");
write("brand/mark.svg", svg({ ground: null, share: 1 }));
write("brand/icon.svg", svg({ ground: groundMid, share: RING_SHARE }));

for (const [size] of ICON_SIZES) {
  write(`brand/icon/icon-${size}.png`, render({ size, ground: GROUND, share: RING_SHARE }));
}
for (const size of MARK_SIZES) {
  write(`brand/mark/mark-${size}.png`, render({ size, ground: null, share: 1 }));
}

// The ring inside the safe zone rather than filling the canvas, so no launcher's mask crops it.
write("brand/android/adaptive-foreground.png", render({
  size: ADAPTIVE, ground: null, share: RING_SHARE * ANDROID_SAFE,
}));
write("brand/android/adaptive-monochrome.png", render({
  size: ADAPTIVE, ground: null, share: RING_SHARE * ANDROID_SAFE, monochrome: true,
}));

console.log(`\nThe ground is ${groundMid}, which app.json names as the adaptive icon's background.`);
