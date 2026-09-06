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

export async function findGrantingAccount(agentAddress) {
  if (cachedAccount && (await stillGranted(cachedAccount, agentAddress))) return cachedAccount;
  cachedAccount = null;

  // Remembered across restarts, because the search does not get cheaper with time. Arc produces
  // about 167,000 blocks a day and `eth_getLogs` is capped at 10,000 a call, so scanning from the
  // plugin's deployment costs six requests today and several hundred within a month. Finding the
  // account once is the difference between an agent that starts and one that eventually times out.
  //
  // Always re-checked against the chain before use: a remembered grant may have been revoked while
  // the agent was not running, and acting on a stale one would fail at validation with a confusing
  // reason rather than an honest "nobody has granted me anything".
  const remembered = readRemembered(agentAddress);
  if (remembered && (await stillGranted(remembered, agentAddress))) {
    cachedAccount = remembered;
    return cachedAccount;
  }

  const head = await publicClient.getBlockNumber();
  const floor = DEPLOY_BLOCK ?? (head > DEFAULT_LOOKBACK ? head - DEFAULT_LOOKBACK : 0n);

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
        remember(agentAddress, cachedAccount);
        return cachedAccount;
      }
    }
    if (from === floor) break;
  }
  return null;
}

function stillGranted(account, agentAddress) {
  return publicClient.readContract({
    address: SESSION_KEY_PLUGIN, abi: pluginAbi, functionName: "isSessionKeyOf",
    args: [account, agentAddress],
  });
}

/** What the agent has left to spend, read from the account rather than remembered. */
export async function readAllowance(account, agentAddress) {
  const info = await publicClient.readContract({
    address: SESSION_KEY_PLUGIN, abi: pluginAbi, functionName: "getNativeTokenSpendLimitInfo",
    args: [account, agentAddress],
  });
  const remaining = info.limitUsed >= info.limit ? 0n : info.limit - info.limitUsed;
  return {
    limit: formatEther(info.limit),
    spent: formatEther(info.limitUsed),
    remaining: formatEther(remaining),
    remainingWei: remaining,
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

function readRemembered(agentAddress) {
  try {
    const all = JSON.parse(readFileSync(MEMORY_PATH, "utf8"));
    const found = all[agentAddress.toLowerCase()];
    return /^0x[0-9a-fA-F]{40}$/.test(found ?? "") ? found : null;
  } catch {
    // No file, unreadable, or not JSON. This is a cache: the search still works without it, and
    // failing to read one must never stop an agent from finding its account the slow way.
    return null;
  }
}

function remember(agentAddress, account) {
  try {
    let all = {};
    try {
      all = JSON.parse(readFileSync(MEMORY_PATH, "utf8"));
    } catch {
      // First write, or a file worth replacing.
    }
    all[agentAddress.toLowerCase()] = account;
    mkdirSync(dirname(MEMORY_PATH), { recursive: true, mode: 0o700 });
    writeFileSync(MEMORY_PATH, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // Losing the cache costs a slower start next time and nothing else.
  }
}
