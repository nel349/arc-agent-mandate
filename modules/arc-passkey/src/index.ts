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
  /** `excludedCredentialIds` are base64url. Applied on iOS 17.4+, where ASAuthorization first
   *  exposed `excludedCredentials`; below that the OS offers no way to honour them. */
  register(
    rpId: string,
    challenge: string,
    userId: string,
    userName: string,
    excludedCredentialIds: string[],
  ): Promise<NativeRegistration>;
  authenticate(rpId: string, challenge: string, allowedCredentialIds: string[]): Promise<NativeAssertion>;
  /**
   * The returning-user sign-in (iOS 16+): shows the passkey sheet only when a passkey for this app
   * is already on the phone, and fails at once, without any sheet, when there is none.
   *
   * This and the three below are optional because the JavaScript can be newer than the build on
   * the phone: a build that predates them does not have them, so callers check before calling.
   */
  authenticateImmediately?(rpId: string, challenge: string, allowedCredentialIds: string[]): Promise<NativeAssertion>;
  /** The remembered wallet, in the iOS Keychain. Public values only; see `src/ui/wallet-memory.ts`. */
  saveWalletMemory?(value: string): Promise<void>;
  loadWalletMemory?(): Promise<string | null>;
  clearWalletMemory?(): Promise<void>;
  registerJson(requestJson: string): Promise<string>;
  authenticateJson(requestJson: string): Promise<string>;
}

/** Named rather than default: a default export on a non-component costs the consumer the
 *  ability to rely on a stable identifier, and hides the symbol from auto-import. */
export const arcPasskey = requireNativeModule<ArcPasskeyNative>("ArcPasskey");
