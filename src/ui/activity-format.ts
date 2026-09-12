import type { Activity, ActivityKind } from "../arc/activity.ts";
import type { Usdc } from "../arc/usdc.ts";
import { clockTime, daysAgo, weekdayDayMonth } from "./calendar.ts";
import { shortAddress } from "./mandate-format.ts";

/**
 * Turning the feed into the words on its rows.
 *
 * Pure and apart from the screens, like `mandate-format.ts`, so the wording can be tested without a
 * renderer and the chain layer never decides how something reads.
 */

/**
 * What each kind of row says it was. One table, so the list and the receipt cannot disagree.
 *
 * A draw is money moved into the agent's escrow, which it pays sellers from later. It used to read
 * "Funded a purchase", which a top-up made ahead of time is not: it has paid nobody yet.
 */
export const ACTIVITY_TITLES: Readonly<Record<ActivityKind, string>> = {
  draw: "Moved to its escrow",
  paid: "Paid someone",
  registered: "Identity registered",
  granted: "Allowance granted",
  revoked: "Allowance revoked",
};

/**
 * An amount at the precision it actually has: at least two places, and as many more as it needs.
 *
 * An agent pays by the step, a tenth of a cent at a time, and two places rounded every one of those
 * down to "0.00", which is a row claiming nothing moved. Six places on everything would be noise
 * the other way. So: "0.001", "0.28", "12.00".
 */
export function formatAmount(amount: Usdc): string {
  const [whole, fraction = ""] = amount.format(6).split(".");
  const trimmed = fraction.replace(/0+$/, "").padEnd(2, "0");
  return `${whole}.${trimmed}`;
}

/** The figure on a row: money leaving the wallet is written with a minus, and nothing else is. */
export function activityAmount(item: Activity): string | null {
  return item.amount === null ? null : `−${formatAmount(item.amount)}`;
}

/** "Today", "Yesterday", or "Wed 9 Sep", over each day's rows. */
export function dayHeading(at: number, now: number = Date.now()): string {
  const days = daysAgo(at, now);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return weekdayDayMonth(at);
}

export interface ActivityDay {
  readonly heading: string;
  readonly items: readonly Activity[];
}

/** Rows under their day, in the order given. The feed is already newest first. */
export function groupByDay(items: readonly Activity[], now: number = Date.now()): readonly ActivityDay[] {
  const days: { heading: string; items: Activity[] }[] = [];
  for (const item of items) {
    const heading = dayHeading(item.at, now);
    const last = days[days.length - 1];
    if (last !== undefined && last.heading === heading) last.items.push(item);
    else days.push({ heading, items: [item] });
  }
  return days;
}

/**
 * The two lines of a row.
 *
 * Under a day heading the day would be said twice, so it is left out; in a list with no headings it
 * is needed. Across every agent the row leads with who, since that is what tells rows apart; on one
 * agent's own screen who is already the title, so the row leads with what happened.
 */
export function activityRowText(
  item: Activity,
  { name, withAgent, underDayHeading }: { readonly name: string | null; readonly withAgent: boolean; readonly underDayHeading: boolean },
  now: number = Date.now(),
): ActivityRowText {
  const when = underDayHeading ? clockTime(item.at) : `${dayHeading(item.at, now)} ${clockTime(item.at)}`;
  return withAgent
    ? { title: name ?? shortAddress(item.agent), detail: `${ACTIVITY_TITLES[item.kind]} · ${when}`, titleIsAddress: name === null }
    : { title: ACTIVITY_TITLES[item.kind], detail: when, titleIsAddress: false };
}

export interface ActivityRowText {
  readonly title: string;
  readonly detail: string;
  /** The title is an address, so it is set in mono like every other address in the app. */
  readonly titleIsAddress: boolean;
}

/**
 * What a draw was, in full, for the receipt.
 *
 * Says what the chain shows and, in the same breath, what it does not, because a receipt that
 * leaves out the seller without saying why reads as a receipt with a bug in it.
 */
export const DRAW_EXPLAINED =
  "Moved from your wallet into this agent's escrow at Circle's Gateway, which it pays sellers from. " +
  "Arc records that move, not which seller the agent then paid, so no seller is shown here.";

/**
 * What a payment straight to somebody was, for the receipt.
 *
 * Unlike a draw, this one can name who was paid, because Arc records the transfer itself. It is said
 * out loud, since the two rows sit next to each other and otherwise look like the same thing.
 */
export const PAID_EXPLAINED =
  "Sent from your wallet to the address below, by this agent, under its allowance. Arc records this " +
  "transfer, so unlike money moved into the agent's escrow, this one names who was paid.";

/** An ERC-8004 identity, as both screens that show one say it. */
export const identityLabel = (identity: bigint): string => `ERC-8004 #${identity}`;

/**
 * What a registration was, for the receipt.
 *
 * The agent sets up an ERC-8004 identity through its allowance, and the wallet owns it. That is the
 * thing a seller credits, so it is worth saying plainly rather than leaving as an unexplained row.
 */
export const REGISTERED_EXPLAINED =
  "This agent set up an ERC-8004 identity, and your wallet owns it. Sellers that reward agents write " +
  "what it earns to that identity, and anything minted for it, like a badge, is yours.";

/**
 * When the agent last spent, from the feed: its newest draw or payment, or `null` when it has none.
 *
 * The chain's own last-used time is never written for the one-meter rail the app grants, so the
 * agent's screen could not say it. The feed can, for as far back as it has read.
 */
export function lastSpentAt(items: readonly Activity[]): number | null {
  let latest: number | null = null;
  for (const item of items) {
    if ((item.kind === "draw" || item.kind === "paid") && (latest === null || item.at > latest)) latest = item.at;
  }
  return latest;
}
