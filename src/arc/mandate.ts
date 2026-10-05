import { circleEscrow } from "../../mcp/gateway-balance.ts";
import {
  BaseError, ContractFunctionRevertedError, encodeFunctionData,
  parseAbi, parseAbiItem, parseEventLogs, toFunctionSelector,
  type Address, type Hash, type Hex, type Log,
} from "viem";
import { getUserOperationGasPrice } from "@circle-fin/modular-wallets-core";
import { clientFor, isDeployed } from "./client.ts";
import { ARC_CONTRACTS } from "./chain.ts";
// Type-only: erased at runtime, so this file never loads the passkey shim.
import type { ArcAccount } from "./account.ts";
import { Amount } from "./amount.ts";
import {
  ARC_TESTNET, GrantError, grantCallData, identityCalls, sendCorrectingGas, type NetworkProfile, SESSION_KEY_PLUGIN_MANIFEST_HASH as CORE_MANIFEST_HASH, type GrantTerms,
} from "@kuiralabs/mandate-core";

/**
 * Granting, reading and revoking a mandate.
 *
 * A mandate is bounded authority handed from the account to a **session key** — an ordinary
 * keypair an agent holds. The agent has no standing of its own: every payment it makes is a user
 * operation the account checks against the mandate, so exceeding the limit is refused by the chain
 * rather than by the agent's good behaviour.
 *
 * Three things about the shape here are not arbitrary:
 *
 * - **One meter, or a scoped rail.** Arc's dollar is native and also an ERC-20 view at `0x3600…`
 *   over the same balance. A mandate with no payees meters everything, payments and escrow
 *   `approve`s alike, on the ERC-20 view and leaves the native limit at zero
 *   (`meterEverythingOnOneRail`). A mandate that names payees stays on the native rail, where
 *   naming them means something. See `permissionUpdates` and `amount.ts`.
 * - **An allowlist of what an agent calls.** The key may reach the USDC view, the Gateway deposit
 *   and its own identity's two setup calls, and nothing else the wallet holds. See `IDENTITY_CALLS`.
 * - **Management is owner-only.** Granting, re-scoping and revoking each route to the account's
 *   passkey. The agent's own spending does not. That split is the product.
 * - **There is no direct-call path.** Circle's multisig implements no runtime validation, so
 *   every call below is a user operation. A passkey cannot sign a plain transaction anyway.
 */

/** Deployed deterministically via CREATE2, so the address is the same on every Arc network.
 *  Derived from the plugin's creation code — see `contracts/script/DeploySessionKeyPlugin.s.sol`. */
export const SESSION_KEY_PLUGIN: Address = "0x669Dd1eDb85ABD00f74186d88124614EE81E6670";

/**
 * The block the plugin was deployed in, on Arc testnet; each network's is in its profile.
 *
 * No grant, and so no payment under one, can be older, which makes it the honest floor for any
 * search of the plugin's history.
 */
export const SESSION_KEY_PLUGIN_DEPLOY_BLOCK = ARC_TESTNET.logs.floor;

/** `keccak256(abi.encode(pluginManifest()))`, which `installPlugin` verifies. Fixed by the
 *  plugin's build; `mandate.test.ts` pins it against the compiled contract so a change to the
 *  plugin cannot silently leave this stale. Print it with
 *  `forge script script/DeploySessionKeyPlugin.s.sol --sig "manifestHash()"`. */
export const SESSION_KEY_PLUGIN_MANIFEST_HASH: Hex = CORE_MANIFEST_HASH;


/**
 * Which meter bounds a mandate.
 *
 * A named type rather than the union written out wherever it is needed, because these two strings
 * decide which limit is read, which limit a change writes to, and which rail a payment travels.
 * Spelling one of them wrong is not a type error when the union is inline, and every consequence
 * of getting it wrong is silent.
 */
export type MandateRail = "native" | "erc20";

/**
 * `type(uint256).max`, the plugin's sentinel for "no limit".
 *
 * Setting a limit to this **disables** it rather than raising it, which is how a meter is turned
 * off when a mandate moves rails. One below it is therefore the highest real ceiling — which is
 * what an unbounded gas limit has to be, since an unset limit denies rather than allows.
 */
const NO_LIMIT = (1n << 256n) - 1n;

export class MandateError extends Error {
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options);
    this.name = "MandateError";
  }
}

const accountAbi = parseAbi([
  "function installPlugin(address plugin, bytes32 manifestHash, bytes pluginInstallData, (address plugin, uint8 functionId)[] dependencies)",
  "function getInstalledPlugins() view returns (address[])",
]);

const pluginAbi = parseAbi([
  "function addSessionKey(address sessionKey, bytes32 tag, bytes[] permissionUpdates)",
  "function removeSessionKey(address sessionKey, bytes32 predecessor)",
  "function updateKeyPermissions(address sessionKey, bytes[] updates)",
  "function sessionKeysOf(address account) view returns (address[])",
  "function isSessionKeyOf(address account, address sessionKey) view returns (bool)",
  "function findPredecessor(address account, address sessionKey) view returns (bytes32)",
  "function getNativeTokenSpendLimitInfo(address account, address sessionKey) view returns ((bool hasLimit, uint256 limit, uint256 limitUsed, uint48 refreshInterval, uint48 lastUsedTime))",
  "function getKeyTimeRange(address account, address sessionKey) view returns (uint48 validAfter, uint48 validUntil)",
  "function getERC20SpendLimitInfo(address account, address sessionKey, address token) view returns ((bool hasLimit, uint256 limit, uint256 limitUsed, uint48 refreshInterval, uint48 lastUsedTime))",
  // Never called; carried so that a revert arrives decoded by name instead of as a bare selector
  // nobody can read. Every loupe read raises it from one place, `_loadSessionKeyId`, and only when
  // the address has no key id under the account — so it says exactly one thing: not a session key
  // of this account.
  "error InvalidSessionKey(address sessionKey)",
]);

/** Circle's Gateway, for what is in an agent's escrow. */
const gatewayAbi = parseAbi([
  "function availableBalance(address token, address depositor) view returns (uint256)",
]);

const updatesAbi = parseAbi([
  "function updateAccessListAddressEntry(address contractAddress, bool isOnList, bool checkSelectors)",
  "function updateAccessListFunctionEntry(address contractAddress, bytes4 selector, bool isOnList)",
  "function setAccessListType(uint8 contractAccessControlType)",
  "function setNativeTokenSpendLimit(uint256 spendLimit, uint48 refreshInterval)",
  "function setERC20SpendLimit(address token, uint256 spendLimit, uint48 refreshInterval)",
  "function setGasSpendLimit(uint256 spendLimit, uint48 refreshInterval)",
  "function updateTimeRange(uint48 validAfter, uint48 validUntil)",
]);


/**
 * `ContractAccessControlType`, matching the plugin's enum by position.
 *
 * `ALLOWLIST` is zero, which is what a freshly added session key gets — and an *empty* allowlist
 * denies everything, including a plain transfer to an ordinary address. So the default is not
 * "unscoped", it is "inert".
 */
const ACCESS_LIST = { allowlist: 0, denylist: 1, allowAll: 2 } as const;

/**
 * Every contract that can move this account's USDC **without** carrying `msg.value`.
 *
 * On Arc the dollar is the native token *and* an ERC-20 view over the same balance, so the same
 * money moves two ways. The mandate's native limit counts `call.value` on every call whatever it
 * targets, so a value-carrying call is already bounded. What this names is the other kind: a
 * contract with protocol-level authority to move the balance, where `value == 0` and the native
 * counter sees nothing.
 *
 * **These are metered, not denied.** An unscoped mandate routes *everything* through this rail and
 * bounds it with a single ERC-20 limit, which is what lets a person be shown one number that is the
 * whole truth. A scoped mandate leaves the rail unnamed, and unnamed is refused.
 *
 * Exported because it is a claim about the chain rather than an implementation detail: it says
 * these are *all* of them. `integration/arc-rails.test.ts` re-derives the set from Arc and fails
 * if the chain ever grows one this list does not name. On an allowlist an unnamed rail is refused
 * rather than open, so that check no longer guards a hole; it says whether the one rail the phone's
 * number describes is still the only one.
 */
export const USDC_RAILS: readonly Address[] = [ARC_CONTRACTS.usdc];

/** A contract an agent's key may call from the account, and the only functions on it that it may. */
export interface AllowedCalls {
  readonly contract: Address;
  /** Signatures, as `name(types)`. */
  readonly functions: readonly string[];
}


/**
 * Filling the agent's escrow at Circle's Gateway, which is how it pays x402 sellers. The money was
 * counted when `approve` was metered, so the deposit itself carries none.
 */
export const ESCROW_CALLS: AllowedCalls = {
  contract: ARC_CONTRACTS.gatewayWallet,
  functions: ["depositFor(address,address,uint256)"],
};

/**
 * Setting up the agent's own ERC-8004 identity, owned by this account.
 *
 * `register()` mints a new identity to the caller, which is the account, and `setAgentWallet` links
 * the agent's key to it with the agent's own signature. Neither moves money, and neither can touch
 * an identity the account already holds: moving one needs `transferFrom` or an approval, and neither
 * is named. This is what lets a solved maze credit the wallet that granted the allowance.
 */
export const IDENTITY_CALLS: AllowedCalls = identityCalls(ARC_TESTNET);

/**
 * Why an allowance is an allowlist, which it was not until 09-11.
 *
 * Unscoped allowances used to be granted on a denylist naming only the USDC view, on the reasoning
 * that nothing else an agent could call carried money: the native limit counts `call.value` wherever
 * it goes. That held for USDC and for nothing else the wallet holds. A zero-value call can transfer
 * an NFT, approve an operator or move another token, and on a fork of Arc the agent's key moved the
 * owner's ERC-8004 identity to a stranger with the limit untouched. So the list is inverted: an agent
 * may call what these name, and anything unnamed is refused during validation, before it runs.
 *
 * Each contract is listed with `checkSelectors`. On an allowlist a contract listed without it is
 * allowed outright, which on the USDC view would skip the plugin's ERC-20 gate and open `transferFrom`.
 */
function allow({ contract, functions }: AllowedCalls): Hex[] {
  return [
    encodeFunctionData({
      abi: updatesAbi, functionName: "updateAccessListAddressEntry", args: [contract, true, true],
    }),
    ...functions.map((signature) => encodeFunctionData({
      abi: updatesAbi, functionName: "updateAccessListFunctionEntry",
      args: [contract, toFunctionSelector(signature), true],
    })),
  ];
}

/** Takes a contract off the list, which on an allowlist refuses every call to it. */
function disallow(contract: Address): Hex {
  return encodeFunctionData({
    abi: updatesAbi, functionName: "updateAccessListAddressEntry", args: [contract, false, false],
  });
}

export interface MandateTerms {
  /** The agent's address. It holds the matching key; we never see it. */
  readonly agent: Address;
  /** Total the agent may spend before the mandate refuses. */
  readonly limit: Amount;
  /** Who the agent may pay. Empty means it can pay nobody — the access list starts closed. */
  readonly payees: readonly Address[];
  /** Unix seconds. Omitted means no expiry, which the EntryPoint reads as unbounded. */
  readonly expiresAt?: number;
  /** Optional label, surfaced by `readMandate`. */
  readonly label?: string;
  /**
   * The one-time code the agent's QR carried, when the grant came from scanning it. Written into the
   * grant's tag, which is how the agent tells this grant from any other made to its address; a grant
   * without it is not used by the Arc Mandate connector.
   */
  readonly pairing?: string;
}

export interface Mandate {
  readonly agent: Address;
  readonly limit: Amount;
  readonly spent: Amount;
  readonly remaining: Amount;
  readonly expiresAt?: number;
  /**
   * What the agent holds of its own, to pay for submitting.
   *
   * Read from the chain rather than remembered, because it is the agent's balance and it goes
   * down as the agent works. It is here so the card can account for money that left the wallet:
   * granting sends this float, and without it on screen the only evidence of the transfer is a
   * balance that is smaller than it was, with nothing saying why.
   */
  readonly agentFloat: Amount;
  /**
   * What sits in the agent's escrow at Circle's Gateway, where top-ups go and x402 sellers are paid
   * from.
   *
   * Money the allowance has already moved, so it is not part of what is left. Shown because a revoke
   * does not reach it: it stays the agent's to spend, or to withdraw to its own address after
   * Circle's delay, and a person deciding to revoke should know that before they do.
   */
  readonly escrow: Amount;
  /**
   * When the plugin last recorded a spend against the meter in force, or `null`.
   *
   * Always `null` on the one-meter rail the app grants: the plugin writes this time only for native
   * and gas limits, or for a limit with a refresh interval, and an ERC-20 limit without one never
   * sets it. The agent's screen takes the last spend from the feed instead (`lastSpentAt`).
   */
  readonly lastUsedAt: number | null;
  /**
   * Which meter bounds this mandate — see `permissionUpdates`.
   *
   * Not a setting anyone chooses: it follows from whether payees were named. It is here because a
   * caller changing a limit has to change the one actually in force, and because mandates granted
   * before the ERC-20 shape existed are all `native`.
   */
  readonly rail: MandateRail;
}

/**
 * The core's terms for an Arc grant. The money is in native units, which the core converts for the
 * ERC-20 view itself, truncating as the chain does. Besides paying, the wallet allows its escrow at
 * Circle's Gateway on a grant naming no payees, since an agent shopping the open web pays sellers from
 * it, and every agent may set up its own identity, owned by this account, whichever rail it pays on.
 */
function coreTermsOf(terms: MandateTerms, network: NetworkProfile): GrantTerms {
  // the escrow only where the network has Circle's Gateway, and only for a grant naming no payees
  const escrow = network.contracts.gatewayWallet !== undefined && terms.payees.length === 0;
  return {
    agent: terms.agent,
    limit: terms.limit.toNativeUnits(),
    payees: terms.payees,
    calls: escrow ? [ESCROW_CALLS, identityCalls(network)] : [identityCalls(network)],
    ...(terms.expiresAt !== undefined ? { expiresAt: terms.expiresAt } : {}),
    ...(terms.label !== undefined ? { label: terms.label } : {}),
    ...(terms.pairing !== undefined ? { pairing: terms.pairing } : {}),
  };
}

/** The core's refusals, said as this wallet's own, which is what its callers catch. */
function inTheWalletsWords<T>(build: () => T): T {
  try {
    return build();
  } catch (cause) {
    if (cause instanceof GrantError) throw new MandateError(cause.message);
    throw cause;
  }
}

/**
 * Only the updates a change actually asks for.
 *
 * **Naming payees scopes the mandate, and has to say so on the wire.** `updateAccessListAddressEntry`
 * puts an address on *the* list, and the same call allows or denies depending on which kind of list
 * it is. Unscoped mandates granted before 09-11 are denylists, where adding a payee would have
 * blocked exactly the address the caller meant to permit, which is the worst possible way for an API
 * to be wrong. So a change that names payees also sets the list to an allowlist.
 *
 * **And it closes what it leaves.** On the one-meter shape the USDC view is listed with `transfer`
 * named, and scoping turns its limit off below, so left listed a transfer would move money no meter
 * counts. The view and the Gateway come off the list, and the identity calls go on, so a scoped
 * mandate reached by a change is the same allowlist a scoped grant makes.
 */
function changeUpdates(change: MandateChange): Hex[] {
  const payees = change.addPayees ?? [];
  const updates: Hex[] = payees.length > 0
    ? [
        encodeFunctionData({
          abi: updatesAbi, functionName: "setAccessListType", args: [ACCESS_LIST.allowlist],
        }),
        ...USDC_RAILS.map(disallow),
        disallow(ESCROW_CALLS.contract),
        ...allow(IDENTITY_CALLS),
      ]
    : [];

  for (const payee of payees) {
    updates.push(encodeFunctionData({
      abi: updatesAbi, functionName: "updateAccessListAddressEntry", args: [payee, true, false],
    }));
  }
  if (change.limit !== undefined) {
    // Naming payees moves the mandate onto the native rail whatever it was on before, because
    // that is the only rail where naming them means anything.
    const rail = payees.length > 0 ? "native" : change.rail;
    if (rail === undefined) {
      throw new MandateError(
        "Changing a limit needs to know which rail the mandate is on. Pass `rail` from readMandate.",
      );
    }
    if (rail === "native") {
      updates.push(encodeFunctionData({
        abi: updatesAbi, functionName: "setNativeTokenSpendLimit",
        args: [change.limit.toNativeUnits(), 0],
      }));
      // Moving onto the native rail must take the other meter with it, or the old ERC-20 limit
      // stays live beside the new one and the mandate permits both. `type(uint256).max` is the
      // engine's "no limit" sentinel, which is what disables a limit rather than widening it.
      if (payees.length > 0) {
        for (const erc20Rail of USDC_RAILS) {
          updates.push(encodeFunctionData({
            abi: updatesAbi, functionName: "setERC20SpendLimit",
            args: [erc20Rail, NO_LIMIT, 0],
          }));
        }
      }
    } else {
      if (change.limit.toErc20Units() === 0n) {
        throw new MandateError("A limit below 0.000001 USDC cannot be expressed on this rail.");
      }
      for (const erc20Rail of USDC_RAILS) {
        updates.push(encodeFunctionData({
          abi: updatesAbi, functionName: "setERC20SpendLimit",
          args: [erc20Rail, change.limit.toErc20Units(), 0],
        }));
      }
    }
  }
  if (change.expiresAt !== undefined) {
    updates.push(encodeFunctionData({
      abi: updatesAbi, functionName: "updateTimeRange", args: [0, change.expiresAt],
    }));
  }
  if (updates.length === 0) {
    throw new MandateError("a change that changes nothing — pass a limit, payees or an expiry");
  }
  return updates;
}

async function fees(account: ArcAccount) {
  const price = await getUserOperationGasPrice(account.bundler);
  return {
    maxFeePerGas: BigInt(price.medium.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(price.medium.maxPriorityFeePerGas),
  };
}

/**
 * Whether the mandate plugin exists on this network at all.
 *
 * It is deployed deterministically, so its address is known before anything is deployed to it —
 * which means every read below will come back empty on a network where that has not happened yet.
 * Checking for code once is the difference between "no allowances" and a decoding failure the
 * person is asked to interpret.
 */
export async function isPluginDeployed(network: NetworkProfile = ARC_TESTNET): Promise<boolean> {
  if (pluginSeen.has(network.chainId)) return true;
  const code = await clientFor(network).getCode({ address: network.contracts.sessionKeyPlugin });
  const deployed = code !== undefined && code !== "0x";
  if (deployed) pluginSeen.add(network.chainId);
  return deployed;
}

/**
 * Remembered once seen, because a deployed contract does not un-deploy.
 *
 * The allowance screen asks every ten seconds, and each ask was a request against the same public
 * rate limit the balance and the feed share, spent on a fact that cannot change back. Only a yes is
 * kept: a network where the plugin is missing is still asked again, so deploying it is noticed.
 */
const pluginSeen = new Set<number>();

/**
 * Whether this account already carries the mandate plugin.
 *
 * **An account that has never sent a user operation has no code.** A Circle smart account is
 * counterfactual: it has an address the moment the passkey exists, funds arrive at it happily, and
 * the contract itself is only created by the first operation. `account.ts` says so; this function
 * used to forget it, and asked an address with no code for its plugin list.
 *
 * The read then returned `0x`, viem raised a decoding error, and the screen's error mapper matched
 * "returned no data" and told the person *the allowance contract is not deployed on this network* —
 * blaming the plugin, which was deployed and fine, for the account being new. The first grant from
 * a fresh wallet was unreachable, and the message pointed away from the cause.
 *
 * No code means no plugins. That is an ordinary state, not a failure, and it is exactly the state
 * `buildGrantCalls` wants: with `pluginInstalled` false it takes the `installPlugin` path, which is
 * what a first grant is supposed to do.
 */
export async function isPluginInstalled(address: Address, network: NetworkProfile = ARC_TESTNET): Promise<boolean> {
  if (!(await isDeployed(address, network))) return false;

  const installed = await clientFor(network).readContract({
    address, abi: accountAbi, functionName: "getInstalledPlugins",
  });
  return installed.some((p) => p.toLowerCase() === network.contracts.sessionKeyPlugin.toLowerCase());
}

/**
 * Grants a mandate, installing the plugin first if this is the account's first one.
 *
 * Both paths are a **single user operation**, so the person approves once with their passkey
 * rather than twice — and a half-granted mandate cannot exist.
 */
/**
 * Sending a management operation the only way the account accepts one.
 *
 * `callData` rather than `calls`: viem's `calls` are encoded into `execute`/`executeBatch`, which
 * turns a management call into the account calling itself, and a self-call is runtime-validated.
 * The multisig implements no runtime validation, so the account refuses its own administration.
 * See `GrantPlan`.
 */
async function sendManagement(account: ArcAccount, callData: Hex): Promise<Hash> {
  const { network } = account;
  if (network.gas.estimatesOwnerOperations) {
    return account.bundler.sendUserOperation({ account: account.smartAccount, callData, ...(await fees(account)) });
  }
  // Where the bundler does not price owner operations well (Monad, which bills the whole limit), they
  // start from the network's figures and are corrected from what it names, with a doubled bid, as proven
  const price = await fees(account);
  const bid = { maxFeePerGas: price.maxFeePerGas * 2n, maxPriorityFeePerGas: price.maxPriorityFeePerGas * 2n };
  const { sent } = await sendCorrectingGas(network.gas.grant, (gas) =>
    account.bundler.sendUserOperation({ account: account.smartAccount, callData, ...gas, ...bid }));
  return sent;
}

/**
 * What a grant actually did.
 *
 * Returned rather than logged from in here: the SDK should not decide what reaches a console, and
 * a hash the caller never sees is an operation nobody can look up. A successful grant used to
 * print nothing at all — only failures were logged.
 */
export interface GrantReceipt {
  /** The management operation: installs the plugin if needed, and adds the session key. */
  readonly grant: Hash;
}

const keyAdded = parseAbiItem(
  "event SessionKeyAdded(address indexed account, address indexed sessionKey, bytes32 indexed tag)",
);

/**
 * What the plugin refuses a second grant to one agent with, as it reaches a caller: a revert whose
 * data begins with this selector. Derived from the signature rather than typed out, and exported so
 * the sentence a person reads is matched against the contract's own error and not a copied hex string.
 */
export const INVALID_SESSION_KEY = toFunctionSelector("InvalidSessionKey(address)");

/**
 * A landed grant's own log, found among the logs its operation left.
 *
 * The log is what the feed reads for that grant, so it is how the phone names the allowance it has
 * just made rather than every allowance the agent has ever had. Matched by the account and the agent,
 * since a bundle can carry other operations' logs.
 */
export function grantedIn(
  logs: readonly Log[], account: Address, agent: Address,
): { readonly tx: Hash; readonly logIndex: number } | null {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const added = parseEventLogs({ abi: [keyAdded], logs: [...logs] })
    .find((log) => same(log.args.account, account) && same(log.args.sessionKey, agent));
  if (added === undefined || added.transactionHash === null || added.logIndex === null) return null;
  return { tx: added.transactionHash, logIndex: added.logIndex };
}

export async function grantMandate(account: ArcAccount, terms: MandateTerms): Promise<GrantReceipt> {
  const plan = buildGrantPlan(terms, await isPluginInstalled(account.address, account.network), account.network);
  try {
    return { grant: await sendManagement(account, plan.management) };
  } catch (cause) {
    throw new MandateError(`granting ${terms.limit} to ${terms.agent} failed`, { cause });
  }
}

/**
 * What a grant becomes on the wire, in the shape the account will actually accept.
 *
 * **The management call cannot be batched.** On a Circle passkey MSCA the four management
 * selectors have no runtime validation function — `PORTING.md` explains why, and it is not an
 * oversight: `WeightedWebauthnMultisigPlugin` implements none, so there is no direct-call
 * administrative path for anyone. Wrapping the call in `execute` or `executeBatch` makes the
 * account call *itself*, which is a runtime call, and the account rejects it with
 * `RuntimeValidationFailed(multisig, 0, NotImplemented(...))`.
 *
 * That was the bug this type exists to prevent a repeat of: the previous shape was an array of
 * calls, which reads as "batch these", and viem duly batched them. Measured against the live
 * chain: `executeBatch(install + float)` reverts, `execute(install)` reverts, and the same
 * install as the operation's own `callData` estimates cleanly.
 *
 * A grant is therefore exactly one operation. It used to be two, the second sending the agent a
 * float so it could submit for itself — which left money in the agent's pocket that nothing ever
 * returned. The agent hands its operations to a bundler now and holds nothing; see
 * `mcp/bundler.ts`.
 */
export interface GrantPlan {
  /** The management operation. Goes in as the user operation's own `callData`, never nested. */
  readonly management: Hex;
}

/**
 * The calls a grant sends, as one user operation.
 *
 * Pure and exported so it can be checked without a bundler or a passkey. This is the most
 * consequential thing the app does — get the shape wrong and someone authorises more than they
 * meant to — and it was previously only reachable through a network call.
 */
export function buildGrantPlan(
  terms: MandateTerms,
  pluginInstalled: boolean,
  network: NetworkProfile = ARC_TESTNET,
): GrantPlan {
  return { management: inTheWalletsWords(() => grantCallData(network, coreTermsOf(terms, network), pluginInstalled)) };
}


/**
 * A change to a live mandate. Only the fields given are touched.
 *
 * Deliberately not `MandateTerms`: permission updates are applied, not replaced, so passing an
 * empty `payees` there would read as "remove every payee" while actually meaning "leave them
 * alone". Naming the fields optional says what the call really does.
 */
export interface MandateChange {
  readonly agent: Address;
  readonly limit?: Amount;
  /**
   * Which meter the mandate is currently on, from `readMandate`. Required alongside `limit`.
   *
   * There is no way to infer it here — this builds calldata and never touches the chain — and
   * guessing would be silent: setting the native limit on a mandate metered through the ERC-20
   * rail leaves the real limit untouched and adds a second meter beside it, so the agent ends up
   * with more authority than the change asked for rather than less.
   */
  readonly rail?: MandateRail;
  /** Payees to **add**. There is no removal here; revoke and re-grant to narrow a list. */
  readonly addPayees?: readonly Address[];
  readonly expiresAt?: number;
}

/** Changes a live mandate's terms. Same passkey gesture as granting one. */
/**
 * The calls a change becomes, without sending them.
 *
 * Pure and exported for the same reason `buildGrantPlan` is: what these calls *say* is the whole
 * security decision, and a function that needs an account and a bundler to run is a function
 * nobody tests. The change path had no such seam, which is precisely why an inversion in
 * `changeUpdates` — payees being denied instead of allowed — sat there uncovered.
 */
export function buildChangeCallData(agent: Address, change: Omit<MandateChange, "agent">): Hex {
  return encodeFunctionData({
    abi: pluginAbi, functionName: "updateKeyPermissions",
    args: [agent, changeUpdates({ ...change, agent })],
  });
}

export async function updateMandate(account: ArcAccount, change: MandateChange): Promise<Hash> {
  try {
    return await sendManagement(account, buildChangeCallData(change.agent, change));
  } catch (cause) {
    throw new MandateError(`updating the mandate for ${change.agent} failed`, { cause });
  }
}

/**
 * Takes the mandate away. The agent keeps its key and loses its standing, which is the difference
 * between revoking and hoping.
 */
export async function revokeMandate(account: ArcAccount, agent: Address): Promise<Hash> {
  const predecessor = await clientFor(account.network).readContract({
    address: account.network.contracts.sessionKeyPlugin, abi: pluginAbi, functionName: "findPredecessor",
    args: [account.address, agent],
  });
  try {
    return await sendManagement(account, encodeFunctionData({
      abi: pluginAbi, functionName: "removeSessionKey", args: [agent, predecessor],
    }));
  } catch (cause) {
    throw new MandateError(`revoking the mandate for ${agent} failed`, { cause });
  }
}

/** What the plugin answers for a limit never set, so a network with no ERC-20 view reads as metering its coin. */
const NO_ERC20_LIMIT = { hasLimit: false, limit: 0n, limitUsed: 0n, refreshInterval: 0, lastUsedTime: 0 } as const;

/** Every mandate this account has granted, read from the chain rather than remembered locally. */
export async function listMandates(address: Address, network: NetworkProfile = ARC_TESTNET): Promise<Mandate[]> {
  // An account that has never granted anything has no plugin data to read, and a network without
  // the plugin has no contract at all. Both are ordinary states, not failures, and both would
  // otherwise surface as a decoding error about missing return data.
  if (!(await isPluginDeployed(network))) return [];

  const agents = await clientFor(network).readContract({
    address: network.contracts.sessionKeyPlugin, abi: pluginAbi, functionName: "sessionKeysOf", args: [address],
  });
  const read = await Promise.all(agents.map(async (agent) => {
    try {
      return await readMandate(address, agent, network);
    } catch (cause) {
      // Naming the keys and reading each one are separate calls at separate blocks, so a revoke
      // landing between them leaves the list naming a key the plugin has already forgotten. That
      // put "Arc is busy" on the screen at the exact moment a revoke succeeded, which reads as the
      // revoke having failed. A key that has gone is not a failed read — it is one fewer allowance,
      // which is what was just asked for.
      if (!keyIsGone(cause)) throw cause;
      return null;
    }
  }));
  // `flatMap` rather than a filter and a cast: the step that drops the gone keys is the step that
  // narrows the type, so nothing has to be asserted afterwards.
  return read.flatMap((mandate) => mandate === null ? [] : [mandate]);
}

/**
 * Whether a read failed because that address is no longer one of the account's session keys.
 *
 * Narrow on purpose. `InvalidSessionKey` is the plugin's answer to that one question and nothing
 * else, so treating it as "gone" hides nothing; every other revert, and every network failure,
 * still surfaces.
 *
 * Read off the raw revert rather than the decoded error name, so the answer does not depend on the
 * ABI the read happened to use: a caller whose ABI does not declare the error gets back a bare
 * selector and has no name to compare against, which is silently the same bug one line short.
 *
 * Exported for the same reason `buildGrantPlan` is: deciding which failures are ordinary is a
 * judgement worth a test, and a predicate that needs a chain to run is a predicate nobody tests.
 */
export function keyIsGone(cause: unknown): boolean {
  return cause instanceof BaseError && cause.walk((error) =>
    error instanceof ContractFunctionRevertedError
      && error.raw?.startsWith(INVALID_SESSION_KEY) === true,
  ) !== null;
}


/**
 * Which meter is in force, and what it says.
 *
 * Read rather than assumed, because both shapes exist on chain: mandates granted with named
 * payees are metered natively, unscoped ones through the ERC-20 view, and mandates granted before
 * this existed are all native. Picking the wrong one would report a limit of zero against a live
 * mandate, or a live limit against a mandate that has none.
 *
 * The ERC-20 figures come back at 6-decimal scale and are widened here rather than at the call
 * site, where a raw `fromNativeUnits` would be off by a million and still look like money.
 */
export interface NativeMeter {
  readonly limit: bigint;
  readonly limitUsed: bigint;
  readonly lastUsedTime: number;
}

export interface Erc20Meter extends NativeMeter {
  readonly hasLimit: boolean;
}

export interface MeterInForce {
  readonly rail: MandateRail;
  readonly limit: Amount;
  readonly spent: Amount;
  readonly lastUsedTime: number;
}

/**
 * Which of the two meters is the one number, and at which scale to read it.
 *
 * Pure and exported for the same reason `buildGrantPlan` is: the two rails are 6 and 18 decimals
 * over one balance, so reading a meter at the other one's scale is a million-fold error that looks
 * entirely plausible on a phone. Reaching it needs two chain reads, which is how it stayed
 * unchecked while every other part of the one-meter design was covered.
 */
export function meterInForce(
  native: NativeMeter,
  erc20: Erc20Meter,
): MeterInForce {
  if (erc20.hasLimit) {
    return {
      rail: "erc20",
      limit: Amount.fromErc20Units(erc20.limit),
      spent: Amount.fromErc20Units(erc20.limitUsed),
      // Both meters record a last-used time. The one that matters is the one doing the metering,
      // and on this shape the native meter never moves — reading it would report an agent that
      // has been spending all week as one that has never spent.
      lastUsedTime: erc20.lastUsedTime,
    };
  }
  return {
    rail: "native",
    limit: Amount.fromNativeUnits(native.limit),
    spent: Amount.fromNativeUnits(native.limitUsed),
    lastUsedTime: native.lastUsedTime,
  };
}

export async function readMandate(address: Address, agent: Address, network: NetworkProfile = ARC_TESTNET): Promise<Mandate> {
  const client = clientFor(network);
  const plugin = network.contracts.sessionKeyPlugin;
  const view = network.contracts.erc20View;
  const gateway = network.contracts.gatewayWallet;
  const [spend, range, agentBalance, onlineLimit, escrowHeld, circleHeld] = await Promise.all([
    client.readContract({ address: plugin, abi: pluginAbi, functionName: "getNativeTokenSpendLimitInfo", args: [address, agent] }),
    client.readContract({ address: plugin, abi: pluginAbi, functionName: "getKeyTimeRange", args: [address, agent] }),
    client.getBalance({ address: agent }),
    // a network whose coin has no ERC-20 view meters the coin itself, and has no second limit to read
    view === undefined
      ? NO_ERC20_LIMIT
      : client.readContract({ address: plugin, abi: pluginAbi, functionName: "getERC20SpendLimitInfo", args: [address, agent, view.address] }),
    // an escrow only exists where Circle's Gateway does
    gateway === undefined || view === undefined
      ? 0n
      : client.readContract({ address: gateway, abi: gatewayAbi, functionName: "availableBalance", args: [view.address, agent] }),
    // Circle's own figure, which leaves out payments it has accepted and not yet settled; the chain's
    // counts them, and overstated an agent's escrow by more than a dollar. The chain's stands in
    // only when Circle's service does not answer.
    gateway === undefined ? Promise.resolve(null) : circleEscrow(agent).catch(() => null),
  ]);
  const meter = meterInForce(spend, onlineLimit);
  const { limit, spent } = meter;
  return {
    agent,
    rail: meter.rail,
    limit,
    spent,
    // Clamped: the engine records usage against the limit in force at the time, so lowering a
    // limit below what is already spent is legitimate and must not read as negative money.
    remaining: spent.compare(limit) >= 0 ? Amount.ZERO : limit.subtract(spent),
    ...(range[1] === 0 ? {} : { expiresAt: Number(range[1]) }),
    agentFloat: Amount.fromNativeUnits(agentBalance),
    // Gateway counts in the ERC-20 view's six decimals.
    escrow: Amount.fromErc20Units(circleHeld ?? escrowHeld),
    lastUsedAt: meter.lastUsedTime === 0 ? null : Number(meter.lastUsedTime),
  };
}
