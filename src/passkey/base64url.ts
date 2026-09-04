/**
 * WebAuthn's wire encoding. Circle hands us `Uint8Array`s and expects them back; the native
 * modules speak base64url. This module is the only place that conversion happens.
 *
 * Implemented directly rather than over `btoa`/`atob`, because **React Native declares
 * neither** — they are absent from `@react-native/js-polyfills`, from `Libraries/`, and from
 * RN's type declarations. Hermes may expose them at engine level, but that is undeclared and
 * differs on JSC. base64url also is not base64, so building on `btoa` would mean a second
 * transformation pass anyway.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Reverse lookup, built once. Index is a char code; -1 means "not a base64url character". */
const DECODE_TABLE: readonly number[] = (() => {
  const table = new Array<number>(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

export function toBase64url(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! +
           ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!;
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const n = bytes[i]! << 16;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
  } else if (remaining === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]!;
  }
  return out; // unpadded, per the WebAuthn JSON serialisation
}

export class Base64UrlError extends Error {
  constructor(message: string) { super(message); this.name = "Base64UrlError"; }
}

export function fromBase64url(text: string): Uint8Array {
  const quads = text.length >> 2;
  const tail = text.length & 3;
  if (tail === 1) throw new Base64UrlError(`invalid base64url length ${text.length}`);

  const out = new Uint8Array(quads * 3 + (tail === 0 ? 0 : tail - 1));
  let o = 0;

  const sextet = (index: number): number => {
    const code = text.charCodeAt(index);
    const value = code < 128 ? DECODE_TABLE[code]! : -1;
    if (value < 0) throw new Base64UrlError(`invalid base64url character at ${index}`);
    return value;
  };

  let i = 0;
  for (; i + 3 < text.length; i += 4) {
    const n = (sextet(i) << 18) | (sextet(i + 1) << 12) | (sextet(i + 2) << 6) | sextet(i + 3);
    out[o++] = (n >> 16) & 0xff; out[o++] = (n >> 8) & 0xff; out[o++] = n & 0xff;
  }
  if (tail === 2) {
    out[o++] = ((sextet(i) << 2) | (sextet(i + 1) >> 4)) & 0xff;
  } else if (tail === 3) {
    const n = (sextet(i) << 12) | (sextet(i + 1) << 6) | sextet(i + 2);
    out[o++] = (n >> 10) & 0xff; out[o++] = (n >> 2) & 0xff;
  }
  return out;
}

/** Circle passes `challenge` and `user.id` as `Uint8Array`, `ArrayBuffer`, or an already-encoded
 *  string depending on where the options came from. Accept all three rather than guessing. */
export function anyToBase64url(value: BufferSource | string): string {
  if (typeof value === "string") return value;
  return toBase64url(
    ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : new Uint8Array(value),
  );
}

/** A detached copy as an `ArrayBuffer` — what the DOM credential API hands callers. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
