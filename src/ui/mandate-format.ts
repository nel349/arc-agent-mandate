import type { Mandate } from "../arc/mandate.ts";

/**
 * Turning a mandate into the words on the card.
 *
 * Separate from the screen so it can be tested without a renderer, and separate from `mandate.ts`
 * so the SDK never decides how something reads to a person.
 */

/** `0x68c91fb4…787b17e` — enough to recognise, short enough to sit on one line. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 10)}…${address.slice(-7)}`;
}

/** What a mandate has left, as a fraction between 0 and 1. Zero limit reads as spent. */
export function fractionUsed(mandate: Mandate): number {
  const limit = mandate.limit.toNativeUnits();
  if (limit === 0n) return 1;
  const used = mandate.spent.toNativeUnits();
  if (used >= limit) return 1;
  // Basis points, so the division happens in bigint and only the small result becomes a float.
  return Number((used * 10_000n) / limit) / 10_000;
}

/**
 * When the mandate runs out, in words.
 *
 * An expiry in the past is reported as expired rather than as a negative duration, because a
 * mandate whose window has closed is not "in -3 hours" — it is simply no longer valid.
 */
export function expiryLabel(mandate: Mandate, now: number = Date.now()): string {
  if (mandate.expiresAt === undefined) return "no expiry";
  const seconds = mandate.expiresAt - Math.floor(now / 1000);
  if (seconds <= 0) return "expired";
  const hours = Math.floor(seconds / 3600);
  if (hours < 1) return `${Math.max(1, Math.floor(seconds / 60))} min left`;
  if (hours < 48) return `${hours}h left`;
  return `${Math.floor(hours / 24)} days left`;
}
