/**
 * The piece Circle assumes a browser already did.
 *
 * `@circle-fin/modular-wallets-core` calls `credential.response.getPublicKey()` and never
 * touches `attestationObject` — in a browser, `getPublicKey()` returns the credential's public
 * key as **DER SubjectPublicKeyInfo**, which `webauthn-p256` then feeds straight to
 * `crypto.subtle.importKey('spki', …)`.
 *
 * Native gives us no such thing. `ASAuthorizationPlatformPublicKeyCredentialRegistration`
 * yields `rawAttestationObject` (CBOR) and a credential id, and nothing else. Android's
 * Credential Manager *may* include `publicKey` in its registration JSON — it is optional in the
 * WebAuthn JSON serialisation — so it is a short-circuit, never a guarantee.
 *
 * This module closes that gap:
 *
 *     attestationObject (CBOR) → authData → attestedCredentialData → COSE key → SPKI DER
 */

// ---------------------------------------------------------------- CBOR (decode only)

type Cbor = number | Uint8Array | string | Cbor[] | Map<Cbor, Cbor> | boolean | null;

/**
 * Nesting allowed before a structure is treated as hostile rather than merely unusual.
 *
 * A WebAuthn attestation object nests four or five deep at most: the outer map, `attStmt`, an
 * array of certificates, a byte string. Anything past this is not a credential.
 *
 * Without the bound, arrays, maps and tags each recurse once per level, so a run of tag bytes
 * (`0xc0` repeated) recurses once per byte and exits as a `RangeError: Maximum call stack size
 * exceeded`, which is not a `CoseError` -- so every caller that catches `CoseError` misses it.
 * Every length read in this file is already guarded; depth is the same obligation.
 */
const MAX_CBOR_DEPTH = 32;

/** Decodes one CBOR item. Returns the value and how many bytes it consumed — the length
 *  matters because a COSE key sits at the end of authData with no length prefix of its own. */
function decodeItem(b: Uint8Array, pos: number, depth = 0): { value: Cbor; next: number } {
  if (depth > MAX_CBOR_DEPTH) throw new CoseError(`CBOR nested deeper than ${MAX_CBOR_DEPTH}`);
  if (pos >= b.length) throw new CoseError("truncated CBOR");
  const initial = b[pos]!;
  const major = initial >> 5;
  const ai = initial & 0x1f;
  let p = pos + 1;

  // The width check must precede the reads — reading past the end yields `undefined`, and a
  // non-null assertion on it silently produces NaN rather than throwing.
  const argWidth = ai < 24 ? 0 : ai === 24 ? 1 : ai === 25 ? 2 : ai === 26 ? 4 : -1;
  if (argWidth < 0) {
    throw new CoseError(
      ai === 27 ? "64-bit CBOR lengths are not used by WebAuthn"
                : `unsupported CBOR additional info ${ai}`,
    );
  }
  if (p + argWidth > b.length) throw new CoseError("truncated CBOR header");

  let arg = ai;
  if (argWidth === 1) arg = b[p]!;
  else if (argWidth === 2) arg = (b[p]! << 8) | b[p + 1]!;
  else if (argWidth === 4) arg = ((b[p]! << 24) >>> 0) + (b[p + 1]! << 16) + (b[p + 2]! << 8) + b[p + 3]!;
  p += argWidth;

  switch (major) {
    case 0: return { value: arg, next: p };
    case 1: return { value: -1 - arg, next: p };
    case 2: {
      const end = p + arg;
      if (end > b.length) throw new CoseError("truncated CBOR byte string");
      return { value: b.slice(p, end), next: end };
    }
    case 3: {
      const end = p + arg;
      if (end > b.length) throw new CoseError("truncated CBOR text string");
      return { value: new TextDecoder().decode(b.slice(p, end)), next: end };
    }
    case 4: {
      const arr: Cbor[] = [];
      for (let i = 0; i < arg; i++) { const r = decodeItem(b, p, depth + 1); arr.push(r.value); p = r.next; }
      return { value: arr, next: p };
    }
    case 5: {
      const map = new Map<Cbor, Cbor>();
      for (let i = 0; i < arg; i++) {
        const k = decodeItem(b, p, depth + 1); const v = decodeItem(b, k.next, depth + 1);
        map.set(k.value, v.value); p = v.next;
      }
      return { value: map, next: p };
    }
    case 6: return decodeItem(b, p, depth + 1); // tag — WebAuthn does not use them meaningfully; unwrap
    case 7:
      if (ai === 20) return { value: false, next: p };
      if (ai === 21) return { value: true, next: p };
      if (ai === 22) return { value: null, next: p };
      throw new CoseError(`unsupported CBOR simple value ${ai}`);
    default: throw new CoseError(`unsupported CBOR major type ${major}`);
  }
}

// ---------------------------------------------------------------- errors

export class CoseError extends Error {
  constructor(message: string) { super(message); this.name = "CoseError"; }
}

// ---------------------------------------------------------------- COSE → SPKI

/** ASN.1 prefix for an uncompressed P-256 SubjectPublicKeyInfo. The remaining 65 bytes are
 *  `0x04 || x || y`, so a complete P-256 SPKI is always exactly 91 bytes. */
const P256_SPKI_PREFIX = new Uint8Array([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
  0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
]);

const COSE_KTY = 1, COSE_ALG = 3, COSE_CRV = -1, COSE_X = -2, COSE_Y = -3;
const KTY_EC2 = 2, ALG_ES256 = -7, CRV_P256 = 1;

/** Converts a COSE_Key (as it appears in attested credential data) to DER SPKI —
 *  byte-for-byte what a browser's `getPublicKey()` would have returned. */
export function coseKeyToSpki(coseKey: Uint8Array): Uint8Array {
  const { value, next } = decodeItem(coseKey, 0);
  if (!(value instanceof Map)) throw new CoseError("COSE key is not a CBOR map");
  if (next !== coseKey.length) {
    throw new CoseError(`COSE key has ${coseKey.length - next} trailing bytes`);
  }

  const kty = value.get(COSE_KTY), alg = value.get(COSE_ALG), crv = value.get(COSE_CRV);
  if (kty !== KTY_EC2) throw new CoseError(`unsupported COSE kty ${String(kty)} — expected EC2 (2)`);
  if (alg !== ALG_ES256) throw new CoseError(`unsupported COSE alg ${String(alg)} — expected ES256 (-7)`);
  if (crv !== CRV_P256) throw new CoseError(`unsupported COSE crv ${String(crv)} — expected P-256 (1)`);

  const x = value.get(COSE_X), y = value.get(COSE_Y);
  if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array))
    throw new CoseError("COSE key is missing x or y");
  if (x.length !== 32 || y.length !== 32)
    throw new CoseError(`COSE coordinates must be 32 bytes, got x=${x.length} y=${y.length}`);

  const spki = new Uint8Array(P256_SPKI_PREFIX.length + 1 + 64);
  spki.set(P256_SPKI_PREFIX, 0);
  spki[P256_SPKI_PREFIX.length] = 0x04; // uncompressed point
  spki.set(x, P256_SPKI_PREFIX.length + 1);
  spki.set(y, P256_SPKI_PREFIX.length + 33);
  return spki;
}

// ---------------------------------------------------------------- authData

export interface AttestedCredential {
  readonly aaguid: Uint8Array;
  readonly credentialId: Uint8Array;
  /** DER SPKI — hand this to Circle as `response.getPublicKey()`. */
  readonly publicKeySpki: Uint8Array;
  /** The raw authenticator data. Distinct from the attestation object that contains it —
   *  `response.getAuthenticatorData()` must return this, not its envelope. */
  readonly authenticatorData: Uint8Array;
}

const FLAG_AT = 0x40; // attested credential data included

// authData layout: rpIdHash(32) | flags(1) | signCount(4) | [ aaguid(16) | credIdLen(2) | … ]
const RP_ID_HASH_BYTES = 32;
const FLAGS_OFFSET = RP_ID_HASH_BYTES;
const SIGN_COUNT_BYTES = 4;
const HEADER_BYTES = RP_ID_HASH_BYTES + 1 + SIGN_COUNT_BYTES;
const AAGUID_BYTES = 16;
const CRED_ID_LENGTH_BYTES = 2;

/** Parses authenticator data and extracts the attested credential. */
export function parseAuthData(authData: Uint8Array): AttestedCredential {
  if (authData.length < HEADER_BYTES) throw new CoseError(`authData too short: ${authData.length}`);
  const flags = authData[FLAGS_OFFSET]!;
  if ((flags & FLAG_AT) === 0) throw new CoseError("authData has no attested credential data (AT flag unset)");

  let p = HEADER_BYTES;
  if (authData.length < p + AAGUID_BYTES + CRED_ID_LENGTH_BYTES) {
    throw new CoseError("authData truncated before credential id");
  }
  const aaguid = authData.slice(p, p + AAGUID_BYTES); p += AAGUID_BYTES;
  const credIdLen = (authData[p]! << 8) | authData[p + 1]!; p += CRED_ID_LENGTH_BYTES;
  if (authData.length < p + credIdLen) throw new CoseError("authData truncated inside credential id");
  const credentialId = authData.slice(p, p + credIdLen); p += credIdLen;

  // The COSE key carries no length prefix — decoding it is how we learn where it ends.
  const { next } = decodeItem(authData, p);
  return {
    aaguid,
    credentialId,
    publicKeySpki: coseKeyToSpki(authData.slice(p, next)),
    authenticatorData: authData,
  };
}

// ---------------------------------------------------------------- entry point

/** Parses a raw attestation object and returns the attested credential.
 *  This is the whole reason this module exists — see the file header. */
export function parseAttestationObject(attestationObject: Uint8Array): AttestedCredential {
  const { value, next } = decodeItem(attestationObject, 0);
  if (!(value instanceof Map)) throw new CoseError("attestationObject is not a CBOR map");
  // The same strictness `coseKeyToSpki` applies. Trailing bytes mean the input is not what it
  // claims to be, and accepting them here while rejecting them there is an inconsistency.
  if (next !== attestationObject.length) {
    throw new CoseError(`attestationObject has ${attestationObject.length - next} trailing bytes`);
  }
  const authData = value.get("authData");
  if (!(authData instanceof Uint8Array)) throw new CoseError("attestationObject has no authData");
  return parseAuthData(authData);
}
