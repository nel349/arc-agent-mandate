import { useEffect, useRef } from "react";
import type { Activity } from "../arc/activity.ts";
import { arrivedSince, newestOf, type Mark } from "./arrivals.ts";

const NONE: ReadonlySet<string> = new Set();

/**
 * Where each feed has been drawn up to, for as long as the app is open.
 *
 * One mark for a feed, shared by every screen that shows it. Each screen used to keep its own, and
 * a screen opened a moment ago had not yet marked anything, so the first payment after opening an
 * agent's page was the one that never lit.
 */
const marks = new Map<string, Mark | null>();

/**
 * The rows that have just arrived in a feed. See `arrivals.ts` for what counts.
 *
 * The first time a feed is drawn it is marked and nothing has arrived: what a phone kept from last
 * time is not happening now. After that, each draw reports the rows past the mark that are also
 * recent, and moves the mark. `feed` is whose it is, from `feedOf`.
 */
export function useArrivals(items: readonly Activity[], feed: string): ReadonlySet<string> {
  // The draw on which the feed changes still holds the last feed's rows: the wallet clears them a
  // moment after. Marked with those, a wallet moved from a network at block seventy million to one
  // at sixty-six would wait four million blocks for a row to count as new.
  const drawn = useRef(feed);
  const changed = drawn.current !== feed;
  drawn.current = feed;

  const arrived = !changed && marks.has(feed) ? arrivedSince(items, marks.get(feed) ?? null) : [];

  // After the draw, so every screen drawing the feed in the same pass sees the same arrivals.
  useEffect(() => {
    if (changed) return;
    marks.set(feed, newestOf(items) ?? marks.get(feed) ?? null);
  });

  return arrived.length === 0 ? NONE : new Set(arrived);
}
