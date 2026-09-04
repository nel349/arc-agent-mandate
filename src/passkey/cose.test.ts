import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAttestationObject, coseKeyToSpki, CoseError } from "./cose.ts";
import { toArrayBuffer } from "./base64url.ts";

/**
 * Test discipline, carried over from the Kuira SDKs: assert against **independent**
 * implementations, never against our own output.
 *
 * The CBOR *encoder* below only builds fixtures. It is never the oracle — every assertion is
 * checked against Node's WebCrypto (`exportKey('spki', …)`) and against `webauthn-p256`, which
 * is Circle's own dependency and the code that will actually consume what we produce. A bug in
 * the fixture encoder makes tests fail, not pass.
 *
 * A vector captured from a real device belongs here too, and W1 is what produces it.
 */

// ---- minimal CBOR encoder, for fixtures only -------------------------------
function head(major: number, arg: number): number[] {
  if (arg < 24) return [(major << 5) | arg];
  if (arg < 0x100) return [(major << 5) | 24, arg];
  if (arg < 0x10000) return [(major << 5) | 25, arg >> 8, arg & 0xff];
  return [(major << 5) | 26, (arg >>> 24) & 0xff, (arg >> 16) & 0xff, (arg >> 8) & 0xff, arg & 0xff];
}
const uint = (n: number) => head(0, n);
const nint = (n: number) => head(1, -1 - n);
const bstr = (b: Uint8Array) => [...head(2, b.length), ...b];
const tstr = (s: string) => { const b = new TextEncoder().encode(s); return [...head(3, b.length), ...b]; };
const map = (pairs: number[][]) => [...head(5, pairs.length / 2), ...pairs.flat()];

function coseKey(x: Uint8Array, y: Uint8Array): Uint8Array {
  return new Uint8Array(map([
    uint(1), uint(2),        // kty: EC2
    uint(3), nint(-7),       // alg: ES256
    nint(-1), uint(1),       // crv: P-256
    nint(-2), bstr(x),       // x
    nint(-3), bstr(y),       // y
  ]));
}

function authData(credId: Uint8Array, cose: Uint8Array, flags = 0x45): Uint8Array {
  const out = new Uint8Array(37 + 16 + 2 + credId.length + cose.length);
  out.set(new Uint8Array(32).fill(0xab), 0);           // rpIdHash
  out[32] = flags;                                      // UP | UV | AT
  out.set([0, 0, 0, 1], 33);                            // signCount
  out.set(new Uint8Array(16).fill(0xcd), 37);           // aaguid
  out[53] = credId.length >> 8; out[54] = credId.length & 0xff;
  out.set(credId, 55);
  out.set(cose, 55 + credId.length);
  return out;
}

function attestationObject(ad: Uint8Array): Uint8Array {
  return new Uint8Array(map([tstr("fmt"), tstr("none"), tstr("attStmt"), map([]), tstr("authData"), bstr(ad)]));
}

/** A real P-256 key from Node's WebCrypto — the independent oracle. */
async function realKey() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));   // 0x04 || x || y
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", kp.publicKey)); // the answer
  return { x: raw.slice(1, 33), y: raw.slice(33, 65), spki };
}

// ---- tests -----------------------------------------------------------------

test("SPKI matches WebCrypto's own export, byte for byte", async () => {
  const { x, y, spki } = await realKey();
  const got = coseKeyToSpki(coseKey(x, y));
  assert.deepEqual(got, spki, "our SPKI must be identical to crypto.subtle.exportKey('spki')");
  assert.equal(got.length, 91, "a P-256 SPKI is always 91 bytes");
});

test("the SPKI re-imports as a P-256 key", async () => {
  const { x, y } = await realKey();
  const spki = coseKeyToSpki(coseKey(x, y));
  const key = await crypto.subtle.importKey("spki", toArrayBuffer(spki),
    { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" }, true, ["verify"]);
  assert.equal(key.type, "public");
});

test("full attestation object → credential, and webauthn-p256 accepts it", async () => {
  const { x, y, spki } = await realKey();
  const credId = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const parsed = parseAttestationObject(attestationObject(authData(credId, coseKey(x, y))));

  assert.deepEqual(parsed.credentialId, credId);
  assert.deepEqual(parsed.aaguid, new Uint8Array(16).fill(0xcd));
  assert.deepEqual(parsed.publicKeySpki, spki);

  // Circle's own dependency — the code that will actually consume this.
  const { parseCredentialPublicKey } = await import("webauthn-p256");
  const pk = await parseCredentialPublicKey(parsed.publicKeySpki.buffer as ArrayBuffer);
  assert.equal(pk.x, BigInt("0x" + Buffer.from(x).toString("hex")));
  assert.equal(pk.y, BigInt("0x" + Buffer.from(y).toString("hex")));
});

test("variable-length credential ids are handled", async () => {
  const { x, y } = await realKey();
  for (const len of [16, 32, 64, 300]) {
    const credId = new Uint8Array(len).fill(7);
    const parsed = parseAttestationObject(attestationObject(authData(credId, coseKey(x, y))));
    assert.equal(parsed.credentialId.length, len, `credential id of ${len} bytes`);
  }
});

test("rejects what it should reject", async () => {
  const { x, y } = await realKey();
  assert.throws(() => parseAuthDataMissingAt(x, y), CoseError, "AT flag unset");
  assert.throws(() => coseKeyToSpki(new Uint8Array(map([uint(1), uint(1)]))), CoseError, "wrong kty");
  assert.throws(() => coseKeyToSpki(coseKeyShortX(x, y)), CoseError, "short coordinate");
  assert.throws(() => parseAttestationObject(new Uint8Array([0xa0])), CoseError, "no authData");

  function parseAuthDataMissingAt(x: Uint8Array, y: Uint8Array) {
    const ad = authData(new Uint8Array([1, 2]), coseKey(x, y), 0x05); // AT bit cleared
    return parseAttestationObject(attestationObject(ad));
  }
  function coseKeyShortX(x: Uint8Array, y: Uint8Array) {
    return new Uint8Array(map([
      uint(1), uint(2), uint(3), nint(-7), nint(-1), uint(1),
      nint(-2), bstr(x.slice(0, 31)), nint(-3), bstr(y),
    ]));
  }
});

// ---- hostile input ---------------------------------------------------------

test("deeply nested CBOR fails as a CoseError, not a stack overflow", () => {
  // Tag (major 6) carries no length, so each byte nests one level deeper. Before the depth
  // bound this exited as `RangeError: Maximum call stack size exceeded` -- which is not a
  // CoseError, so every caller catching CoseError missed it.
  const nested = new Uint8Array(60_000).fill(0xc0);
  assert.throws(() => parseAttestationObject(nested), CoseError);
});

test("an attestation object with trailing bytes is rejected", async () => {
  // coseKeyToSpki has always rejected trailing bytes; the outer parse now agrees.
  const { x, y } = await realKey();
  const valid = attestationObject(authData(new Uint8Array([1, 2, 3, 4]), coseKey(x, y)));
  const padded = new Uint8Array(valid.length + 1);
  padded.set(valid);
  assert.throws(() => parseAttestationObject(padded), /trailing bytes/);
});
