import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { qrModules, qrPng, writeQrPng } from "./pairing-image.ts";

const LINK = "ethereum:0xB8A53c985E437000C4e77300690B00B146D293D2@5042002?pairing=0123456789abcdef0123456789abcdef";
const SCALE = 12;
const QUIET_ZONE = 4;

/** The pixel rows of a grayscale PNG, each still led by its filter byte. */
function pixelsOf(png: Buffer): { readonly width: number; readonly pixels: Buffer } {
  const width = png.readUInt32BE(16);
  const data: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    if (png.toString("ascii", at + 4, at + 8) === "IDAT") data.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  return { width, pixels: inflateSync(Buffer.concat(data)) };
}

test("the file is a PNG, square, with the quiet zone the specification asks for", () => {
  const modules = qrModules(LINK);
  const png = qrPng(modules);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), png.readUInt32BE(20), "not square");
  assert.equal(png.readUInt32BE(16), (modules.length + QUIET_ZONE * 2) * SCALE);
});

/**
 * Every module lands where the encoder put it. A picture of a QR that is shifted by a pixel row or
 * mirrored still looks like a QR, and no camera can read it.
 */
test("the image is the code: every module is drawn where the encoder put it", () => {
  const modules = qrModules(LINK);
  const { width, pixels } = pixelsOf(qrPng(modules));
  const stride = width + 1;
  const at = (x: number, y: number): number | undefined => pixels[y * stride + 1 + x];

  modules.forEach((row, r) => row.forEach((dark, c) => {
    const centre = (index: number): number => (index + QUIET_ZONE) * SCALE + SCALE / 2;
    assert.equal(at(centre(c), centre(r)), dark ? 0 : 255, `module ${r},${c}`);
  }));
  assert.equal(at(0, 0), 255, "the quiet zone is not white");
});

test("it is written where it is asked to be", () => {
  const path = join(mkdtempSync(join(tmpdir(), "arc-mandate-qr-")), "pairing-code.png");
  writeQrPng(LINK, path);
  assert.deepEqual(readFileSync(path), qrPng(qrModules(LINK)));
});
