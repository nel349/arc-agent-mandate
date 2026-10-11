import { rowKey, type Activity } from "../arc/activity.ts";

/**
 * Which rows of the feed have just arrived.
 *
 * A row arrives lit, and the light fades, so somebody watching an agent work can tell which line is
 * new without reading the times. That is only true of a row that is newer than everything already
 * on screen. A row that "Show earlier" brought in is older than all of it, and the rows a phone kept
 * from last time are not arriving at all; lighting those would be the feed crying wolf.
 *
 * So the feed is marked at its newest row, and only what is after the mark has arrived. And only if
 * it is recent: a phone that was offline, or in a pocket, catches up on rows that are after the mark
 * and an hour old, and those did not just happen either. No React in it: the ordering is the part
 * that is easy to get backwards.
 */
export interface Mark {
  readonly block: bigint;
  readonly logIndex: number;
  readonly call: number;
}

type Placed = Pick<Activity, "block" | "logIndex" | "call">;

const markOf = (item: Placed): Mark => ({ block: item.block, logIndex: item.logIndex, call: item.call ?? 0 });

/** Later on the chain: a later block, or later in the same block, or a later call of the same operation. */
function isAfter(item: Placed, mark: Mark): boolean {
  if (item.block !== mark.block) return item.block > mark.block;
  if (item.logIndex !== mark.logIndex) return item.logIndex > mark.logIndex;
  return (item.call ?? 0) > mark.call;
}

/** The newest row's place, or `null` for a feed with nothing in it. The rows need not be in order. */
export function newestOf(items: readonly Placed[]): Mark | null {
  let newest: Mark | null = null;
  for (const item of items) if (newest === null || isAfter(item, newest)) newest = markOf(item);
  return newest;
}

/**
 * How old a row can be and still have just arrived.
 *
 * Two minutes. The wallet reads the chain every ten seconds and a read can be a little behind, so
 * a payment is seen well inside this; anything older was missed while the phone was not looking.
 */
export const JUST_NOW_S = 120;

/**
 * The keys of the rows that are after the mark and no older than `JUST_NOW_S`. With no mark the
 * feed was empty, so every recent row has arrived.
 */
export function arrivedSince(items: readonly Activity[], mark: Mark | null, now: number = Date.now()): readonly string[] {
  const oldest = Math.floor(now / 1000) - JUST_NOW_S;
  return items
    .filter((item) => item.at >= oldest && (mark === null || isAfter(item, mark)))
    .map(rowKey);
}

/** Whose feed it is: a network and a wallet on it. A different one is a different feed. */
export const feedOf = (chainId: number, wallet: string | null | undefined): string =>
  `${chainId}:${(wallet ?? "").toLowerCase()}`;
