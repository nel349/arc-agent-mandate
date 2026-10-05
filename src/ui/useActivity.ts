import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { NetworkProfile } from "@kuiralabs/mandate-core";
import type { ArcAccount } from "../arc/account.ts";
import {
  blockTime, covering, earlierWindows, EMPTY_FEED, FEED_PACE_MS, feedKeyOf, feedRulesOf, hasEarlier, mergeFeed,
  newWindows, nextBackoff, parseFeed, readActivityWindow, serializeFeed, tooFarBehind, type Activity, type Feed, type Window,
} from "../arc/activity.ts";
import { clientFor, isRateLimited } from "../arc/client.ts";
import { busyOn } from "./failure.ts";
import { readPreference, writePreference } from "./preference-store.ts";

declare const __DEV__: boolean;

/**
 * The payments feed, kept current while the app is open.
 *
 * Read from the chain and kept on the phone, so reopening the app shows what it last knew at once
 * and then reads only what is new. Held in the session with the wallet and the allowances, so every
 * screen that shows it reads the same rows from one scan.
 *
 * **It reads politely.** The feed shares Arc's public rate limit with the allowance and balance
 * reads, and it is the least urgent of the three. So it waits for them on launch, goes one request
 * at a time with a pause between, and when Arc says "too many requests" it stops and waits, longer
 * each time, instead of asking again in ten seconds. See `FEED_PACE_MS`.
 */

/** The same unhurried pace as the allowances and the balance. */
const POLL_INTERVAL_MS = 10_000;

/** How long after the app opens the feed starts, so the allowances and balance are read first. */
const FIRST_READ_DELAY_MS = 3_000;

/** What a failed read says. The rows already shown stay, because they are still true. */
const feedUnreadable = (network: NetworkProfile): string =>
  `Could not read recent activity from ${network.name}. It will try again shortly.`;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const pace = () => wait(FEED_PACE_MS);

export interface ActivityFeed {
  /** Newest first, every agent. */
  readonly items: readonly Activity[];
  /** Any read is running, including the routine one every ten seconds. */
  readonly loading: boolean;
  /**
   * A "show earlier" the person asked for is running. Kept apart from `loading` so the button they
   * tapped is the only thing that spins, not every ten seconds when the feed checks for new rows.
   */
  readonly loadingEarlier: boolean;
  readonly error: string | null;
  /** When the oldest block read was made, or `null` before the first read finishes. */
  readonly since: number | null;
  /** Whether anything older than `since` could exist. */
  readonly canLoadEarlier: boolean;
  loadEarlier(): void;
}

type Direction = "new" | "earlier";

/** How long the feed is staying quiet after a refusal, and until when. */
interface Backoff {
  readonly delay: number;
  readonly until: number;
}

/**
 * One wallet's feed on the network it is open on. Keyed by both, so switching wallets or networks
 * never shows one another's history.
 */
export function useActivity(wallet: ArcAccount | null): ActivityFeed {
  const account = wallet?.address ?? null;
  const network = wallet?.network ?? null;
  const [feed, setFeed] = useState<Feed>(EMPTY_FEED);
  /** Which kind of read is running, if any. */
  const [reading, setReading] = useState<Direction | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** The feed as of the last window read, for the next scan to continue from. */
  const latest = useRef<Feed>(EMPTY_FEED);
  /** The feed the screen is showing now. A scan started for another one stops writing. */
  const current = useRef<string | null>(null);
  /** One scan at a time: two overlapping would read the same windows twice and race to save. */
  const running = useRef(false);
  /** Set when Arc refused a read for being too frequent; polls do nothing until it passes. */
  const backoff = useRef<Backoff | null>(null);

  const scan = useCallback(async (direction: Direction) => {
    const owner = account;
    if (owner === null || network === null || running.current) return;
    if (backoff.current !== null && Date.now() < backoff.current.until) return;
    running.current = true;
    setReading(direction);
    const key = feedKeyOf(network, owner);
    const rules = feedRulesOf(network);

    try {
      let start = latest.current;
      let windows: readonly Window[] = [];
      if (direction === "new") {
        const head = await clientFor(network).getBlockNumber();
        // Too far behind to catch up quickly: start again from the latest blocks.
        if (tooFarBehind(start.coverage, head, rules.mostBehind)) start = EMPTY_FEED;
        windows = newWindows(start.coverage, head, rules.floor, rules.span, rules.window);
      } else if (start.coverage !== null) {
        windows = earlierWindows(start.coverage, rules.floor, rules.span, rules.window);
      }

      let next = start;
      for (const window of windows) {
        await pace();
        const found = await readActivityWindow(owner, window, pace, network);
        if (current.current !== key) return;
        next = mergeFeed({ ...next, coverage: covering(next.coverage, window) }, found);
        // Shown and kept after every window, so a long first read fills in as it goes and a read
        // that is interrupted keeps what it had reached, and resumes from there.
        latest.current = next;
        setFeed(next);
        void writePreference(key, serializeFeed(next));
      }

      // How far back the feed reaches, in time, once per change to where it starts.
      if (next.coverage !== null && (next.since === null || next.coverage.low !== start.coverage?.low)) {
        await pace();
        const since = await blockTime(next.coverage.low, network);
        if (current.current !== key) return;
        next = { ...next, since };
        latest.current = next;
        setFeed(next);
        void writePreference(key, serializeFeed(next));
      }
      backoff.current = null;
      setError(null);
    } catch (cause) {
      if (current.current !== key) return;
      if (isRateLimited(cause)) {
        const delay = nextBackoff(backoff.current?.delay ?? null);
        backoff.current = { delay, until: Date.now() + delay };
        if (__DEV__) console.warn(`[activity] ${network.name} asked the feed to slow down; next read in ${delay / 1000}s`);
        setError(busyOn(network));
      } else {
        if (__DEV__) console.warn("[activity] read failed", cause);
        setError(feedUnreadable(network));
      }
    } finally {
      running.current = false;
      if (current.current === key) setReading(null);
    }
  }, [account, network]);

  // A new account starts from what this phone kept for it, then catches up once the allowances
  // and balance have had the endpoint to themselves for a moment.
  useEffect(() => {
    const key = account === null || network === null ? null : feedKeyOf(network, account);
    current.current = key;
    latest.current = EMPTY_FEED;
    backoff.current = null;
    setFeed(EMPTY_FEED);
    setError(null);
    if (key === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void readPreference(key).then((stored) => {
      if (cancelled) return;
      const kept = parseFeed(stored);
      latest.current = kept;
      setFeed(kept);
      timer = setTimeout(() => void scan("new"), FIRST_READ_DELAY_MS);
    });
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [account, network, scan]);

  // Keep reading while the app is open, and again the moment it returns, because timers do not
  // run in a backgrounded app. Same reasoning as the allowances in `useMandate`.
  useEffect(() => {
    if (account === null) return;
    const timer = setInterval(() => void scan("new"), POLL_INTERVAL_MS);
    const watch = AppState.addEventListener("change", (state) => {
      if (state === "active") void scan("new");
    });
    return () => {
      clearInterval(timer);
      watch.remove();
    };
  }, [account, scan]);

  const loadEarlier = useCallback(() => void scan("earlier"), [scan]);

  return {
    items: feed.items,
    loading: reading !== null,
    loadingEarlier: reading === "earlier",
    error,
    since: feed.since,
    canLoadEarlier: network !== null && hasEarlier(feed.coverage, network.logs.floor),
    loadEarlier,
  };
}
