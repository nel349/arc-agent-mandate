package com.arcmandate.passkey

import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * The Android half of the one OS-deep part.
 *
 * Credential Manager already speaks the **WebAuthn JSON serialisation**, so unlike iOS there is
 * nothing to assemble here — the platform hands back `registrationResponseJson` and we pass it
 * straight through. TypeScript normalises the two platforms into one shape.
 *
 * Note that the registration JSON *may* carry `publicKey` under the WebAuthn JSON spec, but it
 * is **optional** — so it is a short-circuit when present and never a guarantee. The SPKI parser
 * in `src/passkey/cose.ts` is the path that always works.
 */
class ArcPasskeyModule : Module() {
  private val scope = CoroutineScope(Dispatchers.Main)

  override fun definition() = ModuleDefinition {
    Name("ArcPasskey")

    AsyncFunction("isSupported") { true }

    // `requestJson` is Circle's registration options, serialised as WebAuthn JSON.
    // We do not construct the challenge, rpId or user — the relying party owns those.
    AsyncFunction("registerJson") { requestJson: String, promise: Promise ->
      val activity = appContext.currentActivity
        ?: return@AsyncFunction promise.reject(NoActivity())
      scope.launch {
        try {
          val response = CredentialManager.create(activity).createCredential(
            activity, CreatePublicKeyCredentialRequest(requestJson)
          ) as CreatePublicKeyCredentialResponse
          promise.resolve(response.registrationResponseJson)
        } catch (e: Throwable) {
          promise.reject(CeremonyFailed(e.message ?: "createCredential failed"))
        }
      }
    }

    AsyncFunction("authenticateJson") { requestJson: String, promise: Promise ->
      val activity = appContext.currentActivity
        ?: return@AsyncFunction promise.reject(NoActivity())
      scope.launch {
        try {
          val response = CredentialManager.create(activity).getCredential(
            activity,
            GetCredentialRequest(listOf(GetPublicKeyCredentialOption(requestJson)))
          )
          val credential = response.credential as? PublicKeyCredential
            ?: return@launch promise.reject(UnexpectedCredentialType())
          promise.resolve(credential.authenticationResponseJson)
        } catch (e: Throwable) {
          promise.reject(CeremonyFailed(e.message ?: "getCredential failed"))
        }
      }
    }
  }
}

internal class NoActivity :
  CodedException("ERR_NO_ACTIVITY", "No current Activity — the passkey sheet needs one to present over.", null)

internal class UnexpectedCredentialType :
  CodedException("ERR_CREDENTIAL_TYPE", "Credential Manager returned a non-passkey credential.", null)

internal class CeremonyFailed(message: String) :
  CodedException("ERR_CEREMONY_FAILED", message, null)
