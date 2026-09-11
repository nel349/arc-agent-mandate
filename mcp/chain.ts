import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  createPublicClient, defineChain, formatEther, http, parseAbi, parseAbiItem,
  type Address,
} from "viem";
import { isPairingCode, pairingTag } from "./pairing.ts";

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

/**
 * A pairing code the agent has shown, and how far the chain has been read for a grant carrying it.
 *
 * No grant can carry a code before the code was shown, so where it was shown is the floor of the
 * search, and a search never walks the chain's history. The floor used to be the plugin's deployment
 * block for every lookup, which is how the first thing a new user asked could cost ninety requests.
 */
interface Pairing {
  readonly code: string;
  /** The head when the code was first shown. Null when the chain could not be read at the time. */
  readonly shownAt: bigint | null;
  /** The last block read for its grant, so an interrupted search resumes rather than restarts. */
  readonly searchedTo: bigint | null;
}

/** What we remember about an agent between runs. */
interface Remembered {
  /** The wallet whose grant this agent spends from. */
  readonly account: Address | null;
  /**
   * The pairing code that wallet's grant carried. Null for a wallet remembered from before grants
   * carried one, which counts as no pairing at all: see `findGrant`.
   */
  readonly accountCode: string | null;
  /** The code the agent shows now. While it differs from `accountCode`, a grant may be on its way. */
  readonly pairing: Pairing | null;
}

/**
 * Everything the agent needs to know about the chain, discovered rather than configured.
 *
 * The agent is told nothing at pairing time except that it was granted something. It finds the
 * account that granted it by watching for `SessionKeyAdded` naming its own address and carrying its
 * pairing code. Both arguments are indexed, which is what makes one query enough and spares the user
 * a second round trip.
 */
export const ARC_RPC = process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
export const SESSION_KEY_PLUGIN =
  process.env.ARC_SESSION_KEY_PLUGIN ?? "0x669Dd1eDb85ABD00f74186d88124614EE81E6670";

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
 * The RPC caps `eth_getLogs` at 10,000 blocks, so a search is read a window at a time. It fails
 * outright past the cap rather than returning less, and a node forwards an oversized query upstream
 * to be rate-limited, which fails the whole lookup.
 */
const LOG_WINDOW = 9_999n;

/**
 * How far back to look when the chain could not be read at the moment the code was shown.
 *
 * A grant follows its code within minutes, so three windows, a few hours on Arc, is a generous
 * stand-in for the block the code would have been shown at.
 */
const RECENT = LOG_WINDOW * 3n;

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
 * A wallet named by hand in `ARC_ACCOUNT`, which takes the place of pairing.
 *
 * For someone who points the connector at their own wallet deliberately. It is still checked against
 * the chain before every use.
 */
const configured = process.env.ARC_ACCOUNT;
const PINNED: Address | null = isAddress(configured) ? configured : null;

/** Where this agent's spending comes from, or why there is none. */
export type Grant =
  /** A grant carrying this agent's code, still installed. It may have expired: the allowance says. */
  | { readonly status: "granted"; readonly account: Address }
  /** The wallet this agent was paired with has revoked it. */
  | { readonly status: "withdrawn"; readonly account: Address }
  /**
   * No grant carries this agent's code. `legacy` is a wallet remembered from before grants carried
   * one: it may hold a live allowance, but nothing ties it to this agent's owner, so it is not
   * spent from.
   */
  | { readonly status: "unpaired"; readonly legacy: Address | null };

/**
 * The pairing code to show, issuing a fresh one when there is none or the current one has been used.
 *
 * The same code is shown every time until a grant carrying it is found, so asking twice does not
 * spoil a code already on somebody's screen. Once one has been used, the next one shown is new, and a
 * grant carrying it moves the agent to that wallet: showing the code again is how an owner switches.
 */
export async function pairingToShow(agentAddress: Address): Promise<string> {
  const state = readState(agentAddress);
  if (state.pairing !== null && state.pairing.code !== state.accountCode) return state.pairing.code;

  const code = randomBytes(16).toString("hex");
  let shownAt: bigint | null = null;
  try {
    shownAt = await publicClient.getBlockNumber({ cacheTime: 0 });
  } catch {
    // Unknown for now. The first search that can read the head sets a floor just below it.
  }
  writeState(agentAddress, { pairing: { code, shownAt, searchedTo: null } });
  return code;
}

/**
 * Which wallet this agent may spend from, decided by the chain and the code it showed.
 *
 * Only a grant carrying the agent's pairing code counts, and of those the first one made wins, so a
 * copy made after the owner's grant cannot displace it. A grant carrying a newer code replaces the
 * remembered wallet, because showing a new code and scanning it is how an owner switches on purpose;
 * but not when that grant is already unusable and the remembered one still works. A live allowance
 * is never given up for an expired or revoked one.
 *
 * Always read from the chain rather than trusted from memory: a remembered grant may have been
 * revoked while the agent was not running.
 */
export async function findGrant(agentAddress: Address): Promise<Grant> {
  if (PINNED !== null) {
    return (await installed(PINNED, agentAddress))
      ? { status: "granted", account: PINNED }
      : { status: "withdrawn", account: PINNED };
  }

  const state = readState(agentAddress);
  const paired = state.account !== null && state.accountCode !== null ? state.account : null;
  const pending = state.pairing !== null && state.pairing.code !== state.accountCode ? state.pairing : null;

  if (pending !== null) {
    const granter = await firstGrantCarrying(agentAddress, pending);
    if (granter !== null) {
      const fresh = await grantState(granter, agentAddress);
      const keepPaired = paired !== null && fresh !== "live" && (await grantState(paired, agentAddress)) === "live";
      if (!keepPaired) {
        writeState(agentAddress, { account: granter, accountCode: pending.code });
        return fresh === "removed"
          ? { status: "withdrawn", account: granter }
          : { status: "granted", account: granter };
      }
    }
  }

  if (paired !== null) {
    return (await installed(paired, agentAddress))
      ? { status: "granted", account: paired }
      : { status: "withdrawn", account: paired };
  }
  return { status: "unpaired", legacy: state.account };
}

/**
 * The first wallet to grant this agent with the code it showed, or null if none has yet.
 *
 * Read forwards from where the code was shown, a window at a time and oldest first, so the first
 * grant made is the first found. Progress is recorded after every window, so a search cut off by a
 * rate limit resumes where it stopped instead of starting again and failing in the same place.
 */
async function firstGrantCarrying(agentAddress: Address, pairing: Pairing): Promise<Address | null> {
  // The head as it is now, never viem's copy from up to four seconds ago. A grant made just after one
  // check was otherwise past the end of the next search, and "grant, then check once" came back as
  // the old wallet; found on a fork, in integration/pairing.test.ts.
  const head = await publicClient.getBlockNumber({ cacheTime: 0 });
  let shownAt = pairing.shownAt;
  if (shownAt === null) {
    shownAt = head > RECENT ? head - RECENT : 0n;
    writeState(agentAddress, { pairing: { ...pairing, shownAt } });
  }
  const tag = pairingTag(pairing.code);

  let from = pairing.searchedTo === null ? shownAt : pairing.searchedTo + 1n;
  while (from <= head) {
    const to = from + LOG_WINDOW < head ? from + LOG_WINDOW : head;
    const logs = await publicClient.getLogs({
      address: SESSION_KEY_PLUGIN, event: grantedEvent,
      args: { sessionKey: agentAddress, tag }, fromBlock: from, toBlock: to,
    });
    // In the order they happened, so the first grant carrying the code is the one returned.
    for (const log of logs) {
      // Indexed arguments are optional in viem's type because a log that fails to decode still
      // arrives. Skipping one is right: a grant we cannot read is not a grant we should trust.
      if (log.args.account !== undefined) return log.args.account;
    }
    writeState(agentAddress, { pairing: { code: pairing.code, shownAt, searchedTo: to } });
    from = to + 1n;
  }
  return null;
}

/** Whether a wallet's grant to this agent can be spent now, has lapsed, or is gone. */
type GrantState = "live" | "unusable" | "removed";

async function grantState(account: Address, agentAddress: Address): Promise<GrantState> {
  if (!(await installed(account, agentAddress))) return "removed";
  // An expired grant leaves the session key installed, so installation alone says it is healthy.
  const [validAfter, validUntil] = await publicClient.readContract({
    address: SESSION_KEY_PLUGIN, abi: pluginAbi, functionName: "getKeyTimeRange",
    args: [account, agentAddress],
  });
  const now = Math.floor(Date.now() / 1000);
  // Zero means "no bound" at either end; see `readAllowance`.
  const expired = validUntil !== 0 && now >= validUntil;
  const notYet = validAfter !== 0 && now < validAfter;
  return expired || notYet ? "unusable" : "live";
}

/**
 * The wallet this agent was last paired with, whether or not it still grants.
 *
 * Only ever used to *explain* a lookup that could not be made. "Nobody has granted me anything" and
 * "what I was granted has been taken away" are the same absence to the code and completely
 * different sentences to a person.
 */
export function rememberedGranter(agentAddress: Address): Address | null {
  return readState(agentAddress).account;
}

/** Whether the session key is installed on the account. Says nothing about expiry. */
function installed(account: Address, agentAddress: Address): Promise<boolean> {
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
 * Where what the agent knows is kept, beside the agent's key.
 *
 * Keyed by agent address, so a machine that has run more than one agent does not hand the wrong
 * account to whichever started last.
 */
const MEMORY_PATH =
  process.env.ARC_MANDATE_ACCOUNT_PATH ?? join(homedir(), ".arc-mandate", "accounts.json");

const NOTHING_KNOWN: Remembered = { account: null, accountCode: null, pairing: null };

/**
 * What is known about one agent. A cache of the chain plus the code it showed: a lookup still works
 * without it, but a pairing code lost here has to be shown and scanned again.
 *
 * Older files hold a bare address, or an account with the stretch of chain a search had read. Both
 * are from before grants carried a pairing code, so they read as a wallet with no pairing.
 */
function readState(agentAddress: Address): Remembered {
  try {
    const all: unknown = JSON.parse(readFileSync(MEMORY_PATH, "utf8"));
    if (!isRecord(all)) return NOTHING_KNOWN;
    const entry = all[agentAddress.toLowerCase()];
    if (isAddress(entry)) return { ...NOTHING_KNOWN, account: entry }; // oldest format
    if (isRecord(entry)) {
      const account = entry["account"];
      const accountCode = entry["accountCode"];
      return {
        account: isAddress(account) ? account : null,
        accountCode: typeof accountCode === "string" && isPairingCode(accountCode) ? accountCode : null,
        pairing: readPairing(entry["pairing"]),
      };
    }
  } catch {
    // Absent, unreadable, or not JSON: nothing is known yet.
  }
  return NOTHING_KNOWN;
}

function readPairing(value: unknown): Pairing | null {
  if (!isRecord(value)) return null;
  const code = value["code"];
  if (typeof code !== "string" || !isPairingCode(code)) return null;
  const block = (field: unknown): bigint | null =>
    typeof field === "string" && /^\d+$/.test(field) ? BigInt(field) : null;
  return { code, shownAt: block(value["shownAt"]), searchedTo: block(value["searchedTo"]) };
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
      ...(patch.accountCode === undefined ? {} : { accountCode: patch.accountCode }),
      // Blocks written as strings, because a bigint is not JSON and `JSON.stringify` throws on one.
      ...(patch.pairing === undefined
        ? {}
        : {
            pairing: patch.pairing === null ? null : {
              code: patch.pairing.code,
              shownAt: patch.pairing.shownAt === null ? null : String(patch.pairing.shownAt),
              searchedTo: patch.pairing.searchedTo === null ? null : String(patch.pairing.searchedTo),
            },
          }),
    };
    mkdirSync(dirname(MEMORY_PATH), { recursive: true, mode: 0o700 });
    writeFileSync(MEMORY_PATH, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // Losing this costs a slower lookup next time, or a code shown again.
  }
}
