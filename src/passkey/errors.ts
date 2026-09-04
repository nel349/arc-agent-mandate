/** Raised by every part of the passkey shim, so one catch covers the whole boundary. */
export class PasskeyShimError extends Error {
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options);
    this.name = "PasskeyShimError";
  }
}
