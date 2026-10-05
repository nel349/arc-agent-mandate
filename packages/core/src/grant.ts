import {
  encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, parseAbiParameters, toFunctionSelector, toHex,
  type Address, type Hex,
} from "viem";
import type { NetworkProfile } from "./networks.ts";
import { pairingTag } from "./pairing.ts";

/**
 * What a grant says on the wire: the permissions a session key is given, and the one operation that
 * installs the plugin with them, or adds the key to a plugin already installed.
 *
 * The most consequential thing a wallet does: get the shape wrong and someone authorises more than they
 * meant to. So it is built here, pure, from a network's profile and the terms, and checked byte for byte
 * against what the Arc wallet granted before it was moved here.
 *
 * Two meters, chosen by the network and the terms:
 *
 * - **native**, the chain's own coin carried as a call's value. Payees can be named, and anything unnamed
 *   is refused during validation, before it runs. Every grant on Monad, and every grant on Arc that names
 *   payees.
 * - **erc20**, the ERC-20 view of the chain's own coin, on a network that has one (Arc), for a grant that
 *   names no payees: payments and escrow approvals draw on one limit, and the native limit is left at
 *   zero, so there is no second meter to escape through.
 */

/** `ContractAccessControlType`, matching the plugin's enum by position. An empty allowlist denies everything. */
export const ACCESS_LIST = { allowlist: 0, denylist: 1, allowAll: 2 } as const;

/** The plugin's permission updates, which a grant is a list of: exported so a reader can decode one. */
export const permissionUpdatesAbi = parseAbi([
  "function updateAccessListAddressEntry(address contractAddress, bool isOnList, bool checkSelectors)",
  "function updateAccessListFunctionEntry(address contractAddress, bytes4 selector, bool isOnList)",
  "function setAccessListType(uint8 contractAccessControlType)",
  "function setNativeTokenSpendLimit(uint256 spendLimit, uint48 refreshInterval)",
  "function setERC20SpendLimit(address token, uint256 spendLimit, uint48 refreshInterval)",
  "function setGasSpendLimit(uint256 spendLimit, uint48 refreshInterval)",
  "function updateTimeRange(uint48 validAfter, uint48 validUntil)",
]);
const accountAbi = parseAbi([
  "function installPlugin(address plugin, bytes32 manifestHash, bytes pluginInstallData, (address plugin, uint8 functionId)[] dependencies)",
]);
const pluginAbi = parseAbi(["function addSessionKey(address sessionKey, bytes32 tag, bytes[] permissionUpdates)"]);

/**
 * The hash `installPlugin` checks the plugin's manifest against. The plugin is the same code on every
 * network, so this is one value, which the integration suite checks against what each chain's plugin reports.
 */
export const SESSION_KEY_PLUGIN_MANIFEST_HASH: Hex = "0xe23eaad0aaa11b507601ea43a73f21daf74b8033c54b6241e081da6c0d915e69";

/** `BaseMultisigPlugin.FunctionId.USER_OP_VALIDATION_OWNER`, the owner plugin's only function id. */
const USER_OP_VALIDATION_OWNER = 0;

/** `type(uint256).max` is the plugin's "no limit"; one below it is the highest real ceiling. */
const NO_LIMIT = (1n << 256n) - 1n;
export const HIGHEST_REAL_LIMIT = NO_LIMIT - 1n;

/** On the ERC-20 view: paying, and approving an escrow. `transferFrom` is absent, since the meter does not count it. */
const ERC20_FUNCTIONS: readonly string[] = ["transfer(address,uint256)", "approve(address,uint256)"];

/** A contract an agent's key may call from the account, and the only functions on it that it may. */
export interface AllowedCalls {
  readonly contract: Address;
  /** signatures, as `name(types)` */
  readonly functions: readonly string[];
}

/**
 * Setting up the agent's own ERC-8004 identity, owned by the granting wallet: `register()` mints one to
 * the wallet, and `setAgentWallet` links the agent's key to it with the agent's own signature. Neither
 * moves money, and neither can touch an identity the wallet already holds. A wallet allows it on every
 * grant, so what an agent earns can be credited to the wallet that granted it.
 */
export const identityCalls = (network: NetworkProfile): AllowedCalls => ({
  contract: network.contracts.erc8004.identity,
  functions: ["register()", "setAgentWallet(uint256,address,uint256,bytes)"],
});

export interface GrantTerms {
  /** the agent's address; it holds the matching key, which the wallet never sees */
  readonly agent: Address;
  /** what the agent may spend in all, in the network coin's own units */
  readonly limit: bigint;
  /** who the agent may pay; empty means nobody, the list starts closed */
  readonly payees: readonly Address[];
  /** contracts the agent may call besides paying, each with the functions named: an escrow, an identity, a job contract */
  readonly calls?: readonly AllowedCalls[];
  /** unix seconds; omitted means no expiry */
  readonly expiresAt?: number;
  /** a label for a grant made from a typed address, written into its tag */
  readonly label?: string;
  /** the one-time code the agent's QR carried, written into the tag, which is how the agent knows the grant is its owner's */
  readonly pairing?: string;
}

export class GrantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrantError";
  }
}

export type Rail = "native" | "erc20";

/** Which meter a grant uses: the ERC-20 view for one naming no payees on a network that has one, otherwise the coin itself. */
export const railOf = (network: NetworkProfile, terms: Pick<GrantTerms, "payees">): Rail =>
  network.contracts.erc20View !== undefined && terms.payees.length === 0 ? "erc20" : "native";

/**
 * Whether a grant on this network has to name who it may pay.
 *
 * The plugin limits an agent by the addresses it may call, and has no rule for "send the coin to anyone
 * and call nothing else". Where the coin has an ERC-20 view (Arc), an allowance naming no payees pays
 * anyone through the view, which is on the list and metered. Where it has none (Monad), an allowance
 * naming no payees could pay nobody, and allowing every address would let the agent call any contract
 * with the wallet: move tokens the limit does not count, or give away the identity the wallet owns. So
 * there it names its payees, which an app's request supplies or the person adds.
 */
export const payeesRequired = (network: NetworkProfile): boolean => network.contracts.erc20View === undefined;

/** Said when a grant on such a network names nobody to pay. */
export const PAYEES_REQUIRED = "On this network an allowance pays only the addresses it names. Add who the agent may pay.";

/** The tag a grant carries: its pairing code's, when it came from a scanned code, or its label's. */
export const grantTag = (terms: Pick<GrantTerms, "pairing" | "label">): Hex =>
  terms.pairing !== undefined ? pairingTag(terms.pairing) : keccak256(toHex(terms.label ?? "mandate"));

/** A contract on the list, checked function by function, with the functions named. */
function allow({ contract, functions }: AllowedCalls): Hex[] {
  return [
    encodeFunctionData({ abi: permissionUpdatesAbi, functionName: "updateAccessListAddressEntry", args: [contract, true, true] }),
    ...functions.map((signature) => encodeFunctionData({
      abi: permissionUpdatesAbi, functionName: "updateAccessListFunctionEntry", args: [contract, toFunctionSelector(signature), true],
    })),
  ];
}

/** The permissions a grant gives its session key, in the order the plugin applies them. */
export function permissionUpdates(network: NetworkProfile, terms: GrantTerms): Hex[] {
  if (terms.limit <= 0n) throw new GrantError("a mandate must allow something; use revokeMandate to take one away");
  if (payeesRequired(network) && terms.payees.length === 0) throw new GrantError(PAYEES_REQUIRED);

  // an allowlist either way: what the agent may call is named below, and nothing else is reachable
  const updates: Hex[] = [encodeFunctionData({ abi: permissionUpdatesAbi, functionName: "setAccessListType", args: [ACCESS_LIST.allowlist] })];
  for (const payee of terms.payees) {
    // plain payees receiving value, not contracts whose functions need gating
    updates.push(encodeFunctionData({ abi: permissionUpdatesAbi, functionName: "updateAccessListAddressEntry", args: [payee, true, false] }));
  }

  const view = network.contracts.erc20View;
  if (railOf(network, terms) === "erc20" && view !== undefined) {
    const units = terms.limit / 10n ** BigInt(network.coin.decimals - view.decimals);
    if (units === 0n) {
      throw new GrantError(`A limit below 0.${"0".repeat(view.decimals - 1)}1 ${network.coin.symbol} cannot be expressed on the rail an unscoped mandate uses.`);
    }
    // the one rail: on the list with its functions checked, and a limit, which is also what turns the ERC-20 gate on
    updates.push(...allow({ contract: view.address, functions: ERC20_FUNCTIONS }));
    updates.push(encodeFunctionData({ abi: permissionUpdatesAbi, functionName: "setERC20SpendLimit", args: [view.address, units, 0] }));
  } else {
    updates.push(encodeFunctionData({ abi: permissionUpdatesAbi, functionName: "setNativeTokenSpendLimit", args: [terms.limit, 0] }));
  }

  for (const calls of terms.calls ?? []) updates.push(...allow(calls));

  // gas is another way to spend the same balance, and an unset limit denies rather than allows
  updates.push(encodeFunctionData({ abi: permissionUpdatesAbi, functionName: "setGasSpendLimit", args: [HIGHEST_REAL_LIMIT, 0] }));
  if (terms.expiresAt !== undefined) {
    updates.push(encodeFunctionData({ abi: permissionUpdatesAbi, functionName: "updateTimeRange", args: [0, terms.expiresAt] }));
  }
  return updates;
}

/**
 * The one operation a grant is: the plugin installed with the agent's key, or the key added to the plugin
 * already installed. It goes in as the operation's own `callData`, never wrapped in `execute`: on Circle's
 * accounts the management functions have no runtime validation, so a wrapped one is refused.
 */
export function grantCallData(network: NetworkProfile, terms: GrantTerms, pluginInstalled: boolean): Hex {
  const updates = permissionUpdates(network, terms);
  const tag = grantTag(terms);
  if (pluginInstalled) return encodeFunctionData({ abi: pluginAbi, functionName: "addSessionKey", args: [terms.agent, tag, updates] });
  return encodeFunctionData({
    abi: accountAbi,
    functionName: "installPlugin",
    args: [
      network.contracts.sessionKeyPlugin,
      SESSION_KEY_PLUGIN_MANIFEST_HASH,
      encodeAbiParameters(parseAbiParameters("address[], bytes32[], bytes[][]"), [[terms.agent], [tag], [updates]]),
      [{ plugin: network.contracts.ownerPlugin, functionId: USER_OP_VALIDATION_OWNER }],
    ],
  });
}
