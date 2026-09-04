import { PasskeyShimError } from "./errors.ts";

/**
 * Credential Manager's WebAuthn JSON, checked at the boundary.
 *
 * Separate from `shim.ts` because this is pure: it has no React Native import and no native
 * module, so it can be tested directly rather than through a mock of either.
 */

/** The fields we read out of Credential Manager's registration JSON. */
export interface NativeRegistrationJson {
  readonly id: string;
  readonly response: { readonly attestationObject: string; readonly clientDataJSON: string };
}

/** The fields we read out of Credential Manager's assertion JSON. */
export interface NativeAssertionJson {
  readonly id: string;
  readonly response: {
    readonly authenticatorData: string;
    readonly clientDataJSON: string;
    readonly signature: string;
    readonly userHandle?: string | null;
  };
}

/**
 * Parses Credential Manager's WebAuthn JSON **and checks it**.
 *
 * Declaring a type over `JSON.parse` would only move the lie: the values still arrive from
 * another process at runtime, and a missing `response` would surface as
 * `Cannot read property 'attestationObject' of undefined` — a `TypeError`, so callers catching
 * `PasskeyShimError` would miss it, and nothing in the message names the ceremony. Every field
 * this module reads is therefore checked here, once, where the data crosses the boundary.
 */
export function parseNativeJson<T>(json: string, ceremony: string, fields: readonly string[]): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new PasskeyShimError(`Credential Manager returned malformed JSON for ${ceremony}`, { cause });
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new PasskeyShimError(`Credential Manager returned a non-object for ${ceremony}`);
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.id !== "string") {
    throw new PasskeyShimError(`Credential Manager omitted "id" for ${ceremony}`);
  }
  const response = record.response;
  if (typeof response !== "object" || response === null) {
    throw new PasskeyShimError(`Credential Manager omitted "response" for ${ceremony}`);
  }
  for (const field of fields) {
    if (typeof (response as Record<string, unknown>)[field] !== "string") {
      throw new PasskeyShimError(`Credential Manager omitted "response.${field}" for ${ceremony}`);
    }
  }
  return parsed as T;
}

export const REGISTRATION_FIELDS = ["attestationObject", "clientDataJSON"] as const;
export const ASSERTION_FIELDS = ["authenticatorData", "clientDataJSON", "signature"] as const;
