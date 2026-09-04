import { test } from "node:test";
import assert from "node:assert/strict";
import { __subtleForTests as shim, SubtleShimError } from "./subtle.ts";

/**
 * Oracle is Node's real WebCrypto: the shim must agree with it for every input the dependency
 * chain actually produces, and fail loudly everywhere else.
 */

async function realP256() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return {
    spki: new Uint8Array(await crypto.subtle.exportKey("spki", kp.publicKey)),
    raw: new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)),
  };
}

test("spki import then raw export matches real WebCrypto", async () => {
  const { spki, raw } = await realP256();
  const key = await shim.importKey("spki", spki, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
  assert.deepEqual(new Uint8Array(await shim.exportKey("raw", key)), raw);
});

test("digest matches real WebCrypto", async () => {
  for (const text of ["", "a", "the quick brown fox", "x".repeat(1000)]) {
    const data = new TextEncoder().encode(text);
    for (const alg of ["SHA-256", "SHA-512"]) {
      assert.deepEqual(
        new Uint8Array(await shim.digest(alg, data)),
        new Uint8Array(await crypto.subtle.digest(alg, data)),
        `${alg} of ${JSON.stringify(text.slice(0, 12))}`,
      );
    }
  }
});

test("raw import round-trips", async () => {
  const { raw } = await realP256();
  const key = await shim.importKey("raw", raw, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
  assert.deepEqual(new Uint8Array(await shim.exportKey("raw", key)), raw);
});

test("refuses what it does not implement, by name", async () => {
  const { spki, raw } = await realP256();
  await assert.rejects(() => shim.digest("SHA-1", new Uint8Array(1)), SubtleShimError, "unsupported digest");
  await assert.rejects(
    () => shim.importKey("jwk", spki, { name: "ECDSA" }, true, []), SubtleShimError, "unsupported format");
  await assert.rejects(
    () => shim.importKey("spki", raw, { name: "ECDSA" }, true, []), SubtleShimError, "wrong spki length");
  const key = await shim.importKey("raw", raw, { name: "ECDSA" }, true, []);
  await assert.rejects(() => shim.exportKey("spki", key), SubtleShimError, "unsupported export format");
});
