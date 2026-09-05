# Captured authenticator vectors

Real `attestationObject` values, one file per platform and OS version, produced by a device run
rather than written by hand.

Everything in `../cose.test.ts` is synthesised by that file's own CBOR encoder. Those tests are
sound — they check our parser against Node's WebCrypto and against `webauthn-p256` rather than
against itself — but they can only cover shapes we thought of. They cannot tell us how a real
Secure Enclave or a real Credential Manager fills in `aaguid`, what it puts in `attStmt`, or
whether it appends extension data after the COSE key.

## Capturing one

1. `npx expo run:ios --device` (or `--device` on Android).
2. Settings → Developer harness → **1 · Register NEW passkey + account**.
3. A line beginning `ARC_PASSKEY_VECTOR` appears in the terminal running Metro.
4. `node scripts/save-vector.mjs '<paste the line>'`

`cose.device.test.ts` picks up whatever lands here — no registration step, no import to update.

## Why these are safe to commit

An attestation object holds a public key, a credential id and an authenticator id. No private
key ever leaves the device, and nothing here can authorise anything. They are inputs to a
parser, which is exactly what a test needs.
