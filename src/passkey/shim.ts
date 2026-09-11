import { Platform } from "react-native";
import { arcPasskey } from "@passkey-native";
import { anyToBase64url, fromBase64url, toArrayBuffer, toBase64url } from "./base64url.ts";
import { parseAttestationObject } from "./cose.ts";
import { captureDeviceVector } from "./vector-capture.ts";
import { installSubtleShim } from "./subtle.ts";
import { PasskeyShimError } from "./errors.ts";
import {
  ASSERTION_FIELDS,
  parseNativeJson,
  REGISTRATION_FIELDS,
  type NativeAssertionJson,
  type NativeRegistrationJson,
} from "./native-json.ts";

/**
 * Makes Circle's TypeScript SDK work on React Native.
 *
 * `@circle-fin/modular-wallets-core` reaches for `window.navigator.credentials` and binds
 * `.create` / `.get` at call time — a global lookup, which is what makes this possible at all.
 * It then calls `credential.response.getPublicKey()`, a DOM method that exists only in a
 * browser. So we synthesise a credential whose `getPublicKey()` returns real SPKI, produced by
 * our own ceremony and the parser in `cose.ts`.
 *
 * Install once, before constructing any Circle client.
 */

const CREDENTIAL_TYPE = "public-key" as const;
const PLATFORM_ATTACHMENT = "platform" as const;
const ES256 = -7;

interface AttestationResponse {
  readonly clientDataJSON: ArrayBuffer;
  readonly attestationObject: ArrayBuffer;
  getPublicKey(): ArrayBuffer;
  getPublicKeyAlgorithm(): number;
  getAuthenticatorData(): ArrayBuffer;
  getTransports(): string[];
}

interface AssertionResponse {
  readonly clientDataJSON: ArrayBuffer;
  readonly authenticatorData: ArrayBuffer;
  readonly signature: ArrayBuffer;
  readonly userHandle: ArrayBuffer | null;
}

interface SynthesisedCredential<R> {
  readonly id: string;
  readonly rawId: ArrayBuffer;
  readonly type: typeof CREDENTIAL_TYPE;
  readonly authenticatorAttachment: typeof PLATFORM_ATTACHMENT;
  readonly response: R;
  getClientExtensionResults(): Record<string, never>;
  /** See `synthesise` — this is what actually reaches Circle's relying party. */
  toJSON(): Record<string, unknown>;
}

/**
 * Builds the credential object Circle's SDK expects, and — critically — the JSON its relying
 * party expects.
 *
 * Circle forwards the credential **raw**: `client.request({ method: "rp_getRegistrationVerification",
 * params: [credential] })`. In a browser that works because `PublicKeyCredential` implements
 * `toJSON()` (WebAuthn Level 3), which `JSON.stringify` calls automatically, producing base64url
 * strings.
 *
 * A synthesised object has no such method, so its `ArrayBuffer`s serialise as `{}` and its
 * methods vanish — the RP receives a shape it cannot read and answers "API parameter invalid",
 * naming nothing. `toJSON` below is therefore not a convenience: it is the actual wire format,
 * and `wireJson` is the only part of this object the relying party ever sees.
 */
function synthesise<R>(
  credentialId: string,
  response: R,
  wireJson: Record<string, unknown>,
): SynthesisedCredential<R> {
  return {
    id: credentialId,
    rawId: toArrayBuffer(fromBase64url(credentialId)),
    type: CREDENTIAL_TYPE,
    authenticatorAttachment: PLATFORM_ATTACHMENT,
    response,
    getClientExtensionResults: () => ({}),
    toJSON: () => ({
      id: credentialId,
      rawId: credentialId,
      type: CREDENTIAL_TYPE,
      authenticatorAttachment: PLATFORM_ATTACHMENT,
      clientExtensionResults: {},
      response: wireJson,
    }),
  };
}

async function create(
  options: { publicKey: PublicKeyCredentialCreationOptions },
): Promise<SynthesisedCredential<AttestationResponse>> {
  const publicKey = options.publicKey;
  const rpId = publicKey.rp?.id;
  if (!rpId) throw new PasskeyShimError("registration options carry no rp.id — Circle's RP supplies it");

  const challenge = anyToBase64url(publicKey.challenge);
  const userId = anyToBase64url(publicKey.user.id);
  // Descriptor ids are `BufferSource`, which `JSON.stringify` renders as an index-keyed object
  // ({"0":9,"1":9}) rather than base64url, so spreading the options unconverted hands Credential
  // Manager an id it cannot read. `get()` already converts `allowCredentials`; this is the same
  // obligation on the registration side. It is not cosmetic: `excludeCredentials` is what stops a
  // second passkey being created for a user who already has one on this device.
  const excludedCredentialIds = (publicKey.excludeCredentials ?? []).map((c) => anyToBase64url(c.id));

  let credentialId: string;
  let attestationObjectB64: string;
  let clientDataJSONB64: string;

  if (Platform.OS === "android") {
    // Credential Manager speaks WebAuthn JSON natively; hand it the options as-is.
    const json = parseNativeJson<NativeRegistrationJson>(
      await arcPasskey.registerJson(
        JSON.stringify({
          ...publicKey,
          challenge,
          user: { ...publicKey.user, id: userId },
          excludeCredentials: excludedCredentialIds.map((id) => ({ id, type: CREDENTIAL_TYPE })),
        }),
      ),
      "registration",
      REGISTRATION_FIELDS,
    );
    credentialId = json.id;
    attestationObjectB64 = json.response.attestationObject;
    clientDataJSONB64 = json.response.clientDataJSON;
  } else {
    const native = await arcPasskey.register(
      rpId, challenge, userId, publicKey.user.name ?? "", excludedCredentialIds,
    );
    credentialId = native.credentialId;
    attestationObjectB64 = native.attestationObject;
    clientDataJSONB64 = native.clientDataJSON;
  }

  // Before parsing, so a vector is still printed when parsing is what fails — which is exactly
  // the run whose input we most want to keep.
  captureDeviceVector(attestationObjectB64);

  const attestationObject = fromBase64url(attestationObjectB64);
  // The piece a browser would have done for us — parsed once, reused below.
  const attested = parseAttestationObject(attestationObject);

  return synthesise<AttestationResponse>(
    credentialId,
    {
      clientDataJSON: toArrayBuffer(fromBase64url(clientDataJSONB64)),
      attestationObject: toArrayBuffer(attestationObject),
      getPublicKey: () => toArrayBuffer(attested.publicKeySpki),
      getPublicKeyAlgorithm: () => ES256,
      // The authenticator data itself, not the attestation object that envelopes it.
      getAuthenticatorData: () => toArrayBuffer(attested.authenticatorData),
      getTransports: () => ["internal"],
    },
    {
      clientDataJSON: clientDataJSONB64,
      attestationObject: attestationObjectB64,
      transports: ["internal"],
      publicKey: toBase64url(attested.publicKeySpki),
      publicKeyAlgorithm: ES256,
      authenticatorData: toBase64url(attested.authenticatorData),
    },
  );
}

/**
 * Whether the sign-in in progress is iOS's returning-user request.
 *
 * Circle builds the request options itself and passes nothing of ours through to `get`, so there
 * is no field to carry this in. It is set only inside `withReturningUserSignIn`, for the length of
 * one call, and read in exactly one place below.
 */
let returningUserOnly = false;

/** True when this build can ask iOS for its returning-user sheet. False on Android and on older builds. */
export function canOfferExistingPasskey(): boolean {
  return Platform.OS === "ios" && typeof arcPasskey.authenticateImmediately === "function";
}

/**
 * Runs one sign-in as iOS's returning-user request.
 *
 * The passkey sheet appears only if a passkey for this app is already on the phone; if there is
 * none, the sign-in fails at once without showing anything. That is what lets the app offer an
 * existing passkey the moment it opens after a reinstall, and never put an empty prompt in front
 * of somebody who has not made one.
 */
export async function withReturningUserSignIn<T>(work: () => Promise<T>): Promise<T> {
  if (!canOfferExistingPasskey()) {
    throw new PasskeyShimError("this build cannot ask for an existing passkey without showing the full sheet");
  }
  returningUserOnly = true;
  try {
    return await work();
  } finally {
    returningUserOnly = false;
  }
}

async function get(
  options: { publicKey: PublicKeyCredentialRequestOptions },
): Promise<SynthesisedCredential<AssertionResponse>> {
  const publicKey = options.publicKey;
  const rpId = publicKey.rpId;
  if (!rpId) throw new PasskeyShimError("assertion options carry no rpId — Circle's RP supplies it");

  const challenge = anyToBase64url(publicKey.challenge);
  const allowedCredentialIds = (publicKey.allowCredentials ?? []).map((c) => anyToBase64url(c.id));

  let credentialId: string;
  let authenticatorDataB64: string;
  let clientDataJSONB64: string;
  let signatureB64: string;
  let userHandleB64: string;

  if (Platform.OS === "android") {
    const json = parseNativeJson<NativeAssertionJson>(
      await arcPasskey.authenticateJson(
        JSON.stringify({
          ...publicKey,
          challenge,
          allowCredentials: allowedCredentialIds.map((id) => ({ id, type: CREDENTIAL_TYPE })),
        }),
      ),
      "authentication",
      ASSERTION_FIELDS,
    );
    credentialId = json.id;
    authenticatorDataB64 = json.response.authenticatorData;
    clientDataJSONB64 = json.response.clientDataJSON;
    signatureB64 = json.response.signature;
    userHandleB64 = json.response.userHandle ?? "";
  } else {
    const native = returningUserOnly && arcPasskey.authenticateImmediately !== undefined
      ? await arcPasskey.authenticateImmediately(rpId, challenge, allowedCredentialIds)
      : await arcPasskey.authenticate(rpId, challenge, allowedCredentialIds);
    credentialId = native.credentialId;
    authenticatorDataB64 = native.authenticatorData;
    clientDataJSONB64 = native.clientDataJSON;
    signatureB64 = native.signature;
    userHandleB64 = native.userHandle;
  }

  return synthesise<AssertionResponse>(
    credentialId,
    {
      clientDataJSON: toArrayBuffer(fromBase64url(clientDataJSONB64)),
      authenticatorData: toArrayBuffer(fromBase64url(authenticatorDataB64)),
      // DER — `webauthn-p256`'s parseAsn1Signature converts it downstream.
      signature: toArrayBuffer(fromBase64url(signatureB64)),
      userHandle: userHandleB64 ? toArrayBuffer(fromBase64url(userHandleB64)) : null,
    },
    {
      clientDataJSON: clientDataJSONB64,
      authenticatorData: authenticatorDataB64,
      signature: signatureB64,
      userHandle: userHandleB64 || null,
    },
  );
}

/** The subset of `CredentialsContainer` that Circle's SDK actually binds. */
interface WebAuthnCredentialsApi {
  create: typeof create;
  get: typeof get;
}

/**
 * Installs the shim. Idempotent, and deliberately refuses to replace an existing
 * implementation — silently shadowing a real `navigator.credentials` would be worse than
 * failing loudly wherever one already exists.
 *
 * The assertions below are deliberate and are the only ones in this file. TypeScript's DOM lib
 * types `window.navigator` as a full `Navigator` and `credentials` as a full
 * `CredentialsContainer`; React Native has neither at runtime, and Circle's SDK binds exactly
 * two methods off it. Implementing 40-odd unreachable DOM members to satisfy the compiler would
 * be a fiction with more surface than the lie it replaces. So we assert once, here, at the
 * boundary — which is what a boundary is for.
 */
export function installWebAuthnShim(passkeyDomain: string): void {
  // Install at app startup, not lazily on first use: the runtime audit runs before any button
  // is tapped, and a shim that only exists after `connectArcAccount` makes the audit lie.
  const globals = globalThis as unknown as {
    window?: {
      navigator?: { credentials?: WebAuthnCredentialsApi };
      location?: { hostname: string; protocol: string } & Record<string, unknown>;
    };
  };
  globals.window ??= globals as never;
  const nav = (globals.window.navigator ??= {});
  nav.credentials ??= { create, get };

  installAppInfoRewrite(passkeyDomain);
  installSubtleShim();

  // Not cosmetic, and not obvious: Circle derives its `X-AppInfo` identity header from
  // `window?.location?.hostname || "unknown"`, and validates the domain-bound client key
  // against it. Every SDK call carries it, not just WebAuthn ones.
  //
  // This **overwrites** rather than defaults. React Native already defines `window.location`,
  // pointing at the Metro dev server — so a `??=` silently leaves `hostname` as `localhost`
  // and every call is rejected with "Invalid credentials", which names neither the header nor
  // the hostname. Verified directly against Circle's RP: `uri=localhost` and `uri=unknown` are
  // rejected; only the registered passkey domain authenticates.
}

/**
 * Circle stamps every request with `X-AppInfo: platform=web;version=…;uri=<hostname>`, derived
 * from `window?.location?.hostname || "unknown"`, and validates the domain-bound client key
 * against that `uri`. Verified directly against their RP: only the registered passkey domain
 * authenticates — `localhost` and `unknown` are both rejected as "Invalid credentials", an
 * error naming neither the header nor the hostname.
 *
 * React Native points `window.location` at the Metro dev server and locks it: assignment throws
 * `Cannot set "location"`, `Object.defineProperty` is refused, and so is mutating `hostname`.
 * The runtime owns that global, so we stop negotiating with it and correct the header on the
 * way out instead — which is also more honest, since the header is what actually matters.
 *
 * Scoped to Circle's own hosts so nothing else on the network is touched.
 */
function installAppInfoRewrite(passkeyDomain: string): void {
  const globals = globalThis as typeof globalThis & { __arcAppInfoPatched?: boolean };
  if (globals.__arcAppInfoPatched) return;
  globals.__arcAppInfoPatched = true;

  const original = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!isCircleHost(url)) return original(input, init);

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const existing = headers.get("X-AppInfo");
    if (existing) {
      headers.set("X-AppInfo", existing.replace(/uri=[^;]*/, `uri=${passkeyDomain}`));
      return original(input, { ...init, headers });
    }
    return original(input, init);
  };
}

const CIRCLE_DOMAIN = "circle.com";

/**
 * True when the URL's **host** is Circle's, parsed rather than pattern-matched.
 *
 * A substring test over the whole URL is wrong in both directions: it matches
 * `https://attacker.com/?x=//circle.com/`, and it misses `https://api.circle.com`, which has no
 * trailing slash after the host. Only the header's `uri` field is at stake so neither is severe,
 * but a host check is what this means, and `URL` already knows how to do it.
 */
function isCircleHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false; // not a URL we can reason about; leave the request untouched
  }
  return host === CIRCLE_DOMAIN || host.endsWith(`.${CIRCLE_DOMAIN}`);
}

