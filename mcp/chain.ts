import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  createPublicClient, defineChain, formatEther, http, parseAbi, parseAbiItem,
  type Address,
} from "viem";

/** Which meter bounds a mandate. Named so the two strings cannot be spelled wrong in four places. */
export type Rail = "native" | "erc20";

export interface Allowance {
  readonly limit: string;
  readonly spent: string;
  readonly remaining: string;
  readonly remainingWei: bigint;
  readonly walletBalance: string;
  readonly walletBalanceWei: bigint;
  /** Unix seconds, or null when the mandate never expires. */
  readonly expiresAt: number | null;
  readonly expired: boolean;
  readonly notYet: boolean;
  readonly spendable: string;
  readonly spendableWei: bigint;
  readonly rail: Rail;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isAddress = (value: unknown): value is Address =>
  typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);

/** What we remember about an agent between runs. A cache: a lookup still works without it. */
interface Remembered {
  readonly account: Address | null;
  /**
   * The stretch of chain already read, so an interrupted search resumes rather than restarts.
   *
   * An interval rather than a high-water mark, and that distinction is the whole point. The search
   * runs head-downwards, so being cut off part way leaves the *top* read and the bottom unread —
   * which a single number cannot express without claiming the bottom was covered. Recorded as a
   * span, progress survives whatever stopped it: a rate limit, a timeout, a closed laptop.
   */
  readonly searched: { readonly low: bigint; readonly high: bigint } | null;
}

/**
 * Everything the agent needs to know about the chain, discovered rather than configured.
 *
 * The agent is told nothing at pairing time except that it was granted something. It finds the
 * account that granted it by watching for `SessionKeyAdded` naming its own address — the event's
 * `sessionKey` argument is indexed, which is what makes a single scan enough and spares the user
 * a second round trip.
 */
export const ARC_RPC = process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
export const SESSION_KEY_PLUGIN =
  process.env.ARC_SESSION_KEY_PLUGIN ?? "0x669Dd1eDb85ABD00f74186d88124614EE81E6670";

/**
 * The block the plugin was deployed in, so a search has a floor that is true rather than recent.
 *
 * No grant can predate it. Shipped as a constant because the default without one was a rolling
 * 50,000-block window, and Arc produces **167,669 blocks a day** at roughly half a second each —
 * so a grant became unfindable about seven hours after it was made. That is not a corner case;
 * it is every agent, by the next morning.
 */
const PLUGIN_DEPLOY_BLOCK = 60_625_268n;

/**
 * Arc, described rather than just dialled.
 *
 * viem needs a chain id on the client for anything account-abstraction shaped — a user operation
 * hash is bound to the chain, so an unnamed client fails with `Cannot read properties of
 * undefined (reading 'id')` at the moment it tries to sign.
 */
export const arc = defineChain({
  id: Number(process.env.ARC_CHAIN_ID ?? 5042002),
  name: "Arc testnet",
  // Arc's native token is USDC, at 18 decimals natively and 6 through the ERC-20 view.
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
});

export const publicClient = createPublicClient({ chain: arc, transport: http(ARC_RPC) });

export const pluginAbi = parseAbi([
  "event SessionKeyAdded(address indexed account, address indexed sessionKey, bytes32 indexed tag)",
  "event SessionKeyRemoved(address indexed account, address indexed sessionKey)",
  "function isSessionKeyOf(address account, address sessionKey) view returns (bool)",
  "function getNativeTokenSpendLimitInfo(address account, address sessionKey) view returns ((bool hasLimit, uint256 limit, uint256 limitUsed, uint48 refreshInterval, uint48 lastUsedTime))",
  "function getKeyTimeRange(address account, address sessionKey) view returns (uint48 validAfter, uint48 validUntil)",
  "function getERC20SpendLimitInfo(address account, address sessionKey, address token) view returns ((bool hasLimit, uint256 limit, uint256 limitUsed, uint48 refreshInterval, uint48 lastUsedTime))",
  "function executeWithSessionKey((address target,uint256 value,bytes data)[] calls, address sessionKey) returns (bytes[])",
]);

/**
 * The RPC caps `eth_getLogs` at 10,000 blocks, so scanning from genesis is not an option — it
 * fails outright rather than returning less. Grants are recent by nature, so the search walks
 * backwards from the head a window at a time.
 */
const LOG_WINDOW = 9_999n;

/**
 * The floor for the search. No grant can predate the plugin's deployment, so that block is the
 * honest bound — and scanning past it is not merely wasteful: a node will forward the query
 * upstream and be rate-limited, which fails the whole lookup rather than returning nothing.
 *
 * Set `ARC_PLUGIN_FROM_BLOCK` to the deployment block. Without it, the search covers a recent
 * window only, which is enough for a freshly granted agent but will miss an old grant — so a
 * long-lived deployment should always set it.
 */
const DEPLOY_BLOCK = process.env.ARC_PLUGIN_FROM_BLOCK
  ? BigInt(process.env.ARC_PLUGIN_FROM_BLOCK)
  : PLUGIN_DEPLOY_BLOCK;
/**
 * Declared standalone rather than found in the ABI array.
 *
 * `pluginAbi.find(...)` returns the union of every entry, so viem could not tell that the logs it
 * decodes carry `args` — the event's own shape was lost the moment it went through a `find`.
 */
const grantedEvent = parseAbiItem(
  "event SessionKeyAdded(address indexed account, address indexed sessionKey, bytes32 indexed tag)",
);

/**
 * The account that granted this agent, or null if nobody has yet.
 *
 * Cached once found: a long-lived agent should not re-scan the chain on every call, and the
 * account that granted it does not change. Revocation is caught by `isSessionKeyOf` below, not by
 * forgetting who the account was.
 */
let cachedAccount: Address | null = (process.env.ARC_ACCOUNT as Address | undefined) ?? null;

export async function findGrantingAccount(
  agentAddress: Address,
  { keyIsNew = false }: { keyIsNew?: boolean } = {},
): Promise<Address | null> {
  if (cachedAccount && (await stillGranted(cachedAccount, agentAddress))) return cachedAccount;
  cachedAccount = null;

  // Always re-checked against the chain before use: a remembered grant may have been revoked while
  // the agent was not running, and acting on a stale one would fail at validation with a confusing
  // reason rather than an honest "nobody has granted me anything".
  const state = readState(agentAddress);
  if (state.account && (await stillGranted(state.account, agentAddress))) {
    cachedAccount = state.account;
    return cachedAccount;
  }

  const head = await publicClient.getBlockNumber();

  /**
   * Where to stop searching downwards.
   *
   * A key generated moments ago cannot have been granted anything earlier, so there is no history
   * worth reading — the floor is the head and the first lookup costs one request instead of
   * hundreds. Otherwise resume from wherever a previous fruitless search got to, and fall back to
   * the plugin's deployment only when nothing is known, which happens once per install.
   */
    const bottom = DEPLOY_BLOCK ?? 0n;
    let searched = state.searched;

    // A key generated moments ago cannot have been granted anything earlier, so there is no history
    // worth reading and the first lookup costs one request instead of hundreds.
    if (keyIsNew && searched === null) searched = { low: head, high: head };

    /**
     * Where to read, newest first: the blocks added since the last look, then — when the bottom was
     * never reached — onwards down towards the plugin's deployment.
     *
     * Two spans rather than one, because the stretch already read sits in the middle: everything
     * above it is new and everything below it was never reached, which is exactly the shape a
     * search cut off part way through leaves behind.
     */
    /**
     * Where to read, and in which direction — and the direction is the load-bearing part.
     *
     * The stretch already read sits in the middle: new blocks above it, unreached history below.
     * Each is walked *away from* what is known, so every window is adjacent to the covered span and
     * the record stays one unbroken interval. Walking the upper span downwards from the head
     * instead leaves a gap between the head and the known high — and a single interval cannot
     * describe a gap, so it would have to claim the middle was read when it was not, which is how
     * a grant sitting in it becomes invisible. That is not hypothetical: the first version of this
     * did exactly that, and recorded the whole history as read after one window.
     *
     * Newest-first within a window still holds, and correctness across windows does not depend on
     * their order anyway: every candidate is checked against the chain before it is believed, so an
     * older grant that has since been revoked is discarded rather than returned.
     */
    const spans: readonly { readonly from: bigint; readonly to: bigint; readonly upward: boolean }[] =
      searched === null
        ? [{ from: bottom, to: head, upward: false }]
        : [
            ...(head > searched.high ? [{ from: searched.high, to: head, upward: true }] : []),
            ...(searched.low > bottom ? [{ from: bottom, to: searched.low, upward: false }] : []),
          ];

    /**
     * Recorded after every window rather than once at the end, which is the fix.
     *
     * Recording only on completion meant a search that could not finish remembered nothing, so the
     * next call started from scratch and failed in the same place — and every day's blocks made it
     * worse. Against a rate-limited endpoint that is not a slow path but a wall: the note above
     * this function predicted "pairing simply never completes", and that is what arrived.
     */
    const cover = (low: bigint, high: bigint): void => {
      searched = searched === null ? { low, high } : {
        low: low < searched.low ? low : searched.low,
        high: high > searched.high ? high : searched.high,
      };
      writeState(agentAddress, { searched });
    };

    for (const span of spans) {
      let edge = span.upward ? span.from : span.to;
      while (span.upward ? edge < span.to : edge > span.from) {
        const from = span.upward
          ? edge
          : (edge > span.from + LOG_WINDOW ? edge - LOG_WINDOW : span.from);
        const to = span.upward
          ? (edge + LOG_WINDOW < span.to ? edge + LOG_WINDOW : span.to)
          : edge;

        const logs = await publicClient.getLogs({
          address: SESSION_KEY_PLUGIN, event: grantedEvent,
          args: { sessionKey: agentAddress }, fromBlock: from, toBlock: to,
        });
        for (const log of logs.reverse()) {
          // Indexed arguments are optional in viem's type because a log that fails to decode still
          // arrives. Skipping one is right: a grant we cannot read is not a grant we should trust.
          const granter = log.args.account;
          if (granter === undefined) continue;
          if (await stillGranted(granter, agentAddress)) {
            cachedAccount = granter;
            writeState(agentAddress, { account: granter });
            return granter;
          }
        }
        cover(from, to);
        edge = span.upward ? to : from;
      }
    }

  return null;
}

function stillGranted(account: Address, agentAddress: Address): Promise<boolean> {
  return publicClient.readContract({
    address: SESSION_KEY_PLUGIN, abi: pluginAbi, functionName: "isSessionKeyOf",
    args: [account, agentAddress],
  });
}

/** What the agent has left to spend, read from the account rather than remembered. */
/**
 * What the agent can actually spend, which is not the same as what it was granted.
 *
 * Three things bound a payment, and reading only the first is how an agent ends up promising a
 * purchase it cannot make:
 *
 * - **The limit**, minus what has already been spent. The obvious one.
 * - **The wallet's balance.** An allowance of 20 against a wallet holding 5 can spend 5. Reporting
 *   the allowance alone told an agent it had 19.89 available when the account held 4.86.
 * - **The time range.** An expired mandate leaves the session key installed, so every check short
 *   of reading `validUntil` says the allowance is healthy — and the chain then refuses the payment
 *   for a reason the agent has no way to explain.
 *
 * `spendable` is the smallest of them, and is what anything deciding whether a payment can be made
 * should use. The parts are reported alongside it so a refusal can say *which* bound was hit.
 */
/**
 * Arc's dollar at two scales: 18 decimals natively, 6 through the ERC-20 view, one balance.
 * Everything below works in native units so one set of numbers reaches the tools.
 */
export const NATIVE_PER_ERC20 = 10n ** 12n;

/** The ERC-20 view of USDC, which is the rail an unscoped mandate meters everything on. */
export const USDC_ERC20_VIEW = "0x3600000000000000000000000000000000000000";

/**
 * Which meter bounds a mandate, as values rather than bare strings.
 *
 * These two decide which limit is read and which rail a payment has to travel. Spelled inline they
 * are just strings, and every way of getting one wrong is silent — a payment on the unmetered rail
 * is refused by the chain, and a limit read from the wrong meter reports zero against a live
 * mandate. `src/arc/mandate.ts` names the same pair as a type for the app.
 */
export const RAIL: Readonly<Record<Rail, Rail>> = Object.freeze({ native: "native", erc20: "erc20" });

export async function readAllowance(account: Address, agentAddress: Address): Promise<Allowance> {
  const [nativeInfo, range, balance, erc20Info] = await Promise.all([
    publicClient.readContract({
      address: SESSION_KEY_PLUGIN, abi: pluginAbi, functionName: "getNativeTokenSpendLimitInfo",
      args: [account, agentAddress],
    }),
    publicClient.readContract({
      address: SESSION_KEY_PLUGIN, abi: pluginAbi, functionName: "getKeyTimeRange",
      args: [account, agentAddress],
    }),
    publicClient.getBalance({ address: account }),
    publicClient.readContract({
      address: SESSION_KEY_PLUGIN, abi: pluginAbi, functionName: "getERC20SpendLimitInfo",
      args: [account, agentAddress, USDC_ERC20_VIEW],
    }),
  ]);

  // Which meter is in force, read rather than assumed. An unscoped mandate routes everything —
  // payments and x402 escrow alike — through the ERC-20 rail, so that one limit is the whole
  // allowance. A mandate that named payees is metered natively, where naming them means something.
  // Mandates granted before the ERC-20 shape existed are all native, so both must be handled.
  const onErc20 = erc20Info.hasLimit;
  const info = onErc20
    ? { limit: erc20Info.limit * NATIVE_PER_ERC20, limitUsed: erc20Info.limitUsed * NATIVE_PER_ERC20 }
    : nativeInfo;

  const remaining = info.limitUsed >= info.limit ? 0n : info.limit - info.limitUsed;
  const [validAfter, validUntil] = range;
  const now = BigInt(Math.floor(Date.now() / 1000));

  // Zero means "no bound" for both ends, which is how the plugin encodes an open range.
  // `uint48` comes back from viem as a **number**, not a bigint. Comparing it to `0n` is always
  // unequal, so the "no bound" case never fired: a mandate granted without an expiry read as
  // expired, and reported its expiry as 1970. The app got this right; this file was never
  // typechecked, which is how the two drifted apart.
  const expired = validUntil !== 0 && now >= BigInt(validUntil);
  const notYet = validAfter !== 0 && now < BigInt(validAfter);
  const usable = !expired && !notYet;

  const spendable = usable ? (remaining < balance ? remaining : balance) : 0n;

  return {
    limit: formatEther(info.limit),
    spent: formatEther(info.limitUsed),
    remaining: formatEther(remaining),
    remainingWei: remaining,
    walletBalance: formatEther(balance),
    walletBalanceWei: balance,
    expiresAt: validUntil === 0 ? null : validUntil,
    expired,
    notYet,
    /** The real ceiling on the next payment: the smallest of limit-left and wallet balance, or zero. */
    spendable: formatEther(spendable),
    spendableWei: spendable,
    /** Which rail a payment has to travel to be seen by the meter above. */
    rail: onErc20 ? RAIL.erc20 : RAIL.native,
  };
}


/**
 * Where the discovered account is kept, beside the agent's key.
 *
 * Keyed by agent address, so a machine that has run more than one agent does not hand the wrong
 * account to whichever started last.
 */
const MEMORY_PATH =
  process.env.ARC_MANDATE_ACCOUNT_PATH ?? join(homedir(), ".arc-mandate", "accounts.json");

/**
 * What is known about one agent: the account that granted it, and how far the chain has been
 * searched for that grant.
 *
 * The second half is what keeps an unpaired agent usable. Searching is head-downwards and stops at
 * the first hit, so an agent that *has* been granted something is cheap to resolve. One that has
 * **not** finds nothing and therefore walks the entire history, every single call — and Arc mints
 * 167,669 blocks a day against a 10,000-block cap on `eth_getLogs`. Measured against the live
 * chain: eight requests today, twenty-four tomorrow, and five hundred within a month, by which
 * point the very first thing a new user does exceeds their client's timeout and pairing simply
 * never completes.
 *
 * So a search that finds nothing records how far it got, and the next one resumes from there.
 * A newly generated key skips the history altogether: it cannot have been granted anything before
 * it existed.
 */
function readState(agentAddress: Address): Remembered {
  try {
    const all: unknown = JSON.parse(readFileSync(MEMORY_PATH, "utf8"));
      if (!isRecord(all)) return { account: null, searched: null };
      const entry = all[agentAddress.toLowerCase()];
      if (isAddress(entry)) return { account: entry, searched: null }; // oldest format
      if (isRecord(entry)) {
        const account = entry["account"];
        return {
          account: isAddress(account) ? account : null,
          searched: readSearched(entry),
        };
      }
  } catch {
    // Absent, unreadable, or not JSON. This is a cache: a lookup still works without it.
  }
  return { account: null, searched: null };
}

/**
 * The span already read, from either shape this file has had.
 *
 * The previous format stored one number meaning "everything below here has been read", which is the
 * completed case of a span — so an old file migrates without a rewrite, and an agent that upgrades
 * mid-search keeps whatever it had got through.
 */
function readSearched(entry: Record<string, unknown>): Remembered["searched"] {
  const span = entry["searched"];
  if (isRecord(span)) {
    const low = span["low"];
    const high = span["high"];
    if (typeof low === "string" && typeof high === "string") {
      return { low: BigInt(low), high: BigInt(high) };
    }
  }
  const through = entry["searchedThrough"];
  if (typeof through === "string") return { low: DEPLOY_BLOCK ?? 0n, high: BigInt(through) };
  return null;
}

function writeState(agentAddress: Address, patch: Partial<Remembered>): void {
  try {
    let all: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(readFileSync(MEMORY_PATH, "utf8"));
      if (isRecord(parsed)) all = parsed;
    } catch {
      // First write, or a file worth replacing.
    }
    const key = agentAddress.toLowerCase();
    const existing = all[key];
    const previous: Record<string, unknown> =
      isAddress(existing) ? { account: existing } : isRecord(existing) ? existing : {};
    all[key] = {
      ...previous,
        ...(patch.account === undefined ? {} : { account: patch.account }),
        // Written as strings, because a bigint is not JSON — and taken from the patch by name
        // rather than spread, so a bigint can never reach `JSON.stringify` and throw.
        ...(patch.searched === undefined || patch.searched === null
          ? {}
          : { searched: { low: String(patch.searched.low), high: String(patch.searched.high) } }),
    };
    mkdirSync(dirname(MEMORY_PATH), { recursive: true, mode: 0o700 });
    writeFileSync(MEMORY_PATH, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // Losing this costs a slower lookup next time and nothing else.
  }
}


