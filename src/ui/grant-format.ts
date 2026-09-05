import type { Usdc } from "../arc/usdc.ts";

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
 * Hoisted: building a formatter costs real time, and these are rebuilt on every keystroke
 * otherwise.
 *
 * Two of them, because a custom window can run past December. "Sep 11" is the right amount of
 * detail for next week and genuinely ambiguous a year out, and a date that says the wrong year to
 * someone authorising money is worse than a slightly longer one.
 */
const WHEN = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const WHEN_WITH_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Only spell the year out when it is not the year the person is reading this in. */
function formatExpiry(until: Date, now: number): string {
  return until.getFullYear() === new Date(now).getFullYear()
    ? WHEN.format(until)
    : WHEN_WITH_YEAR.format(until);
}

/** The date an allowance lapses, or `null` when it is open-ended. */
export function expiryDate(days: number | null, now: number = Date.now()): Date | null {
  if (days === null || !Number.isFinite(days) || days <= 0) return null;
  return new Date(now + Math.round(days * 86_400_000));
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
    `Nothing is transferred to the agent — it can only draw on this allowance, and you can take ` +
    `it back at any time.`
  );
}
