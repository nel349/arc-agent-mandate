import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import QRCode from "qrcode-terminal/vendor/QRCode/index.js";
import QRErrorCorrectLevel from "qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js";

/**
 * The agent's code as an image file, beside its key.
 *
 * A QR printed in a chat has to survive being reflowed by whatever shows it, and a person moving to
 * another wallet should not have to ask the agent for it again. So each time the code is shown it is
 * also written as a PNG, which a screen can hold still for a camera.
 *
 * No dependency is added for it. The encoder is the one `qrcode-terminal` already carries, and a
 * grayscale PNG is a signature, three chunks and a deflated array of bytes, which Node can write.
 */

/** Pixels per module: large enough for a phone to read it off a laptop screen at arm's length. */
const SCALE = 12;
/** The blank border a QR needs around it, in modules, as the QR specification asks. */
const QUIET_ZONE = 4;

const WHITE = 255;
const BLACK = 0;
/** No filter: every row is stored as it is, which deflate compresses well enough for a QR. */
const FILTER_NONE = 0;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Which modules of the code are dark, row by row. Error correction M, which survives some glare. */
export function qrModules(text: string): readonly (readonly boolean[])[] {
  const qr = new QRCode(-1, QRErrorCorrectLevel.M);
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  return Array.from({ length: count }, (_, row) =>
    Array.from({ length: count }, (_, col) => qr.isDark(row, col)));
}

/** A grayscale PNG of the code: black modules on white, with its quiet zone. */
export function qrPng(modules: readonly (readonly boolean[])[]): Buffer {
  const side = (modules.length + QUIET_ZONE * 2) * SCALE;
  const stride = side + 1; // a filter byte leads every row
  const pixels = Buffer.alloc(stride * side, WHITE);
  for (let y = 0; y < side; y++) {
    pixels[y * stride] = FILTER_NONE;
    const row = Math.floor(y / SCALE) - QUIET_ZONE;
    for (let x = 0; x < side; x++) {
      const col = Math.floor(x / SCALE) - QUIET_ZONE;
      if (modules[row]?.[col] === true) pixels[y * stride + 1 + x] = BLACK;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header[8] = 8; // bits per sample
  header[9] = 0; // grayscale
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Draw `text` as a QR and write it to `path`. */
export function writeQrPng(text: string, path: string): void {
  writeFileSync(path, qrPng(qrModules(text)));
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** The CRC-32 every PNG chunk ends with, over its type and data. */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
