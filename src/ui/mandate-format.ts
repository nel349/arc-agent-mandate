import type { Mandate } from "../arc/mandate.ts";
import type { Usdc } from "../arc/usdc.ts";

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

/**
 * Below this, an agent's balance is not worth telling anyone about. 0.005 USDC, in native units.
 *
 * Returning a balance costs gas, and a transfer to a smart account runs its `receive`, so the
 * floor is a few tenths of a cent rather than nothing. An amount smaller than the cost of moving
 * it cannot be acted on, so a warning about it is an alarm with no available response — which is
 * how alarms stop being read.
 *
 * Written as plain units rather than `Usdc.parse(...)` because this is module scope. Calling into
 * another module while this one is being evaluated is an ordering hazard, and under Fast Refresh
 * it is a live crash: a hot-swapped module re-runs before its imports are rebound, and the app
 * dies with `Property 'Usdc' doesn't exist` pointing at a perfectly good import. A literal cannot
 * do that.
 */
const WORTH_MENTIONING_UNITS = 5_000_000_000_000_000n;
/** 0.01 USDC. Below it, two decimal places would round the figure away to "0.00". */
const FINER_PRECISION_BELOW_UNITS = 10_000_000_000_000_000n;

/**
 * What to say about an agent holding money, or `null` when there is nothing to say.
 *
 * Nothing is transferred to an agent: it hands its operations to a bundler and the paymaster
 * covers them, so an allowance is authority and never a balance. A non-zero holding is therefore
 * an anomaly — left over from when grants sent a submission float, or sent by hand — and worth
 * surfacing rather than leaving for someone to notice as a wallet that shrank.
 *
 * Two decimals is the wrong precision for it. Dust of 0.000265 renders as "0.00", so the card
 * warned about nothing at all, which is worse than staying quiet.
 */
export function agentHoldingNote(held: Usdc): string | null {
  const units = held.toNativeUnits();
  if (units < WORTH_MENTIONING_UNITS) return null;
  // Enough places that a small holding is a number rather than a rounded-away zero.
  const shown = units < FINER_PRECISION_BELOW_UNITS ? held.format(4) : held.format(2);
  return `agent holds ${shown}`;
}

/**
 * How much of the allowance is gone, as a percentage beside the bar.
 *
 * The bar alone was not readable. Empty, it looked like a blank box; part-filled, it gave no sense
 * of *how* part-filled, and the figure above it counts the opposite way — that is what is **left**,
 * while the bar fills with what has been **spent**. A number on the bar settles both at a glance.
 *
 * Rounding is not allowed to lie in either direction. A little spending must not read as `0%`, and
 * an allowance with anything left must not read as `100%`; both would say "nothing has happened"
 * or "there is nothing left" when neither is true.
 */
export function spentPercentLabel(mandate: Mandate): string {
  const fraction = fractionUsed(mandate);
  if (fraction <= 0) return "0%";
  if (fraction >= 1) return "100%";
  const percent = Math.round(fraction * 100);
  if (percent === 0) return "<1%";
  if (percent === 100) return ">99%";
  return `${percent}%`;
}
