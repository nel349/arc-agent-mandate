import { createPublicClient, encodeFunctionData, formatEther, http, parseAbi } from "viem";

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

export const publicClient = createPublicClient({ transport: http(ARC_RPC) });

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
  : null;
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

export function encodeSpend({ to, value, agentAddress }) {
  return encodeFunctionData({
    abi: pluginAbi, functionName: "executeWithSessionKey",
    args: [[{ target: to, value, data: "0x" }], agentAddress],
  });
}
