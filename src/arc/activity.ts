import {
  decodeFunctionData, formatLog, getAddress, isAddress, isHash, numberToHex, pad, parseAbiItem, parseEventLogs,
  toEventSelector, zeroAddress, type Address, type Hash, type Hex, type PublicClient,
} from "viem";
import { entryPoint07Abi, entryPoint07Address } from "viem/account-abstraction";
import { ARC_TESTNET, sessionKeyExecutionAbi, type NetworkProfile } from "@kuiralabs/mandate-core";
import { clientFor } from "./client.ts";
import { SESSION_KEY_PLUGIN_DEPLOY_BLOCK, type MandateRail } from "./mandate.ts";
import { Amount } from "./amount.ts";

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
 * **On a network whose agents pay in its own coin** (Monad's MON), a payment is a call carrying value,
 * which leaves no log at all. The EntryPoint's `UserOperationEvent` still names the wallet, so each
 * operation an agent signed is read from its transaction, and what it paid is read out of the calls
 * it made: the same calldata the plugin checked against the grant.
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
  readonly amount: Amount | null;
  /** Who was paid, on a `paid` row and nowhere else. */
  readonly to?: Address;
  /**
   * Which call of its operation, on a `paid` row read from calldata: one operation can pay several
   * people, and each is its own row. Absent where the row is its own log.
   */
  readonly call?: number;
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
function downward(low: bigint, high: bigint, span: bigint): Window[] {
  const windows: Window[] = [];
  for (let to = high; to >= low; to -= span + 1n) {
    windows.push({ from: max(low, to - span), to });
  }
  return windows;
}

/** Windows from `low` up to `high`, each adjacent to what is already read. */
function upward(low: bigint, high: bigint, span: bigint): Window[] {
  const windows: Window[] = [];
  for (let from = low; from <= high; from += span + 1n) {
    windows.push({ from, to: min(high, from + span) });
  }
  return windows;
}

/** How a network's feed is read: its query window, the plugin's first block, and how far one read reaches. */
export interface FeedRules {
  /** one less than the most blocks a query may span, since both ends count */
  readonly window: bigint;
  readonly floor: bigint;
  readonly span: bigint;
  readonly mostBehind: bigint | null;
}

/** A network's feed rules, from its profile. */
export const feedRulesOf = (network: NetworkProfile): FeedRules => ({
  window: network.logs.window,
  floor: network.logs.floor,
  span: network.logs.feed.span,
  mostBehind: network.logs.feed.mostBehind,
});

/**
 * Whether the feed fell so far behind that it starts again from the latest blocks.
 *
 * Catching up reads oldest first, so on a network that allows only small queries a feed left for a day
 * would show nothing new for minutes. Starting again shows the recent rows at once; the older ones it
 * drops cannot stay, since what has been read must remain one unbroken span.
 */
export function tooFarBehind(coverage: Coverage | null, head: bigint, mostBehind: bigint | null): boolean {
  return coverage !== null && mostBehind !== null && head - coverage.high > mostBehind;
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
  window: bigint = LOG_WINDOW,
): readonly Window[] {
  if (coverage === null) return downward(max(floor, head - backfill + 1n), head, window);
  return head > coverage.high ? upward(coverage.high + 1n, head, window) : [];
}

/** One more day below what has been read, or nothing once the floor is reached. */
export function earlierWindows(
  coverage: Coverage,
  floor: bigint = SESSION_KEY_PLUGIN_DEPLOY_BLOCK,
  span: bigint = BLOCKS_PER_DAY,
  window: bigint = LOG_WINDOW,
): readonly Window[] {
  if (coverage.low <= floor) return [];
  return downward(max(floor, coverage.low - span), coverage.low - 1n, window);
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

/** What tells one row from every other: its log, and its call where one operation paid several people. */
export const rowKey = (item: Pick<Activity, "tx" | "logIndex" | "call">): string => `${item.tx}:${item.logIndex}:${item.call ?? ""}`;

function newestFirst(a: Activity, b: Activity): number {
  if (a.block !== b.block) return a.block > b.block ? -1 : 1;
  if (a.logIndex !== b.logIndex) return b.logIndex - a.logIndex;
  return (b.call ?? 0) - (a.call ?? 0);
}

/**
 * Two lists as one, newest first, each event once, at most `cap` long.
 *
 * Returns the trimmed coverage too: when the cap drops the oldest rows, the span read is pulled up
 * to the oldest row kept, so the feed never claims to have read blocks whose rows it threw away.
 */
export function mergeFeed(feed: Feed, incoming: readonly Activity[], cap: number = FEED_CAP): Feed {
  const byKey = new Map<string, Activity>();
  for (const item of [...feed.items, ...incoming]) byKey.set(rowKey(item), item);
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
  /** What `value` counts in: the ERC-20 view's six decimals unless it is the coin itself. */
  readonly rail?: MandateRail;
  /** Which call of its operation a payment was, when it was read from calldata. */
  readonly call?: number;
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

  let amount: Amount | null = null;
  if (kind === "draw" || kind === "paid") {
    if (log.value === undefined) return null;
    // Gateway and the ERC-20 view both count in six decimals; the coin itself in its own.
    amount = log.rail === "native" ? Amount.fromNativeUnits(log.value) : Amount.fromErc20Units(log.value);
  }
  // A payment nobody can address is not shown: the whole point of the row is who was paid.
  if (kind === "paid" && log.to === undefined) return null;
  // Nor is a registration without the number it registered, which is the whole of that row.
  if (kind === "registered" && log.identity === undefined) return null;
  return {
    kind, agent, amount, at: Number(timestamp), block: blockNumber, tx: transactionHash, logIndex,
    ...(kind === "paid" && log.to !== undefined ? { to: log.to } : {}),
    ...(kind === "paid" && log.call !== undefined ? { call: log.call } : {}),
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
const intoEscrow = (network: NetworkProfile, to: Address): boolean =>
  network.contracts.gatewayWallet !== undefined && to.toLowerCase() === network.contracts.gatewayWallet.toLowerCase();

/** Both of the plugin's key events, so one query can ask for either. */
const KEY_EVENTS = [keyAdded, keyRemoved] as const;
const KEY_EVENT_TOPICS = KEY_EVENTS.map((event) => toEventSelector(event));

/** An operation and an identity mint both name the wallet third, so one query asks for either. */
const OPERATION_AND_MINT = [operated, registered] as const;
const OPERATION_AND_MINT_TOPICS = OPERATION_AND_MINT.map((event) => toEventSelector(event));

const noPause = async () => {};

/** One payment an operation made: a call that carried the coin, to whoever it was sent to. */
export interface CallPayment {
  readonly to: Address;
  readonly value: bigint;
  /** its place among the operation's calls */
  readonly call: number;
}

/**
 * What an agent's operation paid, read out of the calls it made: every call that carried the coin.
 *
 * `null` when the operation is not that agent's at all. The nonce alone cannot say: Circle's wallets
 * key the owner's own operations by the time, so an owner's nonce looks like an address too. Only an
 * operation that runs through the plugin with this agent's key is the agent's.
 */
export function paymentsIn(callData: Hex, agent: Address): readonly CallPayment[] | null {
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: sessionKeyExecutionAbi, data: callData });
  } catch {
    return null;
  }
  const [calls, sessionKey] = decoded.args;
  if (sessionKey.toLowerCase() !== agent.toLowerCase()) return null;
  return calls.flatMap((call, index) => (call.value > 0n ? [{ to: call.target, value: call.value, call: index }] : []));
}

/**
 * The calldata of one operation in a bundle, found by its wallet and nonce, which together name it.
 * `null` when the transaction is not the EntryPoint's `handleOps` carrying it.
 */
export function operationCallData(input: Hex, sender: Address, nonce: bigint): Hex | null {
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: entryPoint07Abi, data: input });
  } catch {
    return null;
  }
  if (decoded.functionName !== "handleOps") return null;
  const operation = decoded.args[0].find((op) => op.sender.toLowerCase() === sender.toLowerCase() && op.nonce === nonce);
  return operation?.callData ?? null;
}

/** Where a row came from in its block, as every log carries it. */
interface Placed {
  readonly blockNumber: bigint | null;
  readonly transactionHash: Hash | null;
  readonly logIndex: number | null;
}

/** The fields every row takes from its log, with the block's time read when the node left it off. */
async function placing(
  client: PublicClient, logs: readonly (Placed & object)[], pause: () => Promise<void>,
): Promise<(log: Placed & object) => Omit<LogFields, "agent">> {
  // Only when the node left times off the logs: one block read per distinct block, not per row.
  const missing = logs
    .filter((log) => timestampOf(log) === null && log.blockNumber !== null)
    .map((log) => log.blockNumber as bigint);
  const times = new Map<bigint, bigint>();
  for (const blockNumber of new Set(missing)) {
    await pause();
    times.set(blockNumber, (await client.getBlock({ blockNumber })).timestamp);
  }
  return (log) => ({
    blockNumber: log.blockNumber,
    timestamp: timestampOf(log) ?? (log.blockNumber === null ? null : times.get(log.blockNumber) ?? null),
    transactionHash: log.transactionHash,
    logIndex: log.logIndex,
  });
}

/** The grants and revokes in a window, from the plugin, in one query for either event. */
async function keyLogs(client: PublicClient, network: NetworkProfile, account: Address, window: Window) {
  const raw = await client.request({
    method: "eth_getLogs",
    params: [{
      address: network.contracts.sessionKeyPlugin,
      topics: [KEY_EVENT_TOPICS, pad(account)],
      fromBlock: numberToHex(window.from),
      toBlock: numberToHex(window.to),
    }],
  });
  return parseEventLogs({ abi: KEY_EVENTS, logs: raw.map((log) => formatLog(log)) });
}

type KeyLog = Awaited<ReturnType<typeof keyLogs>>[number];

const keyRows = (keys: readonly KeyLog[], fields: (log: KeyLog) => Omit<LogFields, "agent">) =>
  keys.map((log) => activityFromLog(
    log.eventName === "SessionKeyAdded" ? "granted" : "revoked",
    {
      ...fields(log),
      agent: log.args.sessionKey,
      ...(log.eventName === "SessionKeyAdded" ? { tag: log.args.tag } : {}),
    },
  ));

/**
 * Everything an account's agents did in one window of blocks, a few requests one after the other.
 *
 * Grants and revokes come from the same contract with the account in the same position, so one query
 * asks for either event, which viem's `getLogs` cannot express with an argument filter and so goes
 * through the raw call. One after the other, with `pause` between, so the feed never sends a burst;
 * see `FEED_PACE_MS`. Where payments are read from depends on the network: the ERC-20 view's own
 * transfers where it has one, the agents' operations where it pays in the coin itself.
 */
export async function readActivityWindow(
  account: Address,
  window: Window,
  pause: () => Promise<void> = noPause,
  network: NetworkProfile = ARC_TESTNET,
): Promise<Activity[]> {
  const client = clientFor(network);
  const view = network.contracts.erc20View;
  return view === undefined
    ? readCoinWindow(client, network, account, window, pause)
    : readViewWindow(client, network, view.address, account, window, pause);
}

/** A window on a network with an ERC-20 view of its coin, which records every payment as a transfer (Arc). */
async function readViewWindow(
  client: PublicClient, network: NetworkProfile, view: Address, account: Address, window: Window, pause: () => Promise<void>,
): Promise<Activity[]> {
  const gateway = network.contracts.gatewayWallet;
  const draws = gateway === undefined ? [] : await client.getLogs({
    address: gateway, event: deposited, args: { sender: account },
    fromBlock: window.from, toBlock: window.to,
  });
  await pause();
  const keys = await keyLogs(client, network, account, window);

  // Payments straight to somebody, which the wallet sends through the ERC-20 view. Read from the
  // view alone: Arc emits the same transfer again from its system emitter at a different scale, and
  // reading both counts every payment twice (docs/FINDINGS.md, finding 6).
  await pause();
  const transfers = await client.getLogs({
    address: view, event: transferred, args: { from: account },
    fromBlock: window.from, toBlock: window.to,
  });
  const payments = transfers.filter((log) => log.args.to !== undefined && !intoEscrow(network, log.args.to));

  // An ERC-8004 identity minted to this wallet, which is an agent setting up the identity its owner
  // holds. Both sides of the mint are indexed, so this asks for only this wallet's.
  await pause();
  const identities = await client.getLogs({
    address: network.contracts.erc8004.identity, event: registered, args: { from: zeroAddress, to: account },
    fromBlock: window.from, toBlock: window.to,
  });

  // Asked only when there is something to attribute, since most windows have nothing and this feed
  // shares one rate limit with the figures a person is waiting on.
  let agents = new Map<Hash, Address>();
  if (payments.length > 0 || identities.length > 0) {
    await pause();
    const operations = await client.getLogs({
      address: ENTRY_POINT, event: operated, args: { sender: account },
      fromBlock: window.from, toBlock: window.to,
    });
    agents = agentsByTransaction(operations.map((log) => ({
      transactionHash: log.transactionHash, nonce: log.args.nonce, success: log.args.success,
    })));
  }

  const fields = await placing(client, [...draws, ...keys, ...payments, ...identities], pause);
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
    ...keyRows(keys, fields),
  ].filter((item): item is Activity => item !== null);
}

/**
 * A window on a network whose agents pay in its own coin (Monad), where a payment leaves no log.
 *
 * Two queries, then one transaction read per operation an agent may have signed: the operations name
 * the wallet, and their calls say who was paid and how much. An operation whose calls are not its
 * agent's is no payment and names no agent, so nothing is attributed on the nonce's word alone.
 */
async function readCoinWindow(
  client: PublicClient, network: NetworkProfile, account: Address, window: Window, pause: () => Promise<void>,
): Promise<Activity[]> {
  const keys = await keyLogs(client, network, account, window);
  await pause();
  const raw = await client.request({
    method: "eth_getLogs",
    params: [{
      address: [ENTRY_POINT, network.contracts.erc8004.identity],
      topics: [OPERATION_AND_MINT_TOPICS, null, pad(account)],
      fromBlock: numberToHex(window.from),
      toBlock: numberToHex(window.to),
    }],
  });
  const logs = parseEventLogs({ abi: OPERATION_AND_MINT, logs: raw.map((log) => formatLog(log)) });
  const identity = network.contracts.erc8004.identity.toLowerCase();
  const operations = logs.filter((log) => log.eventName === "UserOperationEvent" && log.address.toLowerCase() === ENTRY_POINT.toLowerCase());
  const mints = logs.filter((log) => log.eventName === "Transfer" && log.address.toLowerCase() === identity && log.args.from === zeroAddress);

  const agents = new Map<Hash, Address>();
  const payments: { readonly log: (typeof operations)[number]; readonly agent: Address; readonly payment: CallPayment }[] = [];
  for (const log of operations) {
    if (log.eventName !== "UserOperationEvent" || log.args.success !== true || log.transactionHash === null) continue;
    const agent = agentInNonce(log.args.nonce);
    if (agent === null) continue;
    await pause();
    const transaction = await client.getTransaction({ hash: log.transactionHash });
    const callData = operationCallData(transaction.input, account, log.args.nonce);
    const paid = callData === null ? null : paymentsIn(callData, agent);
    if (paid === null) continue;
    agents.set(log.transactionHash, agent);
    for (const payment of paid) payments.push({ log, agent, payment });
  }

  const fields = await placing(client, [...keys, ...operations, ...mints], pause);
  return [
    ...payments.map(({ log, agent, payment }) => activityFromLog("paid", {
      ...fields(log), agent, value: payment.value, rail: "native", call: payment.call, to: payment.to,
    })),
    ...mints.map((log) => activityFromLog("registered", {
      ...fields(log),
      agent: log.transactionHash === null ? undefined : agents.get(log.transactionHash),
      identity: log.eventName === "Transfer" ? log.args.tokenId : undefined,
    })),
    ...keyRows(keys, fields),
  ].filter((item): item is Activity => item !== null);
}

/** When a block was made, for saying how far back the feed reaches. */
export async function blockTime(blockNumber: bigint, network: NetworkProfile = ARC_TESTNET): Promise<number> {
  return Number((await clientFor(network).getBlock({ blockNumber })).timestamp);
}

/** Where a wallet's feed is kept on the phone. */
const FEED_KEY_PREFIX = "arc.activity.";

/**
 * The key one wallet's feed on one network is kept under. The same passkey is the same address on
 * every network, so the network is part of the key; Arc's keeps the key it always had, so a feed this
 * phone already kept is still found.
 */
export function feedKeyOf(network: NetworkProfile, address: Address): string {
  const wallet = address.toLowerCase();
  return network.chainId === ARC_TESTNET.chainId ? `${FEED_KEY_PREFIX}${wallet}` : `${FEED_KEY_PREFIX}${network.circlePath}:${wallet}`;
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
  /** Which call of its operation, on a paid row read from calldata. */
  readonly c?: number;
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
      ...(item.call === undefined ? {} : { c: item.call }),
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
    amount: units === null ? null : Amount.fromNativeUnits(units),
    at: r.t,
    block,
    tx: r.h,
    logIndex: r.i,
    ...(kind === "granted" && typeof r.g === "string" && isHash(r.g) ? { tag: r.g } : {}),
    ...(kind === "paid" && typeof r.p === "string" && isAddress(r.p) ? { to: r.p } : {}),
    ...(kind === "paid" && typeof r.c === "number" && Number.isInteger(r.c) && r.c >= 0 ? { call: r.c } : {}),
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
