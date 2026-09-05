import {
  encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, parseAbiParameters, toHex,
  type Address, type Hash, type Hex,
} from "viem";
import { getUserOperationGasPrice } from "@circle-fin/modular-wallets-core";
import { arcPublicClient } from "./client.ts";
// Type-only: erased at runtime, so this file never loads the passkey shim.
import type { ArcAccount } from "./account.ts";
import { Usdc } from "./usdc.ts";

/**
 * Granting, reading and revoking a mandate.
 *
 * A mandate is bounded authority handed from the account to a **session key** — an ordinary
 * keypair an agent holds. The agent has no standing of its own: every payment it makes is a user
 * operation the account validates against the mandate before anything moves, so exceeding the
 * limit is refused during validation and costs nothing.
 *
 * Three things about the shape here are not arbitrary:
 *
 * - **Denominated in native USDC.** Arc's dollar is also an ERC-20 view at `0x3600…` over the
 *   same balance, and `approve` on that view creates an allowance living in the token contract
 *   rather than the session key — so it would outlive revocation. Agents are therefore denied
 *   that rail entirely, which is why `payees` never includes it. See `usdc.ts`.
 * - **Management is owner-only.** Granting, re-scoping and revoking each route to the account's
 *   passkey. The agent's own spending does not. That split is the product.
 * - **There is no direct-call path.** Circle's multisig implements no runtime validation, so
 *   every call below is a user operation. A passkey cannot sign a plain transaction anyway.
 */

/** Deployed deterministically via CREATE2, so the address is the same on every Arc network.
 *  Derived from the plugin's creation code — see `contracts/script/DeploySessionKeyPlugin.s.sol`. */
export const SESSION_KEY_PLUGIN: Address = "0x669Dd1eDb85ABD00f74186d88124614EE81E6670";

/** `keccak256(abi.encode(pluginManifest()))`, which `installPlugin` verifies. Fixed by the
 *  plugin's build; `mandate.test.ts` pins it against the compiled contract so a change to the
 *  plugin cannot silently leave this stale. Print it with
 *  `forge script script/DeploySessionKeyPlugin.s.sol --sig "manifestHash()"`. */
export const SESSION_KEY_PLUGIN_MANIFEST_HASH: Hex =
  "0xe23eaad0aaa11b507601ea43a73f21daf74b8033c54b6241e081da6c0d915e69";

/** Circle's WeightedWebauthnMultisigPlugin: the account's owner, and the mandate's dependency. */
const OWNER_PLUGIN: Address = "0x0000000C984AFf541D6cE86Bb697e68ec57873C8";
/** `BaseMultisigPlugin.FunctionId.USER_OP_VALIDATION_OWNER`, the enum's only member. */
const USER_OP_VALIDATION_OWNER = 0;

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
]);

const updatesAbi = parseAbi([
  "function updateAccessListAddressEntry(address contractAddress, bool isOnList, bool checkSelectors)",
  "function setNativeTokenSpendLimit(uint256 spendLimit, uint48 refreshInterval)",
  "function setGasSpendLimit(uint256 spendLimit, uint48 refreshInterval)",
  "function updateTimeRange(uint48 validAfter, uint48 validUntil)",
]);

export interface MandateTerms {
  /** The agent's address. It holds the matching key; we never see it. */
  readonly agent: Address;
  /** Total the agent may spend before the mandate refuses. */
  readonly limit: Usdc;
  /** Who the agent may pay. Empty means it can pay nobody — the access list starts closed. */
  readonly payees: readonly Address[];
  /** Unix seconds. Omitted means no expiry, which the EntryPoint reads as unbounded. */
  readonly expiresAt?: number;
  /** Optional label, surfaced by `readMandate`. */
  readonly label?: string;
  /**
   * A small amount of USDC sent to the agent so it can submit its own operations.
   *
   * Without this a granted agent is authorised and still cannot spend: submitting a user
   * operation is an ordinary transaction, and someone has to pay for it. The account reimburses
   * most of it, so the float drains at roughly 0.0014 USDC per payment — about 700 payments per
   * dollar. It is the agent's own money, so losing the agent's key loses the float and nothing
   * more.
   */
  readonly gasFloat?: Usdc;
}

export interface Mandate {
  readonly agent: Address;
  readonly limit: Usdc;
  readonly spent: Usdc;
  readonly remaining: Usdc;
  readonly expiresAt?: number;
}

/** The permission calls that turn a bare session key into a bounded one. */
function permissionUpdates(terms: MandateTerms): Hex[] {
  const updates: Hex[] = terms.payees.map((payee) =>
    encodeFunctionData({
      abi: updatesAbi,
      functionName: "updateAccessListAddressEntry",
      // `checkSelectors: false` — these are plain payees receiving value, not contracts whose
      // individual functions need gating.
      args: [payee, true, false],
    }),
  );

  updates.push(encodeFunctionData({
    abi: updatesAbi,
    functionName: "setNativeTokenSpendLimit",
    args: [terms.limit.toNativeUnits(), 0],
  }));

  // Gas is a third way to spend the same balance, and an unset limit denies rather than allows.
  // `type(uint256).max` is the engine's "no limit" sentinel, so one below it is the real ceiling.
  updates.push(encodeFunctionData({
    abi: updatesAbi,
    functionName: "setGasSpendLimit",
    args: [(1n << 256n) - 2n, 0],
  }));

  if (terms.expiresAt !== undefined) {
    updates.push(encodeFunctionData({
      abi: updatesAbi,
      functionName: "updateTimeRange",
      args: [0, terms.expiresAt],
    }));
  }
  return updates;
}

/** Only the updates a change actually asks for. */
function changeUpdates(change: MandateChange): Hex[] {
  const updates: Hex[] = (change.addPayees ?? []).map((payee) =>
    encodeFunctionData({
      abi: updatesAbi, functionName: "updateAccessListAddressEntry", args: [payee, true, false],
    }),
  );
  if (change.limit !== undefined) {
    updates.push(encodeFunctionData({
      abi: updatesAbi, functionName: "setNativeTokenSpendLimit",
      args: [change.limit.toNativeUnits(), 0],
    }));
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

/** Whether this account already carries the mandate plugin. */
export async function isPluginInstalled(address: Address): Promise<boolean> {
  const installed = await arcPublicClient.readContract({
    address, abi: accountAbi, functionName: "getInstalledPlugins",
  });
  return installed.some((p) => p.toLowerCase() === SESSION_KEY_PLUGIN.toLowerCase());
}

/**
 * Grants a mandate, installing the plugin first if this is the account's first one.
 *
 * Both paths are a **single user operation**, so the person approves once with their passkey
 * rather than twice — and a half-granted mandate cannot exist.
 */
export async function grantMandate(account: ArcAccount, terms: MandateTerms): Promise<Hash> {
  const calls = buildGrantCalls(account.address, terms, await isPluginInstalled(account.address));
  try {
    return await account.bundler.sendUserOperation({
      account: account.smartAccount, calls, ...(await fees(account)),
    });
  } catch (cause) {
    throw new MandateError(`granting ${terms.limit} to ${terms.agent} failed`, { cause });
  }
}

export interface GrantCall {
  readonly to: Address;
  readonly data?: Hex;
  readonly value?: bigint;
}

/**
 * The calls a grant sends, as one user operation.
 *
 * Pure and exported so it can be checked without a bundler or a passkey. This is the most
 * consequential thing the app does — get the shape wrong and someone authorises more than they
 * meant to — and it was previously only reachable through a network call.
 */
export function buildGrantCalls(
  /** The granting account. Management calls target it, because that is where the plugin lives. */
  accountAddress: Address,
  terms: MandateTerms,
  pluginInstalled: boolean,
): GrantCall[] {
  if (terms.limit.isNegative() || terms.limit.isZero()) {
    throw new MandateError("a mandate must allow something; use revokeMandate to take one away");
  }

  const updates = permissionUpdates(terms);
  const tag = keccak256(toHex(terms.label ?? "mandate"));

  const grantCall: GrantCall = pluginInstalled
    ? {
        to: accountAddress,
        data: encodeFunctionData({
          abi: pluginAbi, functionName: "addSessionKey", args: [terms.agent, tag, updates],
        }),
      }
    : {
        to: accountAddress,
        data: encodeFunctionData({
          abi: accountAbi,
          functionName: "installPlugin",
          args: [
            SESSION_KEY_PLUGIN,
            SESSION_KEY_PLUGIN_MANIFEST_HASH,
            // The plugin's own install payload: keys, tags, and their initial permissions.
            encodeInstallData([terms.agent], [tag], [updates]),
            [{ plugin: OWNER_PLUGIN, functionId: USER_OP_VALIDATION_OWNER }],
          ],
        }),
      };

  // Authorising the agent and funding it are one user operation, so the person confirms once and
  // an agent can never end up authorised but unable to act.
  if (terms.gasFloat !== undefined && !terms.gasFloat.isZero()) {
    if (terms.gasFloat.isNegative()) throw new MandateError("a gas float cannot be negative");
    return [grantCall, { to: terms.agent, value: terms.gasFloat.toNativeUnits() }];
  }
  return [grantCall];
}

/** `abi.encode(address[], bytes32[], bytes[][])`, the plugin's `onInstall` payload. */
function encodeInstallData(keys: readonly Address[], tags: readonly Hex[], updates: readonly Hex[][]): Hex {
  return encodeAbiParameters(parseAbiParameters("address[], bytes32[], bytes[][]"), [
    keys as Address[], tags as Hex[], updates as Hex[][],
  ]);
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
  readonly limit?: Usdc;
  /** Payees to **add**. There is no removal here; revoke and re-grant to narrow a list. */
  readonly addPayees?: readonly Address[];
  readonly expiresAt?: number;
}

/** Changes a live mandate's terms. Same passkey gesture as granting one. */
export async function updateMandate(account: ArcAccount, change: MandateChange): Promise<Hash> {
  try {
    return await account.bundler.sendUserOperation({
      account: account.smartAccount,
      calls: [{
        to: account.address,
        data: encodeFunctionData({
          abi: pluginAbi, functionName: "updateKeyPermissions",
          args: [change.agent, changeUpdates(change)],
        }),
      }],
      ...(await fees(account)),
    });
  } catch (cause) {
    throw new MandateError(`updating the mandate for ${change.agent} failed`, { cause });
  }
}

/**
 * Takes the mandate away. The agent keeps its key and loses its standing, which is the difference
 * between revoking and hoping.
 */
export async function revokeMandate(account: ArcAccount, agent: Address): Promise<Hash> {
  const predecessor = await arcPublicClient.readContract({
    address: SESSION_KEY_PLUGIN, abi: pluginAbi, functionName: "findPredecessor",
    args: [account.address, agent],
  });
  try {
    return await account.bundler.sendUserOperation({
      account: account.smartAccount,
      calls: [{
        to: account.address,
        data: encodeFunctionData({
          abi: pluginAbi, functionName: "removeSessionKey", args: [agent, predecessor],
        }),
      }],
      ...(await fees(account)),
    });
  } catch (cause) {
    throw new MandateError(`revoking the mandate for ${agent} failed`, { cause });
  }
}

/** Every mandate this account has granted, read from the chain rather than remembered locally. */
export async function listMandates(address: Address): Promise<Mandate[]> {
  const agents = await arcPublicClient.readContract({
    address: SESSION_KEY_PLUGIN, abi: pluginAbi, functionName: "sessionKeysOf", args: [address],
  });
  return Promise.all(agents.map((agent) => readMandate(address, agent)));
}

export async function readMandate(address: Address, agent: Address): Promise<Mandate> {
  const [spend, range] = await Promise.all([
    arcPublicClient.readContract({
      address: SESSION_KEY_PLUGIN, abi: pluginAbi,
      functionName: "getNativeTokenSpendLimitInfo", args: [address, agent],
    }),
    arcPublicClient.readContract({
      address: SESSION_KEY_PLUGIN, abi: pluginAbi,
      functionName: "getKeyTimeRange", args: [address, agent],
    }),
  ]);
  const limit = Usdc.fromNativeUnits(spend.limit);
  const spent = Usdc.fromNativeUnits(spend.limitUsed);
  return {
    agent,
    limit,
    spent,
    // Clamped: the engine records usage against the limit in force at the time, so lowering a
    // limit below what is already spent is legitimate and must not read as negative money.
    remaining: spent.compare(limit) >= 0 ? Usdc.ZERO : limit.subtract(spent),
    expiresAt: range[1] === 0 ? undefined : Number(range[1]),
  };
}
