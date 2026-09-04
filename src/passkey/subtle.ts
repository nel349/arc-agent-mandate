import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";

/**
 * A deliberately minimal `crypto.subtle`.
 *
 * React Native has no SubtleCrypto — `react-native-get-random-values` supplies only
 * `getRandomValues` — so `crypto.subtle` is `undefined` and Circle's SDK dies with
 * `Cannot read property 'importKey' of undefined` while parsing the credential public key.
 *
 * Rather than pull in a full WebCrypto implementation, this covers exactly what the dependency
 * chain uses. Audited across `webauthn-p256` (the only caller), Circle's SDK and viem:
 *
 *     crypto.subtle.digest      ×2
 *     crypto.subtle.importKey   ×1
 *     crypto.subtle.exportKey   ×1
 *
 * and nothing else. The import/export pair is pure format conversion — SPKI in, the
 * uncompressed point out — which is why it can be honest in so little code.
 *
 * **Anything not implemented throws by name.** A shim that silently returns the wrong thing for
 * an unimplemented method would be far worse than one that stops, and this file will be wrong
 * the moment a dependency starts using a fourth method.
 */

/** The ASN.1 header on a P-256 SubjectPublicKeyInfo; the remaining 65 bytes are 0x04 || x || y. */
const P256_SPKI_HEADER_BYTES = 26;
const UNCOMPRESSED_POINT_BYTES = 65;

export class SubtleShimError extends Error {
  constructor(message: string) { super(message); this.name = "SubtleShimError"; }
}

/** An opaque stand-in for `CryptoKey`, holding the uncompressed point. */
interface ShimKey {
  readonly type: "public";
  readonly algorithm: { name: string; namedCurve: string };
  readonly __rawPoint: Uint8Array;
}

function toBytes(data: BufferSource): Uint8Array {
  return ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
}

function algorithmName(algorithm: AlgorithmIdentifier): string {
  return typeof algorithm === "string" ? algorithm : algorithm.name;
}

const subtleShim = {
  async digest(algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> {
    const name = algorithmName(algorithm).toUpperCase();
    const bytes = toBytes(data);
    if (name === "SHA-256") return sha256(bytes).buffer as ArrayBuffer;
    if (name === "SHA-512") return sha512(bytes).buffer as ArrayBuffer;
    throw new SubtleShimError(`digest: ${name} is not implemented by this shim`);
  },

  /**
   * Accepts `spki` or `raw` for P-256 public keys and keeps the uncompressed point.
   *
   * Note what this does **not** do: real `importKey` validates that the point is on the curve
   * and rejects malformed SPKI. This does not. That is acceptable here only because the sole
   * caller is `webauthn-p256` converting a key our own `cose.ts` already parsed and
   * structurally validated — never untrusted input arriving by another route.
   */
  async importKey(
    format: string,
    keyData: BufferSource,
    algorithm: { name: string; namedCurve?: string },
    _extractable: boolean,
    _keyUsages: readonly string[],
  ): Promise<ShimKey> {
    const bytes = toBytes(keyData);
    let point: Uint8Array;

    if (format === "spki") {
      if (bytes.length !== P256_SPKI_HEADER_BYTES + UNCOMPRESSED_POINT_BYTES) {
        throw new SubtleShimError(
          `importKey: expected a ${P256_SPKI_HEADER_BYTES + UNCOMPRESSED_POINT_BYTES}-byte ` +
            `P-256 SPKI, got ${bytes.length}`,
        );
      }
      point = bytes.slice(P256_SPKI_HEADER_BYTES);
    } else if (format === "raw") {
      if (bytes.length !== UNCOMPRESSED_POINT_BYTES) {
        throw new SubtleShimError(`importKey: raw P-256 keys are 65 bytes, got ${bytes.length}`);
      }
      point = bytes;
    } else {
      throw new SubtleShimError(`importKey: format "${format}" is not implemented by this shim`);
    }

    return {
      type: "public",
      algorithm: { name: algorithm.name, namedCurve: algorithm.namedCurve ?? "P-256" },
      __rawPoint: point,
    };
  },

  async exportKey(format: string, key: ShimKey): Promise<ArrayBuffer> {
    if (format !== "raw") {
      throw new SubtleShimError(`exportKey: format "${format}" is not implemented by this shim`);
    }
    const p = key.__rawPoint;
    return p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength) as ArrayBuffer;
  },
};

/** Installs the shim if the runtime has no SubtleCrypto. Never replaces a real one. */
export function installSubtleShim(): void {
  const g = globalThis as typeof globalThis & { crypto?: { subtle?: unknown } };
  if (!g.crypto) throw new SubtleShimError("no global crypto — is react-native-get-random-values imported?");
  if (g.crypto.subtle) return;
  Object.defineProperty(g.crypto, "subtle", { value: subtleShim, configurable: true, writable: true });
}

export const __subtleForTests = subtleShim;
