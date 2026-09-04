import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ASSERTION_FIELDS,
  parseNativeJson,
  REGISTRATION_FIELDS,
  type NativeRegistrationJson,
} from "./native-json.ts";
import { PasskeyShimError } from "./errors.ts";

/**
 * Credential Manager runs in another process, so its output is untrusted input no matter what
 * type is declared over it. Each case here is a shape that would previously have surfaced as a
 * `TypeError` or `SyntaxError` naming neither the ceremony nor the missing field.
 */

const valid = JSON.stringify({
  id: "credential-id",
  response: { attestationObject: "attestation", clientDataJSON: "clientData" },
});

test("a well-formed registration passes through", () => {
  const parsed = parseNativeJson<NativeRegistrationJson>(valid, "registration", REGISTRATION_FIELDS);
  assert.equal(parsed.id, "credential-id");
  assert.equal(parsed.response.attestationObject, "attestation");
});

test("malformed JSON names the ceremony", () => {
  assert.throws(
    () => parseNativeJson(" not json ", "registration", REGISTRATION_FIELDS),
    (e: Error) => e instanceof PasskeyShimError && /malformed JSON for registration/.test(e.message),
  );
});

test("a missing response is a PasskeyShimError, not a TypeError", () => {
  assert.throws(
    () => parseNativeJson(JSON.stringify({ id: "x" }), "registration", REGISTRATION_FIELDS),
    (e: Error) => e instanceof PasskeyShimError && /omitted "response"/.test(e.message),
  );
});

test("a missing field names the field", () => {
  assert.throws(
    () => parseNativeJson(
      JSON.stringify({ id: "x", response: { clientDataJSON: "c" } }),
      "registration",
      REGISTRATION_FIELDS,
    ),
    (e: Error) => e instanceof PasskeyShimError && /response\.attestationObject/.test(e.message),
  );
});

test("a non-string field is rejected as firmly as a missing one", () => {
  assert.throws(
    () => parseNativeJson(
      JSON.stringify({ id: "x", response: { authenticatorData: "a", clientDataJSON: "c", signature: 7 } }),
      "authentication",
      ASSERTION_FIELDS,
    ),
    (e: Error) => e instanceof PasskeyShimError && /response\.signature/.test(e.message),
  );
});

test("JSON null does not slip past the object check", () => {
  assert.throws(
    () => parseNativeJson("null", "authentication", ASSERTION_FIELDS),
    (e: Error) => e instanceof PasskeyShimError && /non-object/.test(e.message),
  );
});
