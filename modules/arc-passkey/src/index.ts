import { requireNativeModule } from "expo-modules-core";

/** Raw output of the iOS ceremony. Android returns WebAuthn JSON instead — see below. */
export interface NativeRegistration {
  readonly credentialId: string;      // base64url
  readonly attestationObject: string; // base64url — CBOR, unparsed on purpose
  readonly clientDataJSON: string;    // base64url
}

export interface NativeAssertion {
  readonly credentialId: string;
  readonly authenticatorData: string;
  readonly clientDataJSON: string;
  readonly signature: string;         // DER; webauthn-p256's parseAsn1Signature converts it
  readonly userHandle: string;
}

/**
 * The two platforms are deliberately asymmetric.
 *
 * iOS assembles fields because `ASAuthorization` returns typed objects. Android already speaks
 * the WebAuthn JSON serialisation, so passing the JSON straight through is both less code and
 * less to get wrong. Normalisation happens one level up, in TypeScript, never in native.
 */
export interface ArcPasskeyNative {
  isSupported(): Promise<boolean>;
  register(rpId: string, challenge: string, userId: string, userName: string): Promise<NativeRegistration>;
  authenticate(rpId: string, challenge: string, allowedCredentialIds: string[]): Promise<NativeAssertion>;
  registerJson(requestJson: string): Promise<string>;
  authenticateJson(requestJson: string): Promise<string>;
}

/** Named rather than default: a default export on a non-component costs the consumer the
 *  ability to rely on a stable identifier, and hides the symbol from auto-import. */
export const arcPasskey = requireNativeModule<ArcPasskeyNative>("ArcPasskey");
