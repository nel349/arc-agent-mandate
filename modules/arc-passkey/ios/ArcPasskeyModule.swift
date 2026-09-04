import ExpoModulesCore
import AuthenticationServices

/// The one OS-deep part of the SDK: the platform passkey ceremony.
///
/// Ported from `kuira-sdk-ios`'s `PasskeySigilForging`, with one substantive change. Kuira uses
/// the passkey as a *derivation source* — it evaluates a PRF salt and throws the credential's
/// public key away (`publicKeyHex: ""`). Circle uses the passkey as a *signer*, so we need the
/// opposite: no PRF, and the attestation object kept so TypeScript can recover the public key.
///
/// Everything above the OS boundary — CBOR, COSE, SPKI, base64url shaping — lives in TypeScript
/// on purpose. This file exists only because `ASAuthorization` cannot be reached from JavaScript.
public class ArcPasskeyModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArcPasskey")

    AsyncFunction("isSupported") { () -> Bool in
      // Platform passkeys arrived with ASAuthorizationPlatformPublicKeyCredentialProvider in
      // iOS 15.0, which is below this module's 15.1 floor — so on any device that can run the
      // app, they are available.
      true
    }

    // The challenge, rpId, user id and name all come from Circle's relying party via
    // `getRegistrationOptions`. We do not invent them.
    AsyncFunction("register") { (rpId: String, challengeB64: String, userIdB64: String,
                                 userName: String, promise: Promise) in
      guard let challenge = Self.fromBase64url(challengeB64),
            let userId = Self.fromBase64url(userIdB64) else {
        promise.reject(PasskeyError.badInput("challenge or user id is not valid base64url")); return
      }
      Task { @MainActor in
        do {
          let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpId)
          let request = provider.createCredentialRegistrationRequest(
            challenge: challenge, name: userName, userID: userId)
          guard let reg = try await self.run(request)
                  as? ASAuthorizationPlatformPublicKeyCredentialRegistration else {
            promise.reject(PasskeyError.unexpectedCredentialType); return
          }
          promise.resolve([
            "credentialId": Self.base64url(reg.credentialID),
            // Kept, not parsed. TypeScript turns this into the SPKI Circle expects.
            "attestationObject": Self.base64url(reg.rawAttestationObject ?? Data()),
            "clientDataJSON": Self.base64url(reg.rawClientDataJSON),
          ])
        } catch { promise.reject(error) }
      }
    }

    AsyncFunction("authenticate") { (rpId: String, challengeB64: String,
                                     allowedCredentialIds: [String], promise: Promise) in
      guard let challenge = Self.fromBase64url(challengeB64) else {
        promise.reject(PasskeyError.badInput("challenge is not valid base64url")); return
      }
      Task { @MainActor in
        do {
          let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpId)
          let request = provider.createCredentialAssertionRequest(challenge: challenge)
          // Empty means any discoverable passkey for this rpId — the same choice Kuira makes,
          // and what lets one credential serve the app without being handed its id first.
          if !allowedCredentialIds.isEmpty {
            request.allowedCredentials = allowedCredentialIds.compactMap {
              Self.fromBase64url($0).map { ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0) }
            }
          }
          guard let assertion = try await self.run(request)
                  as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
            promise.reject(PasskeyError.unexpectedCredentialType); return
          }
          promise.resolve([
            "credentialId": Self.base64url(assertion.credentialID),
            "authenticatorData": Self.base64url(assertion.rawAuthenticatorData),
            "clientDataJSON": Self.base64url(assertion.rawClientDataJSON),
            // DER-encoded. `webauthn-p256`'s `parseAsn1Signature` converts it to r/s.
            "signature": Self.base64url(assertion.signature),
            "userHandle": Self.base64url(assertion.userID ?? Data()),
          ])
        } catch { promise.reject(error) }
      }
    }
  }

  /// Bridges the delegate-based controller to async/await. The coordinator self-retains until a
  /// callback fires, because `ASAuthorizationController` holds its delegate weakly — the same
  /// reason Kuira's `CeremonyCoordinator` does it this way.
  @MainActor
  private func run(_ request: ASAuthorizationRequest) async throws -> ASAuthorizationCredential {
    let anchor = appContext?.utilities?.currentViewController()?.view.window ?? ASPresentationAnchor()
    return try await withCheckedThrowingContinuation { continuation in
      CeremonyCoordinator(request: request, anchor: anchor, continuation: continuation).start()
    }
  }

  // MARK: base64url — WebAuthn's wire encoding throughout

  static func base64url(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  static func fromBase64url(_ s: String) -> Data? {
    var b64 = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    if b64.count % 4 != 0 { b64 += String(repeating: "=", count: 4 - b64.count % 4) }
    return Data(base64Encoded: b64)
  }
}

enum PasskeyError: Error {
  case unexpectedCredentialType
  case badInput(String)
}

/// Owns the controller and itself until the ceremony settles.
@MainActor
private final class CeremonyCoordinator: NSObject,
  ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
  private let controller: ASAuthorizationController
  private let anchor: ASPresentationAnchor
  private var continuation: CheckedContinuation<ASAuthorizationCredential, Error>?
  private var retain: CeremonyCoordinator?

  init(request: ASAuthorizationRequest, anchor: ASPresentationAnchor,
       continuation: CheckedContinuation<ASAuthorizationCredential, Error>) {
    self.controller = ASAuthorizationController(authorizationRequests: [request])
    self.anchor = anchor
    self.continuation = continuation
    super.init()
    controller.delegate = self
    controller.presentationContextProvider = self
    self.retain = self
  }

  func start() { controller.performRequests() }

  func authorizationController(controller: ASAuthorizationController,
                               didCompleteWithAuthorization authorization: ASAuthorization) {
    continuation?.resume(returning: authorization.credential); finish()
  }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
    continuation?.resume(throwing: error); finish()
  }

  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor { anchor }

  private func finish() { continuation = nil; retain = nil }
}
