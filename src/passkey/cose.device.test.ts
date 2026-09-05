import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { webcrypto } from "node:crypto";
import { parseAttestationObject } from "./cose.ts";
import { fromBase64url, toArrayBuffer } from "./base64url.ts";
import { VECTOR_TAG } from "./vector-tag.ts";

/**
 * The parser, against authenticators we do not control.
 *
 * `cose.test.ts` builds every fixture with its own CBOR encoder. That is sound as far as it
 * goes — the assertions are checked against Node's WebCrypto and `webauthn-p256`, never against
 * our own output — but a hand-built fixture can only contain what we thought to put in it. A
 * real Secure Enclave or Credential Manager decides its own `aaguid`, its own `attStmt`, and
 * whether anything trails the COSE key.
 *
 * So this file asserts over captured vectors instead, and grows coverage the moment one lands
 * in `vectors/` — see the README there for the capture steps. Until then it is honest about
 * making no claim: it declares no per-vector test rather than passing an empty one.
 *
 * What it does guard unconditionally is the capture path itself. The whole mechanism is two
 * halves agreeing on one string, in two languages, that nothing else references — precisely the
 * kind of coupling that rots silently and is discovered during the device run you were relying
 * on.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const VECTOR_DIR = join(HERE, "vectors");

/**
 * A corrupt fixture should name itself. Parsed at module load, an unhandled `JSON.parse` throw
 * takes down the whole file with a message that mentions neither this directory nor the file.
 */
const vectors = readdirSync(VECTOR_DIR)
  .filter((name) => name.endsWith(".json"))
  .map((name) => {
    const raw = readFileSync(join(VECTOR_DIR, name), "utf8");
    try {
      return { name, ...JSON.parse(raw) };
    } catch (cause) {
      throw new Error(`vectors/${name} is not valid JSON — re-capture it`, { cause });
    }
  });

test("the capture tag the app prints is the one the save script looks for", () => {
  const script = readFileSync(join(HERE, "..", "..", "scripts", "save-vector.mjs"), "utf8");
  const declared = /const TAG = "([^"]+)"/.exec(script);
  assert.notEqual(declared, null, "save-vector.mjs no longer declares a TAG constant");
  assert.equal(
    declared?.[1],
    VECTOR_TAG,
    "The app prints one tag and the save script greps for another, so a device capture would " +
    "be silently discarded.",
  );
});

for (const vector of vectors) {
  test(`${vector.name}: parses, and its public key is one WebCrypto accepts`, async () => {
    const attested = parseAttestationObject(fromBase64url(vector.attestationObject));

    // rpIdHash (32) + flags (1) + signCount (4). Anything shorter is not authenticator data.
    assert.ok(attested.authenticatorData.length >= 37, "authenticator data is too short");

    // The independent oracle: if WebCrypto imports the SPKI we produced and can verify with it,
    // the COSE key was read correctly. Our own parser never gets to be the judge.
    const key = await webcrypto.subtle.importKey(
      "spki",
      toArrayBuffer(attested.publicKeySpki),
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"],
    );
    const exported = new Uint8Array(await webcrypto.subtle.exportKey("spki", key));
    assert.deepEqual(
      exported,
      attested.publicKeySpki,
      "WebCrypto re-exported a different SPKI than we handed it",
    );
  });
}
