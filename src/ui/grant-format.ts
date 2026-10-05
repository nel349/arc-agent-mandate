import type { NetworkProfile } from "@kuiralabs/mandate-core";
import type { Address } from "viem";
import type { Amount } from "../arc/amount.ts";
import type { AllowanceFace } from "./AllowanceCard.tsx";
import { inCoin } from "./coin.ts";
import { dayMonth, weekdayDayMonth } from "./calendar.ts";

/**
 * Saying, in one sentence, what is about to be authorised.
 *
 * The form used to ask for three values and then hand them straight to a signature, so the last
 * thing a person read before granting an agent money was a number pad. The expiry was a count of
 * days rather than a date, and for a while the grant also sent the agent half a dollar that the
 * screen never mentioned. Both are gone: the date is spelled out, and nothing is transferred to
 * the agent at all — which the sentence now says, because "an allowance is authority, not a
 * balance" is the claim the whole product rests on.
 *
 * Pure and separate from the screen so the wording can be tested without a renderer, and so the
 * SDK never decides how something reads to a person.
 */

/**
 * The date in the same form as every other date on screen, "17 Sep", with the year added only when
 * it is not this one.
 *
 * It used to be `Intl`'s "Sep 17" while the list and the agent's screen said "17 Sep", so one
 * allowance was described two ways a tap apart. The year still matters: a custom window can run
 * past December, and a date that says the wrong year to someone authorising money is worse than a
 * slightly longer one.
 */
export function formatExpiry(until: Date, now: number): string {
  const day = dayMonth(Math.floor(until.getTime() / 1000));
  return until.getFullYear() === new Date(now).getFullYear() ? day : `${day} ${until.getFullYear()}`;
}

/** The date an allowance lapses, or `null` when it is open-ended. */
export function expiryDate(days: number | null, now: number = Date.now()): Date | null {
  if (days === null || !Number.isFinite(days) || days <= 0) return null;
  return new Date(now + Math.round(days * 86_400_000));
}

/**
 * What a window of days means on the calendar, beside each choice: "Ends Thu 17 Sep".
 *
 * People hold an allowance's length as a day it stops rather than a count, so each row says the
 * day. The date is the phone's own, like every other date on screen.
 */
export function windowEndLabel(days: number, now: number = Date.now()): string {
  const until = expiryDate(days, now);
  return until === null ? "No end date" : `Ends ${weekdayDayMonth(Math.floor(until.getTime() / 1000))}`;
}

/**
 * Whether an allowance is larger than what the wallet holds right now.
 *
 * Not refused. An allowance is authority, not money set aside, and the wallet may be topped up
 * later. But an agent can only spend what is actually there when it pays, so a limit above the
 * balance is worth saying out loud before it is granted rather than discovered as a refusal.
 */
export function exceedsWallet(limit: Amount, balance: Amount | null): boolean {
  return balance !== null && limit.compare(balance) > 0;
}

/** The confirmation once it has landed, naming who, how much and until when. */
export function grantedSentence(
  { who, limit, days, network, now = Date.now() }: {
    readonly who: string; readonly limit: Amount; readonly days: number; readonly network: NetworkProfile; readonly now?: number;
  },
): string {
  const until = expiryDate(days, now);
  const window = until === null ? "with no end date" : `until ${formatExpiry(until, now)}`;
  return `${who} can now spend up to ${inCoin(limit, network)} ${window}. Nothing has left your wallet yet.`;
}

export function grantSummary({
  limit, days, network, now = Date.now(),
}: {
  readonly limit: Amount;
  readonly days: number | null;
  readonly network: NetworkProfile;
  readonly now?: number;
}): string {
  const until = expiryDate(days, now);
  const window = until === null ? "with no expiry date" : `until ${formatExpiry(until, now)}`;
  return (
    `This agent can spend up to ${inCoin(limit, network)} ${window}, and nothing beyond it. ` +
    `Nothing is transferred to the agent. It can only draw on this allowance, and you can take ` +
    `it back at any time.`
  );
}

/** The amounts offered under the limit being typed, as the strings the field edits. */
const DOLLAR_PRESETS: readonly string[] = ["5", "20", "100"];
/** Test MON comes from a faucet a little at a time, so the presets are tenths and hundredths of it. */
const COIN_PRESETS: readonly string[] = ["0.01", "0.05", "0.1"];

/** The preset limits for a network's coin: dollars on Arc, small amounts of MON on Monad. */
export const amountPresets = (network: NetworkProfile): readonly string[] => (network.coin.dollar ? DOLLAR_PRESETS : COIN_PRESETS);

/**
 * Said under the card, once, and nothing the card already prints: what an allowance is, and is not.
 */
export const CARD_TERMS =
  "Nothing is sent to the agent. It can only draw on this, never more, and you can take it back at any time.";

/** What a card being issued prints, from the answers and whatever the agent's code asked for. */
export function faceOf({
  terms, name, askedBy, payees, calls = [], network, now = Date.now(),
}: {
  readonly terms: { readonly agent: Address; readonly limit: Amount; readonly days: number };
  readonly name: string | null;
  readonly askedBy: string | null;
  readonly payees: readonly Address[];
  readonly calls?: AllowanceFace["calls"];
  readonly network: NetworkProfile;
  readonly now?: number;
}): AllowanceFace {
  const until = expiryDate(terms.days, now);
  return {
    network,
    limit: terms.limit,
    agent: terms.agent,
    name,
    ends: until === null ? null : formatExpiry(until, now),
    askedBy,
    payees,
    calls,
    spoken: grantSummary({ limit: terms.limit, days: terms.days, network, now }),
  };
}
