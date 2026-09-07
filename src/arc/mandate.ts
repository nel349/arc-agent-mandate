import {
  encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, parseAbiParameters, toHex,
  type Address, type Hash, type Hex,
} from "viem";
import { getUserOperationGasPrice } from "@circle-fin/modular-wallets-core";
import { arcPublicClient, isDeployed } from "./client.ts";
import { ARC_CONTRACTS } from "./chain.ts";
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
const HIGHEST_REAL_LIMIT = NO_LIMIT - 1n;

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
 * **These are metered, not denied — the name of the game changed.** An unscoped mandate now routes
 * *everything* through this rail and bounds it with a single ERC-20 limit, which is what lets a
 * person be shown one number that is the whole truth. A scoped mandate leaves the rail unnamed on
 * an allowlist, where unlisted is already refused.
 *
 * Exported because it is a claim about the chain rather than an implementation detail: it says
 * these are *all* of them. `integration/arc-rails.test.ts` re-derives the set from Arc and fails
 * if the chain ever grows one this list does not name — which is the single weakness of granting
 * on a denylist, made loud instead of silent.
 */
export const USDC_RAILS: readonly Address[] = [ARC_CONTRACTS.usdc];

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
}

export interface Mandate {
  readonly agent: Address;
  readonly limit: Usdc;
  readonly spent: Usdc;
  readonly remaining: Usdc;
  readonly expiresAt?: number;
  /**
   * What the agent holds of its own, to pay for submitting.
   *
   * Read from the chain rather than remembered, because it is the agent's balance and it goes
   * down as the agent works. It is here so the card can account for money that left the wallet:
   * granting sends this float, and without it on screen the only evidence of the transfer is a
   * balance that is smaller than it was, with nothing saying why.
   */
  readonly agentFloat: Usdc;
  /**
   * When the agent last spent, or `null` if it never has.
   *
   * The plugin records this against the spend limit and it comes back on every read, so it costs
   * nothing to show — and it is the only thing the chain can honestly say about an agent's
   * activity. Reading a chain leaves no trace, so an agent that has been installed, paired and is
   * running looks exactly like one that was never set up, right up until it spends.
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
 * Making the ERC-20 view the *only* rail, so one limit is the whole mandate.
 *
 * Arc's dollar is reachable two ways, and the plugin meters them separately: the native limit
 * counts `call.value`, an ERC-20 limit counts the amount in the calldata, and neither draws down
 * the other. A mandate carrying both therefore permits their sum — which forces a person to hold
 * two numbers in their head, or be shown one that is not the truth.
 *
 * Nothing requires payments to use the native rail. Sent through the ERC-20 view, a payment
 * arrives identically — the recipient's *native* balance rises by the same amount, because the two
 * views are one balance — and `approve` funding an x402 escrow draws on the same meter. So the
 * native limit is left at zero, which refuses any call carrying value, and one ERC-20 limit bounds
 * everything the agent can do. `contracts/test/ArcOneMeter.t.sol` is the evidence.
 *
 * Three parts, each load-bearing, and the plugin's ERC-20 weaknesses are why:
 *
 * - **On the list with `checkSelectors`.** The denylist branch returns early for an unlisted
 *   target, before the ERC-20 selector gate runs. Listing the rail is what reaches the gate, which
 *   is what refuses `transferFrom` — otherwise unmetered.
 * - **A spend limit**, which meters `transfer` and `approve` *and* is what sets
 *   `isERC20WithSpendLimit`. Without it the gate is inert and the key is unbounded on this token.
 * - **No native limit**, so there is no second meter and nothing escapes the first.
 *
 * Two costs, neither hidden. Refusals happen during execution rather than validation, so an
 * over-limit payment is bundled and paid for before being rejected — callers should check the
 * limit before sending. And payee scoping does not survive here: the access list sees `0x3600` as
 * the target and never reads the recipient out of the calldata, which is exactly why a mandate
 * that names payees keeps the native rail instead.
 */
function meterEverythingOnOneRail(limit: Usdc): Hex[] {
  return USDC_RAILS.flatMap((rail) => [
    encodeFunctionData({
      abi: updatesAbi,
      functionName: "updateAccessListAddressEntry",
      args: [rail, true, true],
    }),
    encodeFunctionData({
      abi: updatesAbi,
      functionName: "setERC20SpendLimit",
      // ERC-20 scale: this rail is the 6-decimal view and the plugin compares the limit against
      // 6-decimal calldata. Native units here would authorise a million times what was agreed.
      args: [rail, limit.toErc20Units(), 0],
    }),
  ]);
}

function permissionUpdates(terms: MandateTerms): Hex[] {
  const scoped = terms.payees.length > 0;

  const updates: Hex[] = [
    encodeFunctionData({
      abi: updatesAbi,
      functionName: "setAccessListType",
      args: [scoped ? ACCESS_LIST.allowlist : ACCESS_LIST.denylist],
    }),
  ];

  for (const payee of terms.payees) {
    updates.push(encodeFunctionData({
      abi: updatesAbi,
      functionName: "updateAccessListAddressEntry",
      // `checkSelectors: false` — these are plain payees receiving value, not contracts whose
      // individual functions need gating.
      args: [payee, true, false],
    }));
  }

  if (scoped) {
    // The native rail, where the payee is the call's target and so naming payees means something.
    updates.push(encodeFunctionData({
      abi: updatesAbi,
      functionName: "setNativeTokenSpendLimit",
      args: [terms.limit.toNativeUnits(), 0],
    }));
  } else {
    // One meter on the ERC-20 rail, covering payments and x402 escrow alike. The native limit is
    // deliberately not set: its default of zero refuses every value-carrying call, which is what
    // leaves this the only rail and the limit the whole truth.
    if (terms.limit.toErc20Units() === 0n) {
      throw new MandateError(
        "A limit below 0.000001 USDC cannot be expressed on the rail an unscoped mandate uses.",
      );
    }
    updates.push(...meterEverythingOnOneRail(terms.limit));
  }

  // Gas is a third way to spend the same balance, and an unset limit denies rather than allows.
  // `type(uint256).max` is the engine's "no limit" sentinel, so one below it is the real ceiling.
  updates.push(encodeFunctionData({
    abi: updatesAbi,
    functionName: "setGasSpendLimit",
    args: [HIGHEST_REAL_LIMIT, 0],
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

/**
 * Only the updates a change actually asks for.
 *
 * **Naming payees scopes the mandate, and has to say so on the wire.** `updateAccessListAddressEntry`
 * puts an address on *the* list, and since `permissionUpdates` now chooses that list's meaning at
 * grant time, the same call allows or denies depending on which kind of mandate this is. On an
 * unscoped one — a denylist — adding a payee would have blocked exactly the address the caller
 * meant to permit, which is the worst possible way for an API to be wrong.
 *
 * So a change that names payees also sets the list back to an allowlist. That is the only reading
 * of "these are the payees" that is not a silent inversion, and it makes the second rail safe for
 * free: under an allowlist, anything unnamed — the ERC-20 view included — is already refused.
 */
function changeUpdates(change: MandateChange): Hex[] {
  const payees = change.addPayees ?? [];
  const updates: Hex[] = payees.length > 0
    ? [encodeFunctionData({
        abi: updatesAbi, functionName: "setAccessListType", args: [ACCESS_LIST.allowlist],
      })]
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
export async function isPluginDeployed(): Promise<boolean> {
  const code = await arcPublicClient.getCode({ address: SESSION_KEY_PLUGIN });
  return code !== undefined && code !== "0x";
}

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
export async function isPluginInstalled(address: Address): Promise<boolean> {
  if (!(await isDeployed(address))) return false;

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
/**
 * Sending a management operation the only way the account accepts one.
 *
 * `callData` rather than `calls`: viem's `calls` are encoded into `execute`/`executeBatch`, which
 * turns a management call into the account calling itself, and a self-call is runtime-validated.
 * The multisig implements no runtime validation, so the account refuses its own administration.
 * See `GrantPlan`.
 */
async function sendManagement(account: ArcAccount, callData: Hex): Promise<Hash> {
  return account.bundler.sendUserOperation({
    account: account.smartAccount,
    callData,
    ...(await fees(account)),
  });
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

export async function grantMandate(account: ArcAccount, terms: MandateTerms): Promise<GrantReceipt> {
  const plan = buildGrantPlan(terms, await isPluginInstalled(account.address));
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
): GrantPlan {
  if (terms.limit.isNegative() || terms.limit.isZero()) {
    throw new MandateError("a mandate must allow something; use revokeMandate to take one away");
  }

  const updates = permissionUpdates(terms);
  const tag = keccak256(toHex(terms.label ?? "mandate"));

  const management: Hex = pluginInstalled
    ? encodeFunctionData({
        abi: pluginAbi, functionName: "addSessionKey", args: [terms.agent, tag, updates],
      })
    : encodeFunctionData({
        abi: accountAbi,
        functionName: "installPlugin",
        args: [
          SESSION_KEY_PLUGIN,
          SESSION_KEY_PLUGIN_MANIFEST_HASH,
          // The plugin's own install payload: keys, tags, and their initial permissions.
          encodeInstallData([terms.agent], [tag], [updates]),
          [{ plugin: OWNER_PLUGIN, functionId: USER_OP_VALIDATION_OWNER }],
        ],
      });

  return { management };
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
  const predecessor = await arcPublicClient.readContract({
    address: SESSION_KEY_PLUGIN, abi: pluginAbi, functionName: "findPredecessor",
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

/** Every mandate this account has granted, read from the chain rather than remembered locally. */
export async function listMandates(address: Address): Promise<Mandate[]> {
  // An account that has never granted anything has no plugin data to read, and a network without
  // the plugin has no contract at all. Both are ordinary states, not failures, and both would
  // otherwise surface as a decoding error about missing return data.
  if (!(await isPluginDeployed())) return [];

  const agents = await arcPublicClient.readContract({
    address: SESSION_KEY_PLUGIN, abi: pluginAbi, functionName: "sessionKeysOf", args: [address],
  });
  return Promise.all(agents.map((agent) => readMandate(address, agent)));
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
  readonly limit: Usdc;
  readonly spent: Usdc;
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
      limit: Usdc.fromErc20Units(erc20.limit),
      spent: Usdc.fromErc20Units(erc20.limitUsed),
      // Both meters record a last-used time. The one that matters is the one doing the metering,
      // and on this shape the native meter never moves — reading it would report an agent that
      // has been spending all week as one that has never spent.
      lastUsedTime: erc20.lastUsedTime,
    };
  }
  return {
    rail: "native",
    limit: Usdc.fromNativeUnits(native.limit),
    spent: Usdc.fromNativeUnits(native.limitUsed),
    lastUsedTime: native.lastUsedTime,
  };
}

export async function readMandate(address: Address, agent: Address): Promise<Mandate> {
  const [spend, range, agentBalance, onlineLimit] = await Promise.all([
    arcPublicClient.readContract({
      address: SESSION_KEY_PLUGIN, abi: pluginAbi,
      functionName: "getNativeTokenSpendLimitInfo", args: [address, agent],
    }),
    arcPublicClient.readContract({
      address: SESSION_KEY_PLUGIN, abi: pluginAbi,
      functionName: "getKeyTimeRange", args: [address, agent],
    }),
    arcPublicClient.getBalance({ address: agent }),
    arcPublicClient.readContract({
      address: SESSION_KEY_PLUGIN, abi: pluginAbi,
      functionName: "getERC20SpendLimitInfo", args: [address, agent, ARC_CONTRACTS.usdc],
    }),
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
    remaining: spent.compare(limit) >= 0 ? Usdc.ZERO : limit.subtract(spent),
    ...(range[1] === 0 ? {} : { expiresAt: Number(range[1]) }),
    agentFloat: Usdc.fromNativeUnits(agentBalance),
    lastUsedAt: meter.lastUsedTime === 0 ? null : Number(meter.lastUsedTime),
  };
}
