import {
  encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, parseAbiParameters, toHex,
  type Address, type Hash, type Hex,
} from "viem";
import { getUserOperationGasPrice } from "@circle-fin/modular-wallets-core";
import { arcPublicClient, isDeployed } from "./client.ts";
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
  "function setAccessListType(uint8 contractAccessControlType)",
  "function setNativeTokenSpendLimit(uint256 spendLimit, uint48 refreshInterval)",
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
 * The mandate's native limit counts `call.value` on every call, whatever it targets, so a
 * value-carrying call to any address is already bounded. What escapes the count is a contract with
 * protocol-level authority to move the balance on the account's behalf — on Arc, the ERC-20 view,
 * where `transfer` moves the same dollars with `value == 0`.
 *
 * Exported because it is a claim about the chain, not an implementation detail: it says these are
 * *all* of them. `integration/arc-rails.test.mjs` re-derives the set from Arc and fails if the
 * chain ever grows one this list does not name — which is the single weakness of granting on a
 * denylist, made loud instead of silent.
 */
export const DENIED_RAILS: readonly Address[] = [
  "0x3600000000000000000000000000000000000000",
];

/**
 * Shutting the rail a denylist would otherwise leave open.
 *
 * Arc's dollar is the native token *and* an ERC-20 view over the same balance. A mandate bounds
 * native spending, and an ERC-20 `transfer` carries `value == 0` — so it moves the same dollars
 * without the native limit ever seeing them. Under an allowlist that call was refused for being
 * unlisted; under a denylist it has to be refused by name, or the limit on screen is half a bound.
 */
function denyTheSecondRail(): Hex[] {
  return DENIED_RAILS.map((rail) =>
    encodeFunctionData({
      abi: updatesAbi,
      functionName: "updateAccessListAddressEntry",
      args: [rail, true, false],
    }),
  );
}

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
}

/**
 * The permission calls that turn a bare session key into a bounded one.
 *
 * **Who a mandate may pay is decided here, and the default is a trap.** A new session key's
 * access control is `ALLOWLIST` with nothing on the list, and the plugin's per-call check opens
 * with `if (!contractData.isOnList) return false` — which covers a plain value transfer to an
 * ordinary address, not just contract calls. So granting an allowance without naming payees
 * produced a mandate that could not move a single wei, while reading on screen as a working
 * allowance with a limit and an expiry.
 *
 * Two shapes, then, and the list type has to match the intent:
 *
 * - **No payees named** — the product's default, because an agent shopping the open web does not
 *   know who it will pay. Invert to a `DENYLIST`, so anyone may be paid *except* the addresses
 *   named on it.
 * - **Payees named** — a genuinely scoped mandate. Keep the `ALLOWLIST`, where the empty-list
 *   default works in our favour: everything unnamed, including the second rail, is already shut.
 *
 * `ALLOW_ALL_ACCESS` is never used. It disables contract access control outright, and that is the
 * one setting that cannot close the ERC-20 rail.
 */
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

  if (!scoped) updates.push(...denyTheSecondRail());

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
  const plan = buildGrantPlan(account.address, terms, await isPluginInstalled(account.address));
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
 * `mcp/bundler.mjs`.
 */
export interface GrantPlan {
  /** The management operation. Goes in as the user operation's own `callData`, never nested. */
  readonly management: Hex;
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
export function buildGrantPlan(
  /** The granting account. Management calls target it, because that is where the plugin lives. */
  accountAddress: Address,
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

export async function readMandate(address: Address, agent: Address): Promise<Mandate> {
  const [spend, range, agentBalance] = await Promise.all([
    arcPublicClient.readContract({
      address: SESSION_KEY_PLUGIN, abi: pluginAbi,
      functionName: "getNativeTokenSpendLimitInfo", args: [address, agent],
    }),
    arcPublicClient.readContract({
      address: SESSION_KEY_PLUGIN, abi: pluginAbi,
      functionName: "getKeyTimeRange", args: [address, agent],
    }),
    arcPublicClient.getBalance({ address: agent }),
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
    agentFloat: Usdc.fromNativeUnits(agentBalance),
    lastUsedAt: spend.lastUsedTime === 0 ? null : Number(spend.lastUsedTime),
  };
}
