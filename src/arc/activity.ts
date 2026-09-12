import {
  formatLog, getAddress, isAddress, isHash, numberToHex, pad, parseAbiItem, parseEventLogs,
  toEventSelector, zeroAddress, type Address, type Hash, type Hex,
} from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
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
 * What the chain does **not** say is which seller the agent then paid out of that escrow. That happens
 * inside Gateway as a signed message and settles later in a batch. So a draw is shown as money moved
 * into the escrow, never as a purchase from a named shop, because that would be a claim nothing here
 * can check.
 *
 * **A payment straight to somebody** is different, and was missing entirely: the `pay` tool sends
 * USDC through the ERC-20 view, which Arc records as a `Transfer` naming both sides. What that log
 * does not name is *which agent* sent it, since the sender is the wallet. The EntryPoint's
 * `UserOperationEvent` in the same transaction does: the plugin requires a session key to own its
 * operation's nonce, so the key is in the nonce (`agentInNonce`). Grants and revokes come from the
 * plugin's own events, so an agent's history is complete.
 *
 * **Reading under the RPC's cap.** `eth_getLogs` refuses spans over 10,000 blocks, and Arc makes
 * about two a second, so a day is seventeen windows. The feed starts with the most recent day,
 * then reads only new blocks, and reaches further back only when asked. What has been read is
 * kept as one unbroken span, which is what lets it resume instead of starting over.
 */

/**
 * Every kind of row, as one list, with the type derived from it.
 *
 * The list and the type used to be written separately, and the guard that reads a stored feed checked
 * against the list: adding `paid` and `registered` to the type left them out of the list, and rows of
 * those kinds were quietly dropped on the way back from the phone's own store. Derived, that cannot
 * happen — a kind the list does not name is not a kind.
 */
const KINDS = ["draw", "paid", "registered", "granted", "revoked"] as const;

export type ActivityKind = (typeof KINDS)[number];

export interface Activity {
  readonly kind: ActivityKind;
  readonly agent: Address;
  /** What moved: into the agent's escrow on a draw, to whoever was paid on a payment. */
  readonly amount: Usdc | null;
  /** Who was paid, on a `paid` row and nowhere else. */
  readonly to?: Address;
  /** The ERC-8004 identity number, on a `registered` row and nowhere else. */
  readonly identity?: bigint;
  /** Unix seconds, from the block. */
  readonly at: number;
  readonly block: bigint;
  readonly tx: Hash;
  readonly logIndex: number;
  /**
   * What the grant wrote as its tag, on a `granted` row and nowhere else.
   *
   * A grant made by scanning the agent's code carries a hash of that code, and one made from a typed
   * address carries a hash of the label. The agent spends only from the first kind, so this is what
   * tells an allowance it will use from one it will ignore. See `grantedWithoutCode`.
   */
  readonly tag?: Hex;
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
  readonly to?: Address | undefined;
  readonly identity?: bigint | undefined;
  readonly tag?: Hex | undefined;
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
  if (kind === "draw" || kind === "paid") {
    if (log.value === undefined) return null;
    // Gateway and the ERC-20 view both count in six decimals.
    amount = Usdc.fromErc20Units(log.value);
  }
  // A payment nobody can address is not shown: the whole point of the row is who was paid.
  if (kind === "paid" && log.to === undefined) return null;
  // Nor is a registration without the number it registered, which is the whole of that row.
  if (kind === "registered" && log.identity === undefined) return null;
  return {
    kind, agent, amount, at: Number(timestamp), block: blockNumber, tx: transactionHash, logIndex,
    ...(kind === "paid" && log.to !== undefined ? { to: log.to } : {}),
    ...(kind === "registered" && log.identity !== undefined ? { identity: log.identity } : {}),
    // Only a grant has one, and a grant read from an older feed may not carry it.
    ...(kind === "granted" && log.tag !== undefined ? { tag: log.tag } : {}),
  };
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
const transferred = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const operated = parseAbiItem(
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
);

/** An identity is minted from nowhere, which is what tells a registration from a transfer. */
const registered = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");

/** ERC-4337 v0.7's EntryPoint, from viem rather than typed out again. */
export const ENTRY_POINT: Address = entryPoint07Address;

/**
 * The agent that signed an operation, taken out of its nonce.
 *
 * The session key plugin requires a key to own the key half of its nonce, so that one agent's
 * operations stay sequential. That makes the nonce the only place an operation names the agent
 * behind it: the sender is the wallet, and the calldata is the account's, not the key's. `null` for
 * an operation the owner signed themselves, whose nonce key is zero.
 */
export function agentInNonce(nonce: bigint): Address | null {
  const address = (nonce >> NONCE_SEQUENCE_BITS) & ((1n << ADDRESS_BITS) - 1n);
  // Checksummed, because every other address the feed carries is, and they are compared to each other.
  return address === 0n ? null : getAddress(`0x${address.toString(16).padStart(ADDRESS_HEX_CHARS, "0")}`);
}

/** ERC-4337 packs a nonce as a 192-bit key and a 64-bit sequence; the plugin puts the agent in the key. */
const NONCE_SEQUENCE_BITS = 64n;
/** An address is 20 bytes, which is 160 bits and 40 hex characters. */
const ADDRESS_BITS = 160n;
const ADDRESS_HEX_CHARS = 40;

/** One operation, as the pairing below needs it. */
export interface OperationLog {
  readonly transactionHash: Hash | null;
  readonly nonce: bigint | undefined;
  readonly success: boolean | undefined;
}

/**
 * Which agent made the payments in each transaction.
 *
 * Only operations that ran: one the EntryPoint recorded as failed moved nothing, whatever else its
 * transaction contains. An operation the owner signed names no agent and is left out, so a transfer
 * from the app itself is never attributed to one.
 */
export function agentsByTransaction(operations: readonly OperationLog[]): Map<Hash, Address> {
  const byTransaction = new Map<Hash, Address>();
  for (const operation of operations) {
    if (operation.transactionHash === null || operation.nonce === undefined || operation.success !== true) continue;
    const agent = agentInNonce(operation.nonce);
    if (agent !== null) byTransaction.set(operation.transactionHash, agent);
  }
  return byTransaction;
}

/** A top-up shows as a transfer into Gateway and again as its `Deposited`, which is the row shown. */
const intoEscrow = (to: Address): boolean =>
  to.toLowerCase() === ARC_CONTRACTS.gatewayWallet.toLowerCase();

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

  // Payments straight to somebody, which the wallet sends through the ERC-20 view. Read from the
  // view alone: Arc emits the same transfer again from its system emitter at a different scale, and
  // reading both counts every payment twice (docs/FINDINGS.md, finding 6).
  await pause();
  const transfers = await arcPublicClient.getLogs({
    address: ARC_CONTRACTS.usdc, event: transferred, args: { from: account },
    fromBlock: window.from, toBlock: window.to,
  });
  const payments = transfers.filter((log) => log.args.to !== undefined && !intoEscrow(log.args.to));

  // An ERC-8004 identity minted to this wallet, which is an agent setting up the identity its owner
  // holds. Both sides of the mint are indexed, so this asks for only this wallet's.
  await pause();
  const identities = await arcPublicClient.getLogs({
    address: ARC_CONTRACTS.erc8004.identity, event: registered, args: { from: zeroAddress, to: account },
    fromBlock: window.from, toBlock: window.to,
  });

  // Asked only when there is something to attribute, since most windows have nothing and this feed
  // shares one rate limit with the figures a person is waiting on.
  let agents = new Map<Hash, Address>();
  if (payments.length > 0 || identities.length > 0) {
    await pause();
    const operations = await arcPublicClient.getLogs({
      address: ENTRY_POINT, event: operated, args: { sender: account },
      fromBlock: window.from, toBlock: window.to,
    });
    agents = agentsByTransaction(operations.map((log) => ({
      transactionHash: log.transactionHash, nonce: log.args.nonce, success: log.args.success,
    })));
  }

  // Only when the node left times off the logs: one block read per distinct block, not per row.
  const missing = [...draws, ...keys, ...payments, ...identities]
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
    ...payments.map((log) => activityFromLog("paid", {
      ...fields(log),
      // The transfer says the wallet paid; the operation in the same transaction says which agent.
      agent: log.transactionHash === null ? undefined : agents.get(log.transactionHash),
      value: log.args.value,
      to: log.args.to,
    })),
    ...identities.map((log) => activityFromLog("registered", {
      ...fields(log),
      agent: log.transactionHash === null ? undefined : agents.get(log.transactionHash),
      identity: log.args.tokenId,
    })),
    ...keys.map((log) => activityFromLog(
      log.eventName === "SessionKeyAdded" ? "granted" : "revoked",
      {
        ...fields(log),
        agent: log.args.sessionKey,
        ...(log.eventName === "SessionKeyAdded" ? { tag: log.args.tag } : {}),
      },
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
  /** The grant's tag, on a granted row. Absent on rows kept before the feed read it. */
  readonly g?: string;
  /** Who was paid, on a paid row. */
  readonly p?: string;
  /** The identity number, on a registered row. */
  readonly n?: string;
}

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
      ...(item.tag === undefined ? {} : { g: item.tag }),
      ...(item.to === undefined ? {} : { p: item.to }),
      ...(item.identity === undefined ? {} : { n: item.identity.toString() }),
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
  if ((kind === "draw" || kind === "paid") && units === null) return null;
  if (kind === "paid" && (typeof r.p !== "string" || !isAddress(r.p))) return null;
  const identity = bigintOr(r.n);
  if (kind === "registered" && identity === null) return null;
  return {
    kind,
    agent: r.a,
    amount: units === null ? null : Usdc.fromNativeUnits(units),
    at: r.t,
    block,
    tx: r.h,
    logIndex: r.i,
    ...(kind === "granted" && typeof r.g === "string" && isHash(r.g) ? { tag: r.g } : {}),
    ...(kind === "paid" && typeof r.p === "string" && isAddress(r.p) ? { to: r.p } : {}),
    ...(kind === "registered" && identity !== null ? { identity } : {}),
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
