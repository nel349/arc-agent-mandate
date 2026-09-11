import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { decodeAbiParameters, decodeFunctionData, getAddress, parseAbi, parseAbiParameters, type Hex } from "viem";
import {
  buildChangeCallData, buildGrantPlan, meterInForce, SESSION_KEY_PLUGIN,
  SESSION_KEY_PLUGIN_MANIFEST_HASH, type MandateTerms,
} from "./mandate.ts";
import { Usdc } from "./usdc.ts";
import { pairingTag } from "../../mcp/pairing.ts";

/**
 * These two constants are the SDK's only hard links to the deployed contract. If either drifts,
 * `installPlugin` fails on-chain with a hash mismatch or the calls go to the wrong address — so
 * they are checked against the compiled contract rather than trusted.
 */
const forge = (args: string[]) =>
  execFileSync("forge", args, {
    cwd: new URL("../../contracts", import.meta.url).pathname,
    env: { ...process.env, FOUNDRY_DISABLE_NIGHTLY_WARNING: "1" },
    encoding: "utf8",
  });

test("the manifest hash matches the compiled plugin", () => {
  const out = forge(["script", "script/DeploySessionKeyPlugin.s.sol", "--sig", "manifestHash()"]);
  const hash = out.match(/0x[0-9a-f]{64}/)?.[0];
  assert.equal(
    hash,
    SESSION_KEY_PLUGIN_MANIFEST_HASH,
    "installPlugin verifies this hash; a stale constant fails on-chain, not here",
  );
});

test("the plugin address matches where CREATE2 will put it", () => {
  const out = forge(["script", "script/DeploySessionKeyPlugin.s.sol"]);
  const predicted = out.match(/predicted address:\s*(0x[0-9a-fA-F]{40})/)?.[1];
  assert.equal(predicted?.toLowerCase(), SESSION_KEY_PLUGIN.toLowerCase());
});

// ---- what a grant actually sends -------------------------------------------

const AGENT = "0x1f940d717c07c0ff7289771e61da39fd6143F107" as const;
const terms = (extra: Partial<MandateTerms> = {}): MandateTerms => ({
  agent: AGENT, limit: Usdc.parse("10"), payees: [], ...extra,
});

/**
 * `onInstall` decodes (address[], bytes32[], bytes[][]) out of `pluginInstallData`. Getting that
 * shape wrong is not a type error anywhere — it surfaces as a revert during install, on the first
 * grant a person ever makes.
 *
 * So this decodes the payload our own builder produced, rather than encoding a fixture and
 * decoding it again: a round trip through viem agrees with itself whatever parameter string we
 * pass, and would have said yes to an install payload the plugin cannot read.
 */
test("the install payload we send decodes as the shape the plugin's onInstall reads", async () => {
  const { decodeFunctionData, parseAbi } = await import("viem");
  const call = decodeFunctionData({
    abi: parseAbi(["function installPlugin(address plugin, bytes32 manifestHash, bytes pluginInstallData, (address plugin, uint8 functionId)[] dependencies)"]),
    data: buildGrantPlan(terms(), false).management,
  });
  assert.equal(call.functionName, "installPlugin");
  const [plugin, manifestHash, installData] = call.args;

  assert.equal(plugin, SESSION_KEY_PLUGIN, "the grant installs some other contract");
  assert.equal(manifestHash, SESSION_KEY_PLUGIN_MANIFEST_HASH, "installPlugin verifies this on chain");

  const [keys, tags, updates] =
    decodeAbiParameters(parseAbiParameters("address[], bytes32[], bytes[][]"), installData);
  assert.deepEqual(keys, [AGENT], "the key being installed is not the agent the terms named");
  assert.equal(tags.length, 1, "one key, one tag");
  assert.equal(updates.length, 1, "one key, one list of permission updates");
  assert.ok(updates[0] !== undefined && updates[0].length > 0,
    "a key installed with no permissions can spend nothing, which is not what a grant means");
});

/**
 * The agent spends only from a grant carrying the pairing code its QR showed. A grant that dropped
 * the code would be ignored, and the person would see an allowance the agent never uses.
 */
test("a grant made from the agent's code carries its pairing code as the tag", async () => {
  const { decodeFunctionData, parseAbi } = await import("viem");
  const abi = parseAbi(["function addSessionKey(address sessionKey, bytes32 tag, bytes[] permissionUpdates)"]);
  const code = "0123456789abcdef0123456789abcdef";

  const scanned = decodeFunctionData({ abi, data: buildGrantPlan(terms({ pairing: code }), true).management });
  assert.equal(scanned.args[1], pairingTag(code));

  const typed = decodeFunctionData({ abi, data: buildGrantPlan(terms({ label: "agent" }), true).management });
  assert.notEqual(typed.args[1], pairingTag(code), "a grant with no code carried one anyway");
});

test("the first grant installs the plugin; later ones only add a key", async () => {
  const { decodeFunctionData, parseAbi } = await import("viem");
  const first = buildGrantPlan(terms(), false);
  const later = buildGrantPlan(terms(), true);

  const nameOf = (data: `0x${string}`, sig: string) =>
    decodeFunctionData({ abi: parseAbi([sig]), data }).functionName;

  assert.equal(
    nameOf(first.management, "function installPlugin(address plugin, bytes32 manifestHash, bytes pluginInstallData, (address plugin, uint8 functionId)[] dependencies)"),
    "installPlugin",
  );
  assert.equal(
    nameOf(later.management, "function addSessionKey(address sessionKey, bytes32 tag, bytes[] permissionUpdates)"),
    "addSessionKey",
  );
});

/**
 * The management half is calldata, not a call to somewhere.
 *
 * It goes in as the user operation's own `callData`, so its target is the sender by construction.
 * Expressing it as a call to the account is what produced the bug this shape replaced: viem
 * encoded the "call" into `executeBatch`, the account called itself, and a self-call is
 * runtime-validated — which the multisig does not implement. Measured on live Arc:
 * `executeBatch(install + float)` and `execute(install)` both revert with
 * `RuntimeValidationFailed`; the same install as top-level `callData` estimates cleanly.
 */
test("the management half is bare calldata, with nowhere to nest it", () => {
  for (const installed of [true, false]) {
    const plan = buildGrantPlan(terms(), installed);
    assert.match(plan.management, /^0x[0-9a-f]+$/i);
    assert.ok(!("to" in plan), "a target would invite wrapping it in execute, which the account refuses");
  }
});

test("a grant that allows nothing is refused", () => {
  assert.throws(() => buildGrantPlan(terms({ limit: Usdc.ZERO }), true), /allow something/);
  assert.throws(() => buildGrantPlan(terms({ limit: Usdc.parse("-5") }), true), /allow something/);
});

/**
 * What a grant lets the agent's key call, read back the way the plugin will read it.
 *
 * Every allowance is an allowlist, so this list is the whole of it: anything it does not name is
 * refused before it runs. It is asserted in full and in order rather than by searching the calldata
 * for a fragment, because the dangerous mistakes here are an extra entry or a wrong flag, and
 * neither shows up as a missing substring. Unscoped allowances used to be denylists, which let the
 * agent make any zero-value call from the wallet: `integration/allowance.test.ts` runs this same
 * calldata against the real plugin, including the identity transfer the old shape allowed.
 */
/** `setAccessListType(uint8)`, with ALLOWLIST = 0. */
const ALLOWLIST_CALL = "0x8f2920d8" + "0".padStart(64, "0");

const grantAbi = parseAbi(["function addSessionKey(address sessionKey, bytes32 tag, bytes[] permissionUpdates)"]);
const changeAbi = parseAbi(["function updateKeyPermissions(address sessionKey, bytes[] updates)"]);
const permissionAbi = parseAbi([
  "function setAccessListType(uint8 contractAccessControlType)",
  "function updateAccessListAddressEntry(address contractAddress, bool isOnList, bool checkSelectors)",
  "function updateAccessListFunctionEntry(address contractAddress, bytes4 selector, bool isOnList)",
  "function setNativeTokenSpendLimit(uint256 spendLimit, uint48 refreshInterval)",
  "function setERC20SpendLimit(address token, uint256 spendLimit, uint48 refreshInterval)",
  "function setGasSpendLimit(uint256 spendLimit, uint48 refreshInterval)",
  "function updateTimeRange(uint48 validAfter, uint48 validUntil)",
]);

/** One permission update: which one, and its arguments as the plugin decodes them. */
type Permission = readonly unknown[];

const readPermissions = (updates: readonly Hex[]): Permission[] =>
  updates.map((update) => {
    const { functionName, args } = decodeFunctionData({ abi: permissionAbi, data: update });
    return [functionName, ...args];
  });

const grantedPermissions = (grant: MandateTerms): Permission[] =>
  readPermissions(decodeFunctionData({ abi: grantAbi, data: buildGrantPlan(grant, true).management }).args[2]);

const USDC_VIEW = getAddress("0x3600000000000000000000000000000000000000");
const GATEWAY = getAddress("0x0077777d7EBA4688BDeF3E311b846F25870A19B9");
const IDENTITY_REGISTRY = getAddress("0x8004A818BFB912233c491871b3d84c89A494BD9e");
const PAYEE = getAddress("0x2222222222222222222222222222222222222222");
const EXPIRES_AT = 1_800_000_000;
const ALLOWLIST = 0;
/** One below `type(uint256).max`, the highest real ceiling. See `HIGHEST_REAL_LIMIT`. */
const GAS_CEILING = (1n << 256n) - 2n;
const NO_LIMIT = (1n << 256n) - 1n;

/**
 * From `cast sig`, so the list is checked against the selectors themselves rather than against the
 * code that computes them.
 */
const SELECTOR = {
  transfer: "0xa9059cbb",
  approve: "0x095ea7b3",
  depositFor: "0xb3db428b",
  register: "0x1aa3a008",
  setAgentWallet: "0x2d1ef5ae",
} as const;

/** The agent's own identity: registering one for the wallet, and linking its key. Never moving one. */
const IDENTITY_SETUP: readonly Permission[] = [
  ["updateAccessListAddressEntry", IDENTITY_REGISTRY, true, true],
  ["updateAccessListFunctionEntry", IDENTITY_REGISTRY, SELECTOR.register, true],
  ["updateAccessListFunctionEntry", IDENTITY_REGISTRY, SELECTOR.setAgentWallet, true],
];

test("an unscoped allowance is an allowlist naming exactly what an agent calls, and nothing else", () => {
  assert.deepEqual(grantedPermissions(terms({ payees: [], expiresAt: EXPIRES_AT })), [
    ["setAccessListType", ALLOWLIST],
    // Paying someone and approving a top-up, on the one metered rail. Not `transferFrom`.
    ["updateAccessListAddressEntry", USDC_VIEW, true, true],
    ["updateAccessListFunctionEntry", USDC_VIEW, SELECTOR.transfer, true],
    ["updateAccessListFunctionEntry", USDC_VIEW, SELECTOR.approve, true],
    ["setERC20SpendLimit", USDC_VIEW, 10_000_000n, 0],
    // Filling its escrow at Circle's Gateway, and nothing else there.
    ["updateAccessListAddressEntry", GATEWAY, true, true],
    ["updateAccessListFunctionEntry", GATEWAY, SELECTOR.depositFor, true],
    ...IDENTITY_SETUP,
    ["setGasSpendLimit", GAS_CEILING, 0],
    ["updateTimeRange", 0, EXPIRES_AT],
  ]);
});

test("a scoped allowance names its payees and the identity setup, never the USDC view or the Gateway", () => {
  assert.deepEqual(grantedPermissions(terms({ payees: [PAYEE], expiresAt: EXPIRES_AT })), [
    ["setAccessListType", ALLOWLIST],
    ["updateAccessListAddressEntry", PAYEE, true, false],
    ["setNativeTokenSpendLimit", 10n * 10n ** 18n, 0],
    ...IDENTITY_SETUP,
    ["setGasSpendLimit", GAS_CEILING, 0],
    ["updateTimeRange", 0, EXPIRES_AT],
  ]);
});

/**
 * Scoping turns the ERC-20 limit off, and on the one-meter shape the USDC view is listed with
 * `transfer` named. Left on the list, a transfer would move money no meter counts, so the change has
 * to take the view off the list as well as its limit.
 */
test("scoping a live mandate takes the USDC view and the Gateway off the list, not only their limit", () => {
  const { args } = decodeFunctionData({
    abi: changeAbi,
    data: buildChangeCallData(AGENT, { limit: Usdc.parse("10"), rail: "erc20", addPayees: [PAYEE] }),
  });
  assert.equal(args[0], getAddress(AGENT));
  assert.deepEqual(readPermissions(args[1]), [
    ["setAccessListType", ALLOWLIST],
    ["updateAccessListAddressEntry", USDC_VIEW, false, false],
    ["updateAccessListAddressEntry", GATEWAY, false, false],
    ...IDENTITY_SETUP,
    ["updateAccessListAddressEntry", PAYEE, true, false],
    ["setNativeTokenSpendLimit", 10n * 10n ** 18n, 0],
    ["setERC20SpendLimit", USDC_VIEW, NO_LIMIT, 0],
  ]);
});

test("an unscoped allowance names the ERC-20 view, because it meters it", () => {
  const data = buildGrantPlan(terms({ payees: [] }), true).management.toLowerCase();
  assert.ok(
    data.includes("3600000000000000000000000000000000000000"),
    "the ERC-20 view is unnamed, so nothing reaches the plugin's selector gate and the key is " +
      "unbounded on that token",
  );
});

test("a scoped allowance keeps the allowlist, where unnamed targets are already shut", () => {
  const payee = "0x2222222222222222222222222222222222222222" as const;
  const data = buildGrantPlan(terms({ payees: [payee] }), true).management.toLowerCase();
  assert.ok(data.includes(ALLOWLIST_CALL.slice(2)), "a scoped mandate must stay on an allowlist");
  assert.ok(data.includes(payee.slice(2)), "the named payee is not on the list");
  assert.ok(
    !data.includes("3600000000000000000000000000000000000000"),
    "an allowlist should not need the ERC-20 view named; unlisted is already refused",
  );
});

test("an allowance with no payees is allowed, and bounds money and time instead", () => {
  // Requiring payees up front cannot work: an agent does not know who it will pay until it finds
  // a service, so an allowance with none has to be grantable.
  assert.doesNotThrow(() => buildGrantPlan(terms({ payees: [] }), true));
});

/**
 * `updateAccessListAddressEntry` means "allow" on an allowlist and "deny" on a denylist. Unscoped
 * mandates granted before 09-11 are denylists, so a change that names payees must also set the list
 * to an allowlist, or it blocks precisely the address the caller meant to permit.
 */
test("naming payees in a change scopes the mandate rather than blocking them", () => {
  const payee = "0x3333333333333333333333333333333333333333" as const;
  const data = buildChangeCallData(AGENT, { addPayees: [payee] }).toLowerCase();
  assert.ok(
    data.includes(ALLOWLIST_CALL.slice(2)),
    "a change naming payees left the list inverted, so the payee would have been denied",
  );
  assert.ok(data.includes(payee.slice(2)));
});

test("a change that names no payees does not touch the access list type", () => {
  const data = buildChangeCallData(AGENT, { limit: Usdc.parse("5"), rail: "erc20" }).toLowerCase();
  assert.ok(!data.includes("8f2920d8"), "an unrelated change silently re-scoped the mandate");
});

/**
 * One meter, which is what lets the phone show one number.
 *
 * Arc's dollar moves two ways and the plugin meters them separately, so a mandate carrying both a
 * native limit and an ERC-20 one permits their sum. An unscoped mandate therefore uses **only**
 * the ERC-20 rail — payments and x402 escrow alike — and leaves the native limit at its default of
 * zero, which refuses every value-carrying call. `contracts/test/ArcOneMeter.t.sol` proves the
 * resulting permissions behave against the real plugin; these pin the calldata that asks for them.
 */
const SET_ERC20_LIMIT = "7b1f0893";
const SET_NATIVE_LIMIT = "b3a26f5c";
const ERC20_VIEW = "3600000000000000000000000000000000000000";

test("an unscoped allowance is metered on the ERC-20 rail and nowhere else", () => {
  const data = buildGrantPlan(terms({ payees: [] }), true).management.toLowerCase();
  assert.ok(data.includes(SET_ERC20_LIMIT), "nothing meters the rail the agent actually spends on");
  assert.ok(
    !data.includes(SET_NATIVE_LIMIT),
    "a native limit beside the ERC-20 one is a second meter, and two meters cannot be one number",
  );
});

test("a scoped allowance is metered natively, where naming payees means something", () => {
  const payee = "0x2222222222222222222222222222222222222222" as const;
  const data = buildGrantPlan(terms({ payees: [payee] }), true).management.toLowerCase();
  assert.ok(data.includes(SET_NATIVE_LIMIT), "a scoped mandate must meter the rail it can scope");
  assert.ok(
    !data.includes(SET_ERC20_LIMIT),
    "an ERC-20 limit here would let the agent pay anyone, since the recipient is calldata the " +
      "access list never reads",
  );
});

/**
 * The million-times bug this scale invites. The rail is the 6-decimal view and the plugin compares
 * the limit against 6-decimal calldata, so passing native units would authorise a million times
 * what the person on the phone agreed to — and would look entirely plausible on screen.
 */
test("an unscoped limit is written at ERC-20 scale, not native scale", () => {
  const data = buildGrantPlan(
    terms({ payees: [], limit: Usdc.parse("5") }), true,
  ).management.toLowerCase();
  const call = data.slice(data.indexOf(SET_ERC20_LIMIT));
  const [, limit] = decodeAbiParameters(
    parseAbiParameters("address, uint256, uint48"),
    `0x${call.slice(8, 8 + 192)}`,
  );
  assert.equal(limit, 5_000_000n, "5 USDC is 5e6 through the ERC-20 view, not 5e18");
});

test("a scoped limit stays at native scale", () => {
  const payee = "0x2222222222222222222222222222222222222222" as const;
  const data = buildGrantPlan(
    terms({ payees: [payee], limit: Usdc.parse("5") }), true,
  ).management.toLowerCase();
  const call = data.slice(data.indexOf(SET_NATIVE_LIMIT));
  const [limit] = decodeAbiParameters(parseAbiParameters("uint256, uint48"), `0x${call.slice(8, 8 + 128)}`);
  assert.equal(limit, 5_000_000_000_000_000_000n);
});

test("an unscoped limit too small for its rail is refused, not silently rounded to nothing", () => {
  // Native scale can express it and the rail cannot, so it would grant a live-looking mandate
  // that refuses every payment — the exact failure ArcPayeeScope was written about.
  assert.throws(
    () => buildGrantPlan(terms({ payees: [], limit: Usdc.parse("0.0000001") }), true),
    /cannot be expressed/,
  );
});

/**
 * Changing a limit has to change the meter that is in force. There is no way to tell from here —
 * this builds calldata and never reads the chain — and guessing wrong is silent in the worst
 * direction: the real limit stays put and a second meter appears beside it, so the agent ends up
 * with more authority than the change asked for.
 */
test("changing a limit without saying which rail is refused rather than guessed", () => {
  assert.throws(
    () => buildChangeCallData(AGENT, { limit: Usdc.parse("10") }),
    /which rail/,
  );
});

test("a limit change on an unscoped mandate moves the ERC-20 meter", () => {
  const data = buildChangeCallData(AGENT, { limit: Usdc.parse("10"), rail: "erc20" }).toLowerCase();
  assert.ok(data.includes(SET_ERC20_LIMIT));
  assert.ok(!data.includes(SET_NATIVE_LIMIT));
});

test("a limit change on a scoped mandate moves the native meter", () => {
  const data = buildChangeCallData(AGENT, { limit: Usdc.parse("10"), rail: "native" }).toLowerCase();
  assert.ok(data.includes(SET_NATIVE_LIMIT));
  assert.ok(!data.includes(SET_ERC20_LIMIT));
});

/**
 * Naming payees moves a mandate onto the native rail, and the old meter has to be turned off on
 * the way. Left live it would sit beside the new one, and the mandate would permit both — a
 * re-scope that widens what it was asked to narrow.
 */
test("scoping a previously unscoped mandate turns off the rail it is leaving", () => {
  const payee = "0x2222222222222222222222222222222222222222" as const;
  const data = buildChangeCallData(AGENT, {
    limit: Usdc.parse("10"), rail: "erc20", addPayees: [payee],
  }).toLowerCase();
  assert.ok(data.includes(SET_NATIVE_LIMIT), "the new meter");
  const disable = data.slice(data.indexOf(SET_ERC20_LIMIT));
  const [token, limit] = decodeAbiParameters(
    parseAbiParameters("address, uint256, uint48"),
    `0x${disable.slice(8, 8 + 192)}`,
  );
  assert.equal(token.toLowerCase(), `0x${ERC20_VIEW}`);
  assert.equal(limit, (1n << 256n) - 1n, "uint256 max is the engine's sentinel for 'no limit'");
});

// ---- which meter the card reads ---------------------------------------------

/**
 * One number on the phone, read from whichever meter is actually in force.
 *
 * The rails are 6 and 18 decimals over one balance. Reading the ERC-20 meter at native scale (or
 * the other way round) is a factor of a million, and both figures look like money on a screen.
 */
const nativeMeter = (limit: bigint, used: bigint, lastUsedTime = 0) =>
  ({ limit, limitUsed: used, lastUsedTime });

test("an unscoped mandate reads the ERC-20 meter, at ERC-20 scale", () => {
  const meter = meterInForce(
    nativeMeter(0n, 0n, 0),
    { hasLimit: true, limit: 10_000_000n, limitUsed: 2_500_000n, lastUsedTime: 1_700_000_000 },
  );
  assert.equal(meter.rail, "erc20");
  assert.equal(meter.limit.format(2), "10.00", "10 USDC, not 10e-12 of one");
  assert.equal(meter.spent.format(2), "2.50");
  assert.equal(
    meter.lastUsedTime, 1_700_000_000,
    "the native meter never moves on this shape, so reading its clock reports an idle agent",
  );
});

test("a scoped mandate reads the native meter, at native scale", () => {
  const meter = meterInForce(
    nativeMeter(10n * 10n ** 18n, 25n * 10n ** 17n, 1_700_000_500),
    { hasLimit: false, limit: 0n, limitUsed: 0n, lastUsedTime: 0 },
  );
  assert.equal(meter.rail, "native");
  assert.equal(meter.limit.format(2), "10.00", "10 USDC, not 10 million of them");
  assert.equal(meter.spent.format(2), "2.50");
  assert.equal(meter.lastUsedTime, 1_700_000_500);
});

test("an ERC-20 limit in force wins even when a native limit is also set", () => {
  // Both meters live would permit their sum, which is the state the one-meter design exists to
  // prevent. If one is ever seen, the ERC-20 rail is the one the agent actually spends on.
  const meter = meterInForce(
    nativeMeter(99n * 10n ** 18n, 0n),
    { hasLimit: true, limit: 5_000_000n, limitUsed: 0n, lastUsedTime: 0 },
  );
  assert.equal(meter.rail, "erc20");
  assert.equal(meter.limit.format(2), "5.00");
});
