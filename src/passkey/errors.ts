/** Raised by every part of the passkey shim, so one catch covers the whole boundary. */
export class PasskeyShimError extends Error {
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options);
    this.name = "PasskeyShimError";
  }
}

/**
 * What the returning-user sign-in says when the phone had no passkey for this app to offer.
 *
 * iOS does not report that as a distinct code. Asked for a credential it can produce without a
 * sheet, it answers `ASAuthorizationError.failed` -- the same code a genuine failure uses -- with
 * the reason only in a localised sentence. So the code cannot tell the two apart, and matching the
 * sentence would work in English and nowhere else.
 *
 * What does tell them apart is which request failed. This marks the speculative one, so the app can
 * pass over an offer nobody asked for while still reporting the identical code from a sign-in
 * somebody chose. Kept here rather than in the shim because the screen that reads it must not pull
 * the native module in to do so.
 */
export const NO_PASSKEY_TO_OFFER = "the phone had no passkey for this app to offer";
