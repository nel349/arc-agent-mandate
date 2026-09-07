import { Platform } from "react-native";
import { VECTOR_TAG } from "./vector-tag.ts";

/**
 * Emitting the one thing a test cannot synthesise: a real authenticator's output.
 *
 * Every fixture in `cose.test.ts` is built by that file's own CBOR encoder. Those tests are
 * honest — they assert against Node's WebCrypto and against `webauthn-p256` rather than against
 * our own parser — but they can only exercise the shapes we thought to write. What they cannot
 * tell us is whether a real Secure Enclave or a real Credential Manager emits an `aaguid` we
 * mishandle, an `attStmt` we did not anticipate, or extension data trailing the COSE key.
 *
 * Capturing that needs a device, and a device run that produces nothing durable is a device run
 * that has to happen again. So registration prints the vector, in development only. Metro
 * forwards device logs to the terminal running `expo start`, which means the string lands on a
 * machine that can save it — `scripts/save-vector.ts` turns the printed line into a fixture that
 * `cose.device.test.ts` picks up automatically.
 */

declare const __DEV__: boolean;

export function captureDeviceVector(attestationObjectB64: string): void {
  // Release builds do not print credential-adjacent material, even material that is public by
  // construction. An attestation object carries a public key and an authenticator id, not a
  // secret — but a log line is the wrong default for anything credential-shaped.
  if (typeof __DEV__ !== "boolean" || !__DEV__) return;

  const vector = {
    platform: Platform.OS,
    osVersion: String(Platform.Version),
    capturedAt: new Date().toISOString(),
    attestationObject: attestationObjectB64,
  };
  console.log(`${VECTOR_TAG} ${JSON.stringify(vector)}`);
}
