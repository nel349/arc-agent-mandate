import ExpoModulesCore
import AuthenticationServices
import Security

/// The one OS-deep part of the SDK: the platform passkey ceremony.
///
/// Ported from `kuira-sdk-ios`'s `PasskeySigilForging`, with one substantive change. Kuira uses
/// the passkey as a *derivation source* — it evaluates a PRF salt and throws the credential's
/// public key away (`publicKeyHex: ""`). Circle uses the passkey as a *signer*, so we need the
/// opposite: no PRF, and the attestation object kept so TypeScript can recover the public key.
///
/// Everything above the OS boundary — CBOR, COSE, SPKI, base64url shaping — lives in TypeScript
/// on purpose. This file exists only because `ASAuthorization` and the Keychain cannot be reached
/// from JavaScript.
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
                                 userName: String, excludedCredentialIds: [String],
                                 promise: Promise) in
      guard let challenge = Self.fromBase64url(challengeB64),
            let userId = Self.fromBase64url(userIdB64) else {
        promise.reject(PasskeyError.badInput("challenge or user id is not valid base64url")); return
      }
      Task { @MainActor in
        do {
          let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpId)
          let request = provider.createCredentialRegistrationRequest(
            challenge: challenge, name: userName, userID: userId)
          // What stops a second passkey being created for a user who already has one on this
          // device. ASAuthorization only exposes it from iOS 17.4; this module's floor is 15.1,
          // so below that the exclusion cannot be honoured and the relying party is the only
          // remaining defence. Silently ignoring it on a version that supports it would be the
          // real bug.
          if #available(iOS 17.4, *), !excludedCredentialIds.isEmpty {
            request.excludedCredentials = excludedCredentialIds.compactMap {
              Self.fromBase64url($0).map { ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0) }
            }
          }
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
      self.requestAssertion(rpId: rpId, challengeB64: challengeB64,
                            allowedCredentialIds: allowedCredentialIds,
                            immediatelyAvailableOnly: false, promise: promise)
    }

    /// The returning-user sign-in, for a launch with no wallet remembered, which after a
    /// reinstall is the ordinary case.
    ///
    /// Asks iOS to show the passkey sheet only if a passkey for this relying party is already on
    /// the device, and to fail at once, with no sheet at all, when there is none. So the app can
    /// offer the existing passkey the moment it opens without ever showing an empty prompt to
    /// somebody new. A separate function rather than a flag on `authenticate`, so JavaScript newer
    /// than the build on the phone can tell whether it exists before calling it.
    AsyncFunction("authenticateImmediately") { (rpId: String, challengeB64: String,
                                                allowedCredentialIds: [String], promise: Promise) in
      self.requestAssertion(rpId: rpId, challengeB64: challengeB64,
                            allowedCredentialIds: allowedCredentialIds,
                            immediatelyAvailableOnly: true, promise: promise)
    }

    // The remembered wallet. See `WalletVault` for what it is and why it is here.
    AsyncFunction("saveWalletMemory") { (value: String) throws in
      try WalletVault.save(value)
    }

    AsyncFunction("loadWalletMemory") { () throws -> String? in
      try WalletVault.load()
    }

    AsyncFunction("clearWalletMemory") { () throws in
      try WalletVault.clear()
    }
  }

  /// One assertion ceremony, shared by the ordinary sign-in and the returning-user one.
  private func requestAssertion(rpId: String, challengeB64: String, allowedCredentialIds: [String],
                                immediatelyAvailableOnly: Bool, promise: Promise) {
    guard let challenge = Self.fromBase64url(challengeB64) else {
      promise.reject(PasskeyError.badInput("challenge is not valid base64url")); return
    }
    // Below iOS 16 there is no way to ask for "only if one is already here", and showing the full
    // sheet at launch to somebody who never made a passkey is exactly what this must not do.
    if immediatelyAvailableOnly {
      if #unavailable(iOS 16.0) {
        promise.reject(PasskeyError.unsupported("the returning-user sign-in needs iOS 16 or later")); return
      }
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
        guard let assertion = try await self.run(request, immediatelyAvailableOnly: immediatelyAvailableOnly)
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

  /// Bridges the delegate-based controller to async/await. The coordinator self-retains until a
  /// callback fires, because `ASAuthorizationController` holds its delegate weakly — the same
  /// reason Kuira's `CeremonyCoordinator` does it this way.
  @MainActor
  private func run(_ request: ASAuthorizationRequest,
                   immediatelyAvailableOnly: Bool = false) async throws -> ASAuthorizationCredential {
    let anchor = appContext?.utilities?.currentViewController()?.view.window ?? ASPresentationAnchor()
    return try await withCheckedThrowingContinuation { continuation in
      CeremonyCoordinator(request: request, anchor: anchor,
                          immediatelyAvailableOnly: immediatelyAvailableOnly,
                          continuation: continuation).start()
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
  case unsupported(String)
  case keychain(OSStatus)
}

/// The remembered wallet, kept in the Keychain rather than in the app's own files.
///
/// What is kept is public: the passkey's credential id, its public key and the wallet's address,
/// as one JSON string written by TypeScript. The passkey's private key never leaves the Secure
/// Enclave and is not here, so nothing in this item can sign or spend.
///
/// The Keychain is chosen over the app's storage because it usually outlives the app: its items
/// stay when the app is deleted, so a reinstall on the same phone reopens the wallet with no
/// prompt. **Apple does not promise that**, and has discussed changing it, so a missing item is an
/// ordinary answer: the app then offers the returning-user passkey sign-in instead.
///
/// `AfterFirstUnlock` rather than `WhenUnlocked`: the app may be launched before the screen is
/// unlocked, and the item holds nothing that needs the stricter class. Not `ThisDeviceOnly`,
/// because a restore onto a new phone that carries the same passkey should reopen the same wallet.
private enum WalletVault {
  /// Named once. The app's own identifier, so nothing else reads or overwrites it by accident.
  static let service = "com.kuiralabs.arcmandate.remembered-wallet"
  static let account = "signed-in"

  private static func query() -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
  }

  static func save(_ value: String) throws {
    // Replace rather than update: one item, and a delete of nothing is not an error.
    SecItemDelete(query() as CFDictionary)
    var item = query()
    item[kSecValueData as String] = Data(value.utf8)
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    let status = SecItemAdd(item as CFDictionary, nil)
    guard status == errSecSuccess else { throw PasskeyError.keychain(status) }
  }

  static func load() throws -> String? {
    var request = query()
    request[kSecReturnData as String] = true
    request[kSecMatchLimit as String] = kSecMatchLimitOne
    var found: CFTypeRef?
    let status = SecItemCopyMatching(request as CFDictionary, &found)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = found as? Data else { throw PasskeyError.keychain(status) }
    return String(data: data, encoding: .utf8)
  }

  static func clear() throws {
    let status = SecItemDelete(query() as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { throw PasskeyError.keychain(status) }
  }
}

/// Owns the controller and itself until the ceremony settles.
@MainActor
private final class CeremonyCoordinator: NSObject,
  ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
  private let controller: ASAuthorizationController
  private let anchor: ASPresentationAnchor
  private let immediatelyAvailableOnly: Bool
  private var continuation: CheckedContinuation<ASAuthorizationCredential, Error>?
  private var retain: CeremonyCoordinator?

  init(request: ASAuthorizationRequest, anchor: ASPresentationAnchor, immediatelyAvailableOnly: Bool,
       continuation: CheckedContinuation<ASAuthorizationCredential, Error>) {
    self.controller = ASAuthorizationController(authorizationRequests: [request])
    self.anchor = anchor
    self.immediatelyAvailableOnly = immediatelyAvailableOnly
    self.continuation = continuation
    super.init()
    controller.delegate = self
    controller.presentationContextProvider = self
    self.retain = self
  }

  func start() {
    // `requestAssertion` has already refused the returning-user request below iOS 16.
    if #available(iOS 16.0, *), immediatelyAvailableOnly {
      controller.performRequests(options: .preferImmediatelyAvailableCredentials)
    } else {
      controller.performRequests()
    }
  }

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
