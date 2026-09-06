import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { decodeAbiParameters, parseAbiParameters } from "viem";
import {
  buildChangeCallData, buildGrantPlan, SESSION_KEY_PLUGIN, SESSION_KEY_PLUGIN_MANIFEST_HASH,
  type MandateTerms,
} from "./mandate.ts";
import { Usdc } from "./usdc.ts";

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

test("install data round-trips through the ABI encoding the plugin expects", async () => {
  // `onInstall` decodes (address[], bytes32[], bytes[][]). Getting this shape wrong is not a
  // type error anywhere — it surfaces as a revert during install.
  const { encodeAbiParameters } = await import("viem");
  const keys = ["0x1111111111111111111111111111111111111111"] as const;
  const tags = ["0x" + "ab".repeat(32)] as const;
  const updates = [["0xdeadbeef"]] as const;

  const encoded = encodeAbiParameters(parseAbiParameters("address[], bytes32[], bytes[][]"),
    [keys as never, tags as never, updates as never]);
  const [gotKeys, gotTags, gotUpdates] =
    decodeAbiParameters(parseAbiParameters("address[], bytes32[], bytes[][]"), encoded);

  assert.deepEqual(gotKeys, keys);
  assert.deepEqual(gotTags, tags);
  assert.deepEqual(gotUpdates, updates);
});

// ---- what a grant actually sends -------------------------------------------

const ACCOUNT = "0xa8546Ff7D7Fcd3BBd08C0ef31E74C73DF6BcC447" as const;
const AGENT = "0x1f940d717c07c0ff7289771e61da39fd6143F107" as const;
const terms = (extra: Partial<MandateTerms> = {}): MandateTerms => ({
  agent: AGENT, limit: Usdc.parse("10"), payees: [], ...extra,
});

test("the first grant installs the plugin; later ones only add a key", async () => {
  const { decodeFunctionData, parseAbi } = await import("viem");
  const first = buildGrantPlan(ACCOUNT, terms(), false);
  const later = buildGrantPlan(ACCOUNT, terms(), true);

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
    const plan = buildGrantPlan(ACCOUNT, terms(), installed);
    assert.match(plan.management, /^0x[0-9a-f]+$/i);
    assert.ok(!("to" in plan), "a target would invite wrapping it in execute, which the account refuses");
  }
});

test("a grant that allows nothing is refused", () => {
  assert.throws(() => buildGrantPlan(ACCOUNT, terms({ limit: Usdc.ZERO }), true), /allow something/);
  assert.throws(() => buildGrantPlan(ACCOUNT, terms({ limit: Usdc.parse("-5") }), true), /allow something/);
});

/**
 * The plugin's access control defaults to an ALLOWLIST, and an empty allowlist refuses everything
 * — including a plain transfer to an ordinary address. An unscoped mandate therefore has to
 * invert the list, and then shut the ERC-20 view by name, because a denylist would otherwise
 * leave the second rail open. `contracts/test/ArcPayeeScope.t.sol` proves all three halves
 * against the real plugin.
 */
/** `setAccessListType(uint8)`, with DENYLIST = 1 and ALLOWLIST = 0. */
const DENYLIST_CALL = "0x8f2920d8" + "1".padStart(64, "0");
const ALLOWLIST_CALL = "0x8f2920d8" + "0".padStart(64, "0");

test("an unscoped allowance inverts the access list, or it could not pay anyone", () => {
  const data = buildGrantPlan(ACCOUNT, terms({ payees: [] }), true).management.toLowerCase();
  assert.ok(data.includes(DENYLIST_CALL.slice(2)), "the access list was not inverted to a denylist");
});

test("an unscoped allowance names the ERC-20 view, because it meters it", () => {
  const data = buildGrantPlan(ACCOUNT, terms({ payees: [] }), true).management.toLowerCase();
  assert.ok(
    data.includes("3600000000000000000000000000000000000000"),
    "the ERC-20 view is unnamed, so nothing reaches the plugin's selector gate and the key is " +
      "unbounded on that token",
  );
});

test("a scoped allowance keeps the allowlist, where unnamed targets are already shut", () => {
  const payee = "0x2222222222222222222222222222222222222222" as const;
  const data = buildGrantPlan(ACCOUNT, terms({ payees: [payee] }), true).management.toLowerCase();
  assert.ok(data.includes(ALLOWLIST_CALL.slice(2)), "a scoped mandate must stay on an allowlist");
  assert.ok(data.includes(payee.slice(2)), "the named payee is not on the list");
  assert.ok(
    !data.includes("3600000000000000000000000000000000000000"),
    "an allowlist should not need the ERC-20 view named; unlisted is already refused",
  );
});

test("an allowance with no payees is allowed, and bounds money and time instead", () => {
  // Requiring payees up front cannot work: an agent does not know who it will pay until it finds
  // a service. See agent-mandate/UX_FLOW.md.
  assert.doesNotThrow(() => buildGrantPlan(ACCOUNT, terms({ payees: [] }), true));
});

/**
 * `updateAccessListAddressEntry` means "allow" on an allowlist and "deny" on a denylist. Since an
 * unscoped mandate is granted as a denylist, a change that names payees must also flip the list
 * back, or it blocks precisely the address the caller meant to permit.
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
  const data = buildGrantPlan(ACCOUNT, terms({ payees: [] }), true).management.toLowerCase();
  assert.ok(data.includes(SET_ERC20_LIMIT), "nothing meters the rail the agent actually spends on");
  assert.ok(
    !data.includes(SET_NATIVE_LIMIT),
    "a native limit beside the ERC-20 one is a second meter, and two meters cannot be one number",
  );
});

test("a scoped allowance is metered natively, where naming payees means something", () => {
  const payee = "0x2222222222222222222222222222222222222222" as const;
  const data = buildGrantPlan(ACCOUNT, terms({ payees: [payee] }), true).management.toLowerCase();
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
    ACCOUNT, terms({ payees: [], limit: Usdc.parse("5") }), true,
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
    ACCOUNT, terms({ payees: [payee], limit: Usdc.parse("5") }), true,
  ).management.toLowerCase();
  const call = data.slice(data.indexOf(SET_NATIVE_LIMIT));
  const [limit] = decodeAbiParameters(parseAbiParameters("uint256, uint48"), `0x${call.slice(8, 8 + 128)}`);
  assert.equal(limit, 5_000_000_000_000_000_000n);
});

test("an unscoped limit too small for its rail is refused, not silently rounded to nothing", () => {
  // Native scale can express it and the rail cannot, so it would grant a live-looking mandate
  // that refuses every payment — the exact failure ArcPayeeScope was written about.
  assert.throws(
    () => buildGrantPlan(ACCOUNT, terms({ payees: [], limit: Usdc.parse("0.0000001") }), true),
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
