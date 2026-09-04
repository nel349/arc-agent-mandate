import { test } from "node:test";
import assert from "node:assert/strict";
import { toBase64url, fromBase64url, anyToBase64url, Base64UrlError } from "./base64url.ts";

/** Oracle is Node's `Buffer`, which implements base64url independently of this code. */
const oracle = {
  encode: (b: Uint8Array) => Buffer.from(b).toString("base64url"),
  decode: (s: string) => new Uint8Array(Buffer.from(s, "base64url")),
};

test("encodes identically to Buffer, at every length mod 3", () => {
  for (let len = 0; len <= 64; len++) {
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = (i * 37 + 11) & 0xff;
    assert.equal(toBase64url(bytes), oracle.encode(bytes), `length ${len}`);
  }
});

test("round-trips arbitrary bytes", () => {
  for (let len = 0; len <= 64; len++) {
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = (i * 97 + 3) & 0xff;
    assert.deepEqual(fromBase64url(toBase64url(bytes)), bytes, `length ${len}`);
  }
});

test("decodes what Buffer encodes", () => {
  for (let len = 0; len <= 64; len++) {
    const bytes = new Uint8Array(len).map((_, i) => (i * 53 + 7) & 0xff);
    assert.deepEqual(fromBase64url(oracle.encode(bytes)), bytes, `length ${len}`);
  }
});

test("covers the whole alphabet, including - and _", () => {
  // 0xFB 0xFF produces '-' and '_' in base64url where base64 would give '+' and '/'.
  const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0x00, 0x10, 0x83]);
  const encoded = toBase64url(bytes);
  assert.equal(encoded, oracle.encode(bytes));
  assert.ok(!encoded.includes("+") && !encoded.includes("/") && !encoded.includes("="));
  assert.deepEqual(fromBase64url(encoded), bytes);
});

test("all 256 byte values survive a round trip", () => {
  const all = new Uint8Array(256).map((_, i) => i);
  assert.equal(toBase64url(all), oracle.encode(all));
  assert.deepEqual(fromBase64url(toBase64url(all)), all);
});

test("rejects malformed input rather than returning wrong bytes", () => {
  assert.throws(() => fromBase64url("A"), Base64UrlError, "orphan character");
  assert.throws(() => fromBase64url("AB*D"), Base64UrlError, "illegal character");
  assert.throws(() => fromBase64url("AB+D"), Base64UrlError, "base64 '+' is not base64url");
  assert.throws(() => fromBase64url("AB/D"), Base64UrlError, "base64 '/' is not base64url");
});

test("anyToBase64url accepts the three shapes Circle passes", () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const expected = oracle.encode(bytes);
  assert.equal(anyToBase64url(bytes), expected, "Uint8Array");
  assert.equal(anyToBase64url(bytes.buffer as ArrayBuffer), expected, "ArrayBuffer");
  assert.equal(anyToBase64url(expected), expected, "already-encoded string passes through");
});

test("respects byteOffset on a view into a larger buffer", () => {
  const backing = new Uint8Array([9, 9, 1, 2, 3, 9, 9]);
  const view = new Uint8Array(backing.buffer, 2, 3);
  assert.equal(anyToBase64url(view), oracle.encode(new Uint8Array([1, 2, 3])));
});
