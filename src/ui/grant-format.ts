import type { Usdc } from "../arc/usdc.ts";
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
function formatExpiry(until: Date, now: number): string {
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
export function exceedsWallet(limit: Usdc, balance: Usdc | null): boolean {
  return balance !== null && limit.compare(balance) > 0;
}

/** The confirmation once it has landed, naming who, how much and until when. */
export function grantedSentence(
  { who, limit, days, now = Date.now() }: { readonly who: string; readonly limit: Usdc; readonly days: number; readonly now?: number },
): string {
  const until = expiryDate(days, now);
  const window = until === null ? "with no end date" : `until ${formatExpiry(until, now)}`;
  return `${who} can now spend up to ${limit.format(2)} USDC ${window}. Nothing has left your wallet yet.`;
}

export function grantSummary({
  limit, days, now = Date.now(),
}: {
  readonly limit: Usdc;
  readonly days: number | null;
  readonly now?: number;
}): string {
  const until = expiryDate(days, now);
  const window = until === null ? "with no expiry date" : `until ${formatExpiry(until, now)}`;
  return (
    `This agent can spend up to ${limit.format(2)} USDC ${window}, and nothing beyond it. ` +
    `Nothing is transferred to the agent. It can only draw on this allowance, and you can take ` +
    `it back at any time.`
  );
}
