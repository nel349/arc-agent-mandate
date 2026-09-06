import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createPublicClient, defineChain, encodeFunctionData, formatEther, http, parseAbi } from "viem";

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
const DEFAULT_LOOKBACK = 50_000n;

const grantedEvent = pluginAbi.find((e) => e.type === "event" && e.name === "SessionKeyAdded");

/**
 * The account that granted this agent, or null if nobody has yet.
 *
 * Cached once found: a long-lived agent should not re-scan the chain on every call, and the
 * account that granted it does not change. Revocation is caught by `isSessionKeyOf` below, not by
 * forgetting who the account was.
 */
let cachedAccount = process.env.ARC_ACCOUNT ?? null;

export async function findGrantingAccount(agentAddress, { keyIsNew = false } = {}) {
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
  const previouslySearched = state.searchedThrough;
  const bottom = DEPLOY_BLOCK ?? 0n;
  const floor = keyIsNew && previouslySearched === null
    ? head
    : previouslySearched !== null && previouslySearched > bottom
      ? previouslySearched
      : bottom;

  for (let to = head; to > floor; to -= LOG_WINDOW + 1n) {
    const from = to > floor + LOG_WINDOW ? to - LOG_WINDOW : floor;
    const logs = await publicClient.getLogs({
      address: SESSION_KEY_PLUGIN, event: grantedEvent,
      args: { sessionKey: agentAddress }, fromBlock: from, toBlock: to,
    });
    // Newest first within the window: a key can be revoked and re-granted, and only a grant that
    // still stands counts.
    for (const log of logs.reverse()) {
      if (await stillGranted(log.args.account, agentAddress)) {
        cachedAccount = log.args.account;
        writeState(agentAddress, { account: cachedAccount });
        return cachedAccount;
      }
    }
    if (from === floor) break;
  }

  // Nothing here. Record how far this got, so the next lookup reads only what the chain has added
  // since rather than starting over — which is what made an unpaired agent slower every day.
  writeState(agentAddress, { searchedThrough: head });
  return null;
}

function stillGranted(account, agentAddress) {
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
export const RAIL = Object.freeze({ native: "native", erc20: "erc20" });

export async function readAllowance(account, agentAddress) {
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
  const expired = validUntil !== 0n && now >= validUntil;
  const notYet = validAfter !== 0n && now < validAfter;
  const usable = !expired && !notYet;

  const spendable = usable ? (remaining < balance ? remaining : balance) : 0n;

  return {
    limit: formatEther(info.limit),
    spent: formatEther(info.limitUsed),
    remaining: formatEther(remaining),
    remainingWei: remaining,
    walletBalance: formatEther(balance),
    walletBalanceWei: balance,
    expiresAt: validUntil === 0n ? null : Number(validUntil),
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
function readState(agentAddress) {
  try {
    const all = JSON.parse(readFileSync(MEMORY_PATH, "utf8"));
    const entry = all[agentAddress.toLowerCase()];
    if (typeof entry === "string") return { account: entry, searchedThrough: null }; // older format
    if (entry && typeof entry === "object") {
      return {
        account: /^0x[0-9a-fA-F]{40}$/.test(entry.account ?? "") ? entry.account : null,
        searchedThrough:
          typeof entry.searchedThrough === "string" ? BigInt(entry.searchedThrough) : null,
      };
    }
  } catch {
    // Absent, unreadable, or not JSON. This is a cache: a lookup still works without it.
  }
  return { account: null, searchedThrough: null };
}

function writeState(agentAddress, patch) {
  try {
    let all = {};
    try {
      all = JSON.parse(readFileSync(MEMORY_PATH, "utf8"));
    } catch {
      // First write, or a file worth replacing.
    }
    const key = agentAddress.toLowerCase();
    const previous = typeof all[key] === "string" ? { account: all[key] } : (all[key] ?? {});
    all[key] = {
      ...previous,
      ...patch,
      ...(patch.searchedThrough === undefined
        ? {}
        : { searchedThrough: String(patch.searchedThrough) }),
    };
    mkdirSync(dirname(MEMORY_PATH), { recursive: true, mode: 0o700 });
    writeFileSync(MEMORY_PATH, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // Losing this costs a slower lookup next time and nothing else.
  }
}


