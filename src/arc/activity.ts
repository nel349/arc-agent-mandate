import {
  formatLog, isAddress, isHash, numberToHex, pad, parseAbiItem, parseEventLogs, toEventSelector,
  type Address, type Hash,
} from "viem";
import { ARC_CONTRACTS } from "./chain.ts";
import { arcPublicClient } from "./client.ts";
import { SESSION_KEY_PLUGIN, SESSION_KEY_PLUGIN_DEPLOY_BLOCK } from "./mandate.ts";
import { Usdc } from "./usdc.ts";

/**
 * What an account's agents did with its money, read from Arc's own logs.
 *
 * **What the chain can say, and what it cannot.** An agent buys through Circle's Gateway, which
 * only accepts a payment signed by the payer itself, so the account funds the agent's Gateway
 * balance one purchase at a time. Each of those shows on Arc as Gateway's `Deposited` event, naming
 * the agent as depositor and the account as sender. That is exactly what the mandate meters, so
 * it is exactly what a feed of "what my allowance paid for" should list, with no indexer and
 * nothing reconstructed from calldata.
 *
 * What the chain does **not** say is which seller the agent then paid. That happens inside
 * Gateway as a signed message and settles later in a batch. So a draw is shown as funding a
 * purchase, never as a purchase from a named shop, because that would be a claim nothing here can
 * check. Grants and revokes come from the plugin's own events, so an agent's history is complete.
 *
 * **Reading under the RPC's cap.** `eth_getLogs` refuses spans over 10,000 blocks, and Arc makes
 * about two a second, so a day is seventeen windows. The feed starts with the most recent day,
 * then reads only new blocks, and reaches further back only when asked. What has been read is
 * kept as one unbroken span, which is what lets it resume instead of starting over.
 */

export type ActivityKind = "draw" | "granted" | "revoked";

export interface Activity {
  readonly kind: ActivityKind;
  readonly agent: Address;
  /** What moved into the agent's Gateway balance. Only a draw carries an amount. */
  readonly amount: Usdc | null;
  /** Unix seconds, from the block. */
  readonly at: number;
  readonly block: bigint;
  readonly tx: Hash;
  readonly logIndex: number;
}

/** Blocks already read, inclusive at both ends. */
export interface Coverage {
  readonly low: bigint;
  readonly high: bigint;
}

export interface Feed {
  readonly coverage: Coverage | null;
  readonly items: readonly Activity[];
  /** When the oldest block read was made, so the screen can say how far back it is showing. */
  readonly since: number | null;
}

export const EMPTY_FEED: Feed = { coverage: null, items: [], since: null };

/** One less than the RPC's 10,000-block cap, because both ends of a span count. */
export const LOG_WINDOW = 9_999n;

/** Blocks in a day on Arc testnet, measured: about 1.95 a second. How far the first read reaches. */
export const BLOCKS_PER_DAY = 167_669n;

/**
 * The most rows kept. Enough for weeks of an agent paying per step; past it the oldest go, and
 * the span read is trimmed to match so "show earlier" can bring them back.
 */
export const FEED_CAP = 500;

export interface Window {
  readonly from: bigint;
  readonly to: bigint;
}

/**
 * Time between the feed's requests.
 *
 * The feed is the least urgent reader of Arc's public endpoint, and it shares one rate limit with
 * the reads a person decides on: what each agent has left, and the wallet's balance. Its first read
 * used to go out as fast as the network allowed, fifty requests in about two seconds, and took the
 * allowance reads down with it. At this pace a day of history takes about twenty seconds, arriving
 * newest first, and the allowances never wait behind it.
 */
export const FEED_PACE_MS = 600;

/** After Arc refuses a read for being too frequent, the feed stays quiet this long, doubling each time. */
export const FIRST_BACKOFF_MS = 30_000;
/** The longest the feed will wait between attempts, so a busy afternoon cannot silence it for good. */
export const MAX_BACKOFF_MS = 300_000;

/** How long to wait after a refusal: half a minute, then double the last wait, up to five minutes. */
export function nextBackoff(previous: number | null): number {
  return previous === null ? FIRST_BACKOFF_MS : Math.min(previous * 2, MAX_BACKOFF_MS);
}

const max = (a: bigint, b: bigint) => (a > b ? a : b);
const min = (a: bigint, b: bigint) => (a < b ? a : b);

/** Windows from `high` down to `low`, newest first, so the most recent rows arrive first. */
function downward(low: bigint, high: bigint): Window[] {
  const windows: Window[] = [];
  for (let to = high; to >= low; to -= LOG_WINDOW + 1n) {
    windows.push({ from: max(low, to - LOG_WINDOW), to });
  }
  return windows;
}

/** Windows from `low` up to `high`, each adjacent to what is already read. */
function upward(low: bigint, high: bigint): Window[] {
  const windows: Window[] = [];
  for (let from = low; from <= high; from += LOG_WINDOW + 1n) {
    windows.push({ from, to: min(high, from + LOG_WINDOW) });
  }
  return windows;
}

/**
 * What to read to be up to date: the last day on a first read, and afterwards only the blocks that
 * are new since the last one. Never reaches below the plugin's deployment, which no grant predates.
 */
export function newWindows(
  coverage: Coverage | null,
  head: bigint,
  floor: bigint = SESSION_KEY_PLUGIN_DEPLOY_BLOCK,
  backfill: bigint = BLOCKS_PER_DAY,
): readonly Window[] {
  if (coverage === null) return downward(max(floor, head - backfill + 1n), head);
  return head > coverage.high ? upward(coverage.high + 1n, head) : [];
}

/** One more day below what has been read, or nothing once the floor is reached. */
export function earlierWindows(
  coverage: Coverage,
  floor: bigint = SESSION_KEY_PLUGIN_DEPLOY_BLOCK,
  span: bigint = BLOCKS_PER_DAY,
): readonly Window[] {
  if (coverage.low <= floor) return [];
  return downward(max(floor, coverage.low - span), coverage.low - 1n);
}

/** Whether anything older than what has been read could exist. */
export function hasEarlier(coverage: Coverage | null, floor: bigint = SESSION_KEY_PLUGIN_DEPLOY_BLOCK): boolean {
  return coverage !== null && coverage.low > floor;
}

/** The span read so far, with one more window in it. Windows are always adjacent, so it stays whole. */
export function covering(coverage: Coverage | null, window: Window): Coverage {
  return coverage === null
    ? { low: window.from, high: window.to }
    : { low: min(coverage.low, window.from), high: max(coverage.high, window.to) };
}

const keyOf = (item: Activity) => `${item.tx}:${item.logIndex}`;

function newestFirst(a: Activity, b: Activity): number {
  if (a.block !== b.block) return a.block > b.block ? -1 : 1;
  return b.logIndex - a.logIndex;
}

/**
 * Two lists as one, newest first, each event once, at most `cap` long.
 *
 * Returns the trimmed coverage too: when the cap drops the oldest rows, the span read is pulled up
 * to the oldest row kept, so the feed never claims to have read blocks whose rows it threw away.
 */
export function mergeFeed(feed: Feed, incoming: readonly Activity[], cap: number = FEED_CAP): Feed {
  const byKey = new Map<string, Activity>();
  for (const item of [...feed.items, ...incoming]) byKey.set(keyOf(item), item);
  const all = [...byKey.values()].sort(newestFirst);
  if (all.length <= cap) return { ...feed, items: all };

  const kept = all.slice(0, cap);
  const oldest = kept[kept.length - 1];
  const coverage = feed.coverage === null || oldest === undefined
    ? feed.coverage
    : { low: max(feed.coverage.low, oldest.block), high: feed.coverage.high };
  return { coverage, items: kept, since: null };
}

/** The parts of a decoded log this needs. Fields arrive optional because a pending log lacks them. */
export interface LogFields {
  readonly agent: Address | undefined;
  readonly value?: bigint | undefined;
  readonly blockNumber: bigint | null;
  readonly timestamp: bigint | null;
  readonly transactionHash: Hash | null;
  readonly logIndex: number | null;
}

/** One row, or `null` for a log missing what a row needs. A row we cannot place is not shown. */
export function activityFromLog(kind: ActivityKind, log: LogFields): Activity | null {
  const { agent, blockNumber, timestamp, transactionHash, logIndex } = log;
  if (agent === undefined || blockNumber === null || timestamp === null) return null;
  if (transactionHash === null || logIndex === null) return null;

  let amount: Usdc | null = null;
  if (kind === "draw") {
    if (log.value === undefined) return null;
    // Gateway counts in the ERC-20 view's six decimals.
    amount = Usdc.fromErc20Units(log.value);
  }
  return { kind, agent, amount, at: Number(timestamp), block: blockNumber, tx: transactionHash, logIndex };
}

/**
 * The block's time, when the node puts it on the log.
 *
 * Arc's does (`blockTimestamp`, measured 09-10), which saves a block read per row. It is not in
 * every node's logs, so it is read defensively, and the caller fetches the block when it is absent.
 */
function timestampOf(log: object): bigint | null {
  if (!("blockTimestamp" in log)) return null;
  const value = log.blockTimestamp;
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(value);
  if (typeof value === "string" && value.length > 0) return BigInt(value);
  return null;
}

const deposited = parseAbiItem(
  "event Deposited(address indexed token, address indexed depositor, address indexed sender, uint256 value)",
);
const keyAdded = parseAbiItem(
  "event SessionKeyAdded(address indexed account, address indexed sessionKey, bytes32 indexed tag)",
);
const keyRemoved = parseAbiItem("event SessionKeyRemoved(address indexed account, address indexed sessionKey)");

/** Both of the plugin's key events, so one query can ask for either. */
const KEY_EVENTS = [keyAdded, keyRemoved] as const;
const KEY_EVENT_TOPICS = KEY_EVENTS.map((event) => toEventSelector(event));

const noPause = async () => {};

/**
 * Everything an account's agents did in one window of blocks, in two requests, one after the other.
 *
 * Two, not three: grants and revokes come from the same contract with the account in the same
 * position, so one query asks for either event, which viem's `getLogs` cannot express with an
 * argument filter and so goes through the raw call. One after the other, with `pause` between, so
 * the feed never sends a burst; see `FEED_PACE_MS`.
 */
export async function readActivityWindow(
  account: Address,
  window: Window,
  pause: () => Promise<void> = noPause,
): Promise<Activity[]> {
  const draws = await arcPublicClient.getLogs({
    address: ARC_CONTRACTS.gatewayWallet, event: deposited, args: { sender: account },
    fromBlock: window.from, toBlock: window.to,
  });
  await pause();
  const raw = await arcPublicClient.request({
    method: "eth_getLogs",
    params: [{
      address: SESSION_KEY_PLUGIN,
      topics: [KEY_EVENT_TOPICS, pad(account)],
      fromBlock: numberToHex(window.from),
      toBlock: numberToHex(window.to),
    }],
  });
  const keys = parseEventLogs({ abi: KEY_EVENTS, logs: raw.map((log) => formatLog(log)) });

  // Only when the node left times off the logs: one block read per distinct block, not per row.
  const missing = [...draws, ...keys]
    .filter((log) => timestampOf(log) === null && log.blockNumber !== null)
    .map((log) => log.blockNumber as bigint);
  const times = new Map<bigint, bigint>();
  for (const blockNumber of new Set(missing)) {
    await pause();
    times.set(blockNumber, (await arcPublicClient.getBlock({ blockNumber })).timestamp);
  }
  const fields = (log: { blockNumber: bigint | null; transactionHash: Hash | null; logIndex: number | null }) => ({
    blockNumber: log.blockNumber,
    timestamp: timestampOf(log) ?? (log.blockNumber === null ? null : times.get(log.blockNumber) ?? null),
    transactionHash: log.transactionHash,
    logIndex: log.logIndex,
  });

  return [
    ...draws.map((log) => activityFromLog("draw", { ...fields(log), agent: log.args.depositor, value: log.args.value })),
    ...keys.map((log) => activityFromLog(
      log.eventName === "SessionKeyAdded" ? "granted" : "revoked",
      { ...fields(log), agent: log.args.sessionKey },
    )),
  ].filter((item): item is Activity => item !== null);
}

/** When a block was made, for saying how far back the feed reaches. */
export async function blockTime(blockNumber: bigint): Promise<number> {
  return Number((await arcPublicClient.getBlock({ blockNumber })).timestamp);
}

/** Stored shape: short keys, and strings for the numbers JSON cannot hold. */
interface StoredActivity {
  readonly k: ActivityKind;
  readonly a: string;
  readonly u: string | null;
  readonly t: number;
  readonly b: string;
  readonly h: string;
  readonly i: number;
}

const KINDS: readonly ActivityKind[] = ["draw", "granted", "revoked"];

export function serializeFeed(feed: Feed): string {
  return JSON.stringify({
    c: feed.coverage === null ? null : [feed.coverage.low.toString(), feed.coverage.high.toString()],
    s: feed.since,
    i: feed.items.map((item): StoredActivity => ({
      k: item.kind,
      a: item.agent,
      u: item.amount === null ? null : item.amount.toNativeUnits().toString(),
      t: item.at,
      b: item.block.toString(),
      h: item.tx,
      i: item.logIndex,
    })),
  });
}

function bigintOr(text: unknown): bigint | null {
  if (typeof text !== "string" || !/^\d+$/.test(text)) return null;
  return BigInt(text);
}

function parseItem(raw: unknown): Activity | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Partial<Record<keyof StoredActivity, unknown>>;
  const kind = KINDS.find((k) => k === r.k);
  const block = bigintOr(r.b);
  const units = r.u === null ? null : bigintOr(r.u);
  if (kind === undefined || block === null) return null;
  if (typeof r.a !== "string" || !isAddress(r.a) || typeof r.h !== "string" || !isHash(r.h)) return null;
  if (typeof r.t !== "number" || !Number.isFinite(r.t) || typeof r.i !== "number") return null;
  if (kind === "draw" && units === null) return null;
  return {
    kind,
    agent: r.a,
    amount: units === null ? null : Usdc.fromNativeUnits(units),
    at: r.t,
    block,
    tx: r.h,
    logIndex: r.i,
  };
}

/**
 * The stored feed, or an empty one.
 *
 * Tolerant, like the names: a row that does not read is dropped, and a record that does not read
 * at all costs the history on this phone, which the next scan rebuilds from the chain.
 */
export function parseFeed(text: string | null): Feed {
  if (text === null) return EMPTY_FEED;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return EMPTY_FEED;
  }
  if (typeof raw !== "object" || raw === null) return EMPTY_FEED;
  const r = raw as { c?: unknown; s?: unknown; i?: unknown };

  const span = Array.isArray(r.c) ? r.c.map(bigintOr) : null;
  const coverage = span !== null && span.length === 2 && span[0] != null && span[1] != null && span[0] <= span[1]
    ? { low: span[0], high: span[1] }
    : null;
  const items = Array.isArray(r.i)
    ? r.i.map(parseItem).filter((item): item is Activity => item !== null)
    : [];
  // Rows without the span they came from cannot be resumed from, so they are not kept either.
  if (coverage === null) return EMPTY_FEED;
  return { coverage, items, since: typeof r.s === "number" ? r.s : null };
}
