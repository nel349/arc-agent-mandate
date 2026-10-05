import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeAbiParameters, decodeFunctionData, encodeFunctionData, getAddress, keccak256, parseAbi, parseAbiParameters, toFunctionSelector, toHex, type Address, type Hex } from "viem";
import { ARC_GRANTS_BEFORE_THE_MOVE } from "./fixtures/arcGrantsBeforeTheMove.ts";
import {
  ACCESS_LIST, GrantError, grantCallData, grantTag, identityCalls, HIGHEST_REAL_LIMIT, PAYEES_REQUIRED, payeesRequired, permissionUpdates, permissionUpdatesAbi, PLAIN_TRANSFER, railOf,
  SESSION_KEY_PLUGIN_MANIFEST_HASH, type AllowedCalls, type GrantTerms,
} from "./grant.ts";
import { ARC_TESTNET, MONAD_TESTNET } from "./networks.ts";
import { pairingTag } from "./pairing.ts";

/**
 * A grant is what a person signs to give an agent authority, so these check what it says rather than
 * that it encodes: on Arc, the same bytes the wallet granted before the code moved here; on Monad, a
 * limit on MON that names who may be paid, read back out of the encoding and checked line by line.
 */

const AGENT: Address = "0x2D72f28b6b5600eE2C1285aEE6C472766598350B";
const PAYEES: Address[] = [getAddress("0x00000000000000000000000000000000000000aa"), getAddress("0x1111111111111111111111111111111111111111")];
const ONE = 10n ** 18n;

/** What the Arc wallet allows besides paying, as it always has: its escrow at Circle's Gateway, and its identity. */
const ESCROW: AllowedCalls = { contract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9", functions: ["depositFor(address,address,uint256)"] };
const IDENTITY: AllowedCalls = identityCalls(ARC_TESTNET);
/** the Arc wallet allows its escrow only on a grant that names no payees, and its identity on every grant */
const arcCalls = (payees: readonly Address[]): AllowedCalls[] => (payees.length === 0 ? [ESCROW, IDENTITY] : [IDENTITY]);

const lower = (addresses: readonly Address[]): Address[] => addresses.map((address) => address.toLowerCase() as Address);

const arc = (terms: Omit<GrantTerms, "calls">, installed: boolean): Hex =>
  grantCallData(ARC_TESTNET, { ...terms, calls: arcCalls(terms.payees) }, installed);

test("on Arc, a grant naming no payees is byte for byte what the wallet signed before the code moved here", () => {
  assert.equal(arc({ agent: AGENT, limit: 5n * ONE, payees: [], pairing: "0123456789abcdef0123456789abcdef" }, false), ARC_GRANTS_BEFORE_THE_MOVE.unscopedScanned);
  assert.equal(arc({ agent: AGENT, limit: ONE / 2n, payees: [], label: "maze", expiresAt: 1_790_000_000 }, true), ARC_GRANTS_BEFORE_THE_MOVE.unscopedLabelledExpiring);
});

/**
 * A grant naming payees changed on purpose, 5 Oct, when the agent became able to call functions: a
 * payee used to be listed with any of its functions callable, which only plain transfers made safe.
 * Everything else in those grants is as before, which is what this checks against the fixtures.
 */
test("on Arc, a grant naming payees differs from the old one only in its payees, now plain transfers", () => {
  const permissionsOf = (data: Hex, installed: boolean): readonly Hex[] => installed
    ? decodeFunctionData({ abi: parseAbi(["function addSessionKey(address, bytes32, bytes[])"]), data }).args[2]
    : decodeAbiParameters(parseAbiParameters("address[], bytes32[], bytes[][]"), decodeFunctionData({
        abi: parseAbi(["function installPlugin(address, bytes32, bytes, (address plugin, uint8 functionId)[])"]), data,
      }).args[2])[2][0] ?? [];
  const tightened = (old: readonly Hex[]): Hex[] => old.flatMap((update) => {
    const { name, args } = read([update])[0] ?? { name: "", args: [] };
    if (name !== "updateAccessListAddressEntry" || args[2] !== false) return [update];
    const payee = args[0] as Address;
    return [
      encodeFunctionData({ abi: permissionUpdatesAbi, functionName: "updateAccessListAddressEntry", args: [payee, true, true] }),
      encodeFunctionData({ abi: permissionUpdatesAbi, functionName: "updateAccessListFunctionEntry", args: [payee, PLAIN_TRANSFER, true] }),
    ];
  });
  const scanned = { agent: AGENT, limit: (5n * ONE) / 4n, payees: lower(PAYEES), pairing: "fedcba9876543210fedcba9876543210" };
  assert.deepEqual(permissionsOf(arc(scanned, false), false), tightened(permissionsOf(ARC_GRANTS_BEFORE_THE_MOVE.scopedScanned, false)));
  const labelled = { agent: AGENT, limit: 2n * ONE, payees: lower(PAYEES.slice(0, 1)), label: "rent", expiresAt: 1_800_000_000 };
  assert.deepEqual(permissionsOf(arc(labelled, true), true), tightened(permissionsOf(ARC_GRANTS_BEFORE_THE_MOVE.scopedLabelledExpiring, true)));
});

/** A grant's permissions, decoded back into what each one says. */
function read(updates: readonly Hex[]): { readonly name: string; readonly args: readonly unknown[] }[] {
  return updates.map((update) => {
    const { functionName, args } = decodeFunctionData({ abi: permissionUpdatesAbi, data: update });
    return { name: functionName, args: args ?? [] };
  });
}

const POD_JOBS: AllowedCalls = { contract: "0xc831b6e4414E064F7713A3b6017be4a1Eb9F5E9b", functions: ["takeSeat(uint256,uint8,address)"] };

test("on Monad the limit is on MON itself, at full precision, and the payees named are the only ones payable", () => {
  const limit = 10n ** 16n + 7n; // 0.01 MON and seven wei: nothing is rounded away
  const updates = read(permissionUpdates(MONAD_TESTNET, { agent: AGENT, limit, payees: PAYEES }));
  assert.deepEqual(updates.map((update) => update.name), [
    "setAccessListType",
    "updateAccessListAddressEntry", "updateAccessListFunctionEntry", "updateAccessListAddressEntry", "updateAccessListFunctionEntry",
    "setNativeTokenSpendLimit", "setGasSpendLimit",
  ]);
  assert.deepEqual(updates[0]?.args, [ACCESS_LIST.allowlist]);
  // a payee receives the coin and nothing else: its functions are checked, and only the plain transfer is allowed
  assert.deepEqual(updates.slice(1, 5).map((update) => update.args), PAYEES.flatMap((payee) => [[payee, true, true], [payee, PLAIN_TRANSFER, true]]));
  assert.deepEqual(updates[5]?.args, [limit, 0]);
  assert.deepEqual(updates[6]?.args, [HIGHEST_REAL_LIMIT, 0]);
});

/**
 * Found paying on Monad testnet, 5 Oct: a grant naming no payees landed, and every payment under it was
 * refused, since the allowlist held nothing payable. The plugin cannot say "send MON to anyone, call
 * nothing else", and a list open to every address would let the agent call any contract with the wallet.
 */
test("on Monad a grant naming no payees is refused before it is signed, since it could pay nobody", () => {
  assert.equal(payeesRequired(MONAD_TESTNET), true);
  assert.equal(payeesRequired(ARC_TESTNET), false, "on Arc it pays anyone through the ERC-20 view");
  assert.throws(() => permissionUpdates(MONAD_TESTNET, { agent: AGENT, limit: ONE, payees: [] }), (error: unknown) => error instanceof GrantError && error.message === PAYEES_REQUIRED);
  assert.throws(() => grantCallData(MONAD_TESTNET, { agent: AGENT, limit: ONE, payees: [] }, true), GrantError);
});

test("a Monad grant never opens the list to every address: what it can reach is only what it names", () => {
  const updates = read(permissionUpdates(MONAD_TESTNET, { agent: AGENT, limit: ONE, payees: PAYEES, calls: [IDENTITY] }));
  assert.deepEqual(updates[0]?.args, [ACCESS_LIST.allowlist]);
  assert.ok(!updates.some((update) => update.name === "setAccessListType" && update.args[0] !== ACCESS_LIST.allowlist));
  const listed = updates.filter((update) => update.name === "updateAccessListAddressEntry").map((update) => update.args[0]);
  assert.deepEqual(listed, [...PAYEES, IDENTITY.contract]);
});

test("on Monad a grant may name only functions to call, with no payee, since those are what it can reach", () => {
  assert.doesNotThrow(() => permissionUpdates(MONAD_TESTNET, { agent: AGENT, limit: ONE, payees: [], calls: [POD_JOBS, IDENTITY] }));
  // the identity alone is the agent's own setup, not something it was granted to reach
  assert.throws(() => permissionUpdates(MONAD_TESTNET, { agent: AGENT, limit: ONE, payees: [], calls: [IDENTITY] }), GrantError);
});

test("a contract the agent may call is listed with its functions checked, and only the functions named are allowed", () => {
  const updates = read(permissionUpdates(MONAD_TESTNET, { agent: AGENT, limit: ONE, payees: PAYEES.slice(0, 1), calls: [POD_JOBS] }));
  const listed = updates.filter((update) => update.name === "updateAccessListAddressEntry");
  // the payee and the contract both have their functions checked: the payee only a plain transfer, the
  // contract only the functions named
  assert.deepEqual(listed.map((update) => update.args), [[PAYEES[0], true, true], [POD_JOBS.contract, true, true]]);
  const functions = updates.filter((update) => update.name === "updateAccessListFunctionEntry");
  assert.deepEqual(functions.map((update) => update.args), [
    [PAYEES[0], PLAIN_TRANSFER, true], [POD_JOBS.contract, toFunctionSelector("takeSeat(uint256,uint8,address)"), true],
  ]);
});

test("on Arc a grant naming no payees meters the ERC-20 view instead, in its six decimals, and opens no native spending", () => {
  assert.equal(railOf(ARC_TESTNET, { payees: [] }), "erc20");
  assert.equal(railOf(ARC_TESTNET, { payees: PAYEES }), "native");
  const updates = read(permissionUpdates(ARC_TESTNET, { agent: AGENT, limit: (5n * ONE) / 2n, payees: [] }));
  const view = ARC_TESTNET.contracts.erc20View?.address;
  assert.deepEqual(updates.find((update) => update.name === "setERC20SpendLimit")?.args, [view, 2_500_000n, 0]);
  assert.ok(!updates.some((update) => update.name === "setNativeTokenSpendLimit"), "a second meter would let the agent spend both");
  // transferFrom is never named, since the meter does not count it
  const selectors = updates.filter((update) => update.name === "updateAccessListFunctionEntry" && update.args[0] === view).map((update) => update.args[1]);
  assert.deepEqual(selectors, [toFunctionSelector("transfer(address,uint256)"), toFunctionSelector("approve(address,uint256)")]);
});

test("an expiry is written last, as the window the key is valid in; none is written when none is given", () => {
  const expiring = read(permissionUpdates(MONAD_TESTNET, { agent: AGENT, limit: ONE, payees: PAYEES, expiresAt: 1_800_000_000 }));
  assert.deepEqual(expiring.at(-1), { name: "updateTimeRange", args: [0, 1_800_000_000] });
  const lasting = read(permissionUpdates(MONAD_TESTNET, { agent: AGENT, limit: ONE, payees: PAYEES }));
  assert.ok(!lasting.some((update) => update.name === "updateTimeRange"));
});

test("a grant that allows nothing is refused rather than signed", () => {
  for (const limit of [0n, -1n]) {
    assert.throws(() => permissionUpdates(MONAD_TESTNET, { agent: AGENT, limit, payees: PAYEES }), (error: unknown) => error instanceof GrantError && /allow something/.test(error.message));
  }
});

test("on Arc a limit too small for the six-decimal view is refused, since the grant would refuse every payment", () => {
  assert.throws(() => permissionUpdates(ARC_TESTNET, { agent: AGENT, limit: 10n ** 11n, payees: [] }), /below 0\.000001 USDC cannot be expressed/);
  // the same amount is fine when payees are named, on the coin itself, and on Monad
  assert.doesNotThrow(() => permissionUpdates(ARC_TESTNET, { agent: AGENT, limit: 10n ** 11n, payees: PAYEES }));
  assert.doesNotThrow(() => permissionUpdates(MONAD_TESTNET, { agent: AGENT, limit: 1n, payees: PAYEES }));
});

test("a first grant installs the network's plugin with the agent's key and its tag; a later one adds the key to it", () => {
  const terms: GrantTerms = { agent: AGENT, limit: ONE, payees: PAYEES, pairing: "00112233445566778899aabbccddeeff" };
  const install = decodeFunctionData({
    abi: parseAbi(["function installPlugin(address plugin, bytes32 manifestHash, bytes pluginInstallData, (address plugin, uint8 functionId)[] dependencies)"]),
    data: grantCallData(MONAD_TESTNET, terms, false),
  });
  const [plugin, manifestHash, installData, dependencies] = install.args;
  assert.equal(plugin, MONAD_TESTNET.contracts.sessionKeyPlugin);
  assert.equal(manifestHash, SESSION_KEY_PLUGIN_MANIFEST_HASH);
  assert.deepEqual(dependencies, [{ plugin: MONAD_TESTNET.contracts.ownerPlugin, functionId: 0 }]);
  const [keys, tags, updates] = decodeAbiParameters(parseAbiParameters("address[], bytes32[], bytes[][]"), installData);
  assert.deepEqual(keys, [AGENT]);
  assert.deepEqual(tags, [pairingTag("00112233445566778899aabbccddeeff")]);
  assert.deepEqual(updates, [permissionUpdates(MONAD_TESTNET, terms)]);

  const added = decodeFunctionData({ abi: parseAbi(["function addSessionKey(address sessionKey, bytes32 tag, bytes[] permissionUpdates)"]), data: grantCallData(MONAD_TESTNET, terms, true) });
  assert.deepEqual(added.args, [AGENT, pairingTag("00112233445566778899aabbccddeeff"), permissionUpdates(MONAD_TESTNET, terms)]);
});

test("a scanned grant carries its pairing code's tag, and a typed one its label's, so the agent uses only the first", () => {
  assert.equal(grantTag({ pairing: "00112233445566778899aabbccddeeff", label: "ignored" }), pairingTag("00112233445566778899aabbccddeeff"));
  assert.equal(grantTag({ label: "rent" }), keccak256(toHex("rent")));
  assert.equal(grantTag({}), keccak256(toHex("mandate")));
});
