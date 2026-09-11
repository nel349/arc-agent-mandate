import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createWalletClient, encodeFunctionData, http, keccak256, parseAbi, parseEventLogs, toFunctionSelector, toHex,
  type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as arc from "./harness.ts";
import { pairingTag } from "../mcp/pairing.ts";
import { buildGrantPlan } from "../src/arc/mandate.ts";
import { Usdc } from "../src/arc/usdc.ts";
import { GRANT_LABEL, mandateTermsFor } from "../src/ui/grant-entry.ts";

/**
 * Whose allowance an agent spends, decided on a real chain.
 *
 * Anyone can grant an allowance to an agent's public address, so the first grant naming it is not
 * necessarily the owner's. The agent only spends from a grant carrying the pairing code its QR
 * showed. These run that rule against a fork of Arc: the real Circle account granting with the
 * phone's own calldata, strangers and copycats granting to the real plugin from their own addresses,
 * and the connector's own code reading the chain to decide. Nothing here answers for the chain.
 */

const pluginWrites = parseAbi([
  "function addSessionKey(address sessionKey, bytes32 tag, bytes[] permissionUpdates)",
  "event SessionKeyAdded(address indexed account, address indexed sessionKey, bytes32 indexed tag)",
]);
const updatesAbi = parseAbi(["function updateTimeRange(uint48 validAfter, uint48 validUntil)"]);

const seed = (role: string): Hex => keccak256(toHex(`kuiralabs.arc-agent-mandate.pairing.${role}`));
/** A fresh agent per test, so no test finds a grant another one made. */
const agentFor = (name: string): Address => privateKeyToAccount(seed(`agent.${name}`)).address;

/** Somebody other than the owner, with an address of their own and gas to spend. */
function granter(role: string) {
  const account = privateKeyToAccount(seed(role));
  return { address: account.address, client: createWalletClient({ account, transport: http(arc.RPC) }) };
}
const STRANGER = granter("stranger");
const COPYCAT = granter("copycat");
const SECOND_WALLET = granter("second-wallet");

const CODE = "0123456789abcdef0123456789abcdef";
const OTHER_CODE = "fedcba9876543210fedcba9876543210";
const LIMIT = "5";
const DAYS = 7;

/** The phone's grant: the terms the grant screen makes, as the calldata the app sends, from the owner. */
async function ownerGrant(agent: Address, pairing: string | null) {
  const terms = mandateTermsFor({ agent, limit: Usdc.parse(LIMIT), days: DAYS }, pairing, Date.now());
  const receipt = await arc.asOwner(buildGrantPlan(terms, true).management);
  assert.equal(receipt.status, "success", "the owner's grant did not land");
  return { terms, receipt };
}

/** A grant from an address of its own, straight to the plugin, which accepts it from anyone. */
async function grantFrom(who: ReturnType<typeof granter>, agent: Address, tag: Hex, updates: readonly Hex[] = []) {
  const hash = await who.client.writeContract({
    address: arc.pluginAddress(), abi: pluginWrites, functionName: "addSessionKey",
    args: [agent, tag, [...updates]], chain: null, gas: 1_000_000n,
  });
  const receipt = await arc.publicClient.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success", `${who.address} could not grant`);
  return receipt;
}

const isSessionKeyOf = (account: Address, key: Address) =>
  arc.publicClient.readContract({
    address: arc.pluginAddress(), abi: arc.pluginAbi, functionName: "isSessionKeyOf", args: [account, key],
  });

/**
 * The connector, freshly loaded with a state file of its own.
 *
 * Fresh because it reads where its state lives when the module loads, and each test needs its own.
 */
let loads = 0;
async function connector(state: unknown = {}) {
  const path = join(mkdtempSync(join(tmpdir(), "arc-pairing-")), "accounts.json");
  writeFileSync(path, JSON.stringify(state));
  process.env["ARC_MANDATE_ACCOUNT_PATH"] = path;
  loads += 1;
  const chain = (await import(`../mcp/chain.ts?pairing=${loads}`)) as typeof import("../mcp/chain.ts");
  const remembered = (agent: Address): Record<string, unknown> =>
    (JSON.parse(readFileSync(path, "utf8")) as Record<string, Record<string, unknown>>)[agent.toLowerCase()] ?? {};
  return { ...chain, remembered };
}

describe("pairing, on a forked Arc", () => {
  let clean: string;

  before(async () => {
    const plugin = await arc.start();
    process.env["ARC_RPC_URL"] = arc.RPC;
    process.env["ARC_SESSION_KEY_PLUGIN"] = plugin;
    // A wallet named by hand takes the place of pairing, and these are about pairing.
    delete process.env["ARC_ACCOUNT"];
    for (const who of [STRANGER, COPYCAT, SECOND_WALLET]) await arc.fund(who.address);
    clean = await arc.snapshot();
  });
  after(() => arc.stop());
  beforeEach(async () => {
    await arc.revert(clean);
    clean = await arc.snapshot();
  });

  it("the phone's grant, sent by the real Circle account, records the pairing code as its tag", async () => {
    const agent = agentFor("phone-grant");
    const { receipt } = await ownerGrant(agent, CODE);

    const granted = parseEventLogs({ abi: pluginWrites, eventName: "SessionKeyAdded", logs: receipt.logs });
    assert.equal(granted.length, 1, "one grant, one SessionKeyAdded");
    assert.equal(granted[0]?.address.toLowerCase(), arc.pluginAddress().toLowerCase());
    assert.deepEqual(granted[0]?.args, { account: arc.MSCA, sessionKey: agent, tag: pairingTag(CODE) });
  });

  it("a typed address grants with the label, which no pairing code can match", async () => {
    const agent = agentFor("typed");
    const { receipt } = await ownerGrant(agent, null);
    const granted = parseEventLogs({ abi: pluginWrites, eventName: "SessionKeyAdded", logs: receipt.logs });
    assert.equal(granted[0]?.args.tag, keccak256(toHex(GRANT_LABEL)));
  });

  it("a code is issued once and kept until a grant uses it, and before then nothing is found", async () => {
    const agent = agentFor("issued");
    const connector0 = await connector();
    // Uncached: viem keeps a head for four seconds, and the fork was reset since the last one.
    const head = await arc.publicClient.getBlockNumber({ cacheTime: 0 });

    const code = await connector0.pairingToShow(agent);
    assert.match(code, /^[0-9a-f]{32}$/);
    assert.equal(await connector0.pairingToShow(agent), code, "asking twice spoiled a code already shown");
    assert.deepEqual(connector0.remembered(agent)["pairing"], { code, shownAt: String(head), searchedTo: null });

    assert.deepEqual(await connector0.findGrant(agent), { status: "unpaired", legacy: null });
    assert.deepEqual(connector0.remembered(agent)["pairing"], { code, shownAt: String(head), searchedTo: String(head) });
  });

  it("the owner's grant carrying the code is found, remembered, and its allowance read exactly", async () => {
    const agent = agentFor("owner");
    const connector0 = await connector();
    const code = await connector0.pairingToShow(agent);
    const { terms } = await ownerGrant(agent, code);

    assert.deepEqual(await connector0.findGrant(agent), { status: "granted", account: arc.MSCA });
    assert.equal(connector0.remembered(agent)["account"], arc.MSCA);
    assert.equal(connector0.remembered(agent)["accountCode"], code);

    const allowance = await connector0.readAllowance(arc.MSCA, agent);
    assert.equal(allowance.limit, LIMIT);
    assert.equal(allowance.spent, "0");
    assert.equal(allowance.remaining, LIMIT);
    assert.equal(allowance.spendable, LIMIT);
    assert.equal(allowance.walletBalance, "500");
    assert.equal(allowance.expiresAt, terms.expiresAt);
    assert.equal(allowance.expired, false);
    assert.equal(allowance.notYet, false);
    assert.equal(allowance.rail, "erc20");

    // The code is used now, so the next one shown is new: showing it is how an owner switches.
    assert.notEqual(await connector0.pairingToShow(agent), code);
  });

  it("grants that do not carry this agent's code are never spent from", async () => {
    const agent = agentFor("strangers");
    const connector0 = await connector();
    await connector0.pairingToShow(agent);

    await grantFrom(STRANGER, agent, keccak256(toHex(GRANT_LABEL)));
    await grantFrom(COPYCAT, agent, pairingTag(OTHER_CODE));
    // Both are real, installed grants: the chain alone would say this agent has two allowances.
    assert.equal(await isSessionKeyOf(STRANGER.address, agent), true);
    assert.equal(await isSessionKeyOf(COPYCAT.address, agent), true);

    assert.deepEqual(await connector0.findGrant(agent), { status: "unpaired", legacy: null });
  });

  it("a copy of the code granted after the owner's does not take the agent over", async () => {
    const agent = agentFor("copycat");
    const connector0 = await connector();
    const code = await connector0.pairingToShow(agent);
    await ownerGrant(agent, code);
    await grantFrom(COPYCAT, agent, pairingTag(code));

    assert.deepEqual(await connector0.findGrant(agent), { status: "granted", account: arc.MSCA });
    assert.equal(connector0.remembered(agent)["account"], arc.MSCA);
  });

  it("a newer code, scanned from a second wallet, moves the agent to that wallet", async () => {
    const agent = agentFor("switch");
    const connector0 = await connector();
    const first = await connector0.pairingToShow(agent);
    await ownerGrant(agent, first);
    assert.deepEqual(await connector0.findGrant(agent), { status: "granted", account: arc.MSCA });

    const second = await connector0.pairingToShow(agent);
    assert.notEqual(second, first);
    await grantFrom(SECOND_WALLET, agent, pairingTag(second));

    assert.deepEqual(await connector0.findGrant(agent), { status: "granted", account: SECOND_WALLET.address });
    assert.equal(connector0.remembered(agent)["account"], SECOND_WALLET.address);
    assert.equal(connector0.remembered(agent)["accountCode"], second);
  });

  it("an expired grant with the newer code does not replace a live one", async () => {
    const agent = agentFor("expired");
    const connector0 = await connector();
    const first = await connector0.pairingToShow(agent);
    await ownerGrant(agent, first);
    assert.deepEqual(await connector0.findGrant(agent), { status: "granted", account: arc.MSCA });

    const second = await connector0.pairingToShow(agent);
    const lapsed = Math.floor(Date.now() / 1000) - 60;
    await grantFrom(SECOND_WALLET, agent, pairingTag(second), [
      encodeFunctionData({ abi: updatesAbi, functionName: "updateTimeRange", args: [0, lapsed] }),
    ]);

    assert.deepEqual(await connector0.findGrant(agent), { status: "granted", account: arc.MSCA });
    assert.equal(connector0.remembered(agent)["account"], arc.MSCA, "a live allowance was given up for an expired one");
  });

  it("revoking the paired wallet's grant reads as withdrawn, not as never granted", async () => {
    const agent = agentFor("revoked");
    const connector0 = await connector();
    const code = await connector0.pairingToShow(agent);
    await ownerGrant(agent, code);
    assert.deepEqual(await connector0.findGrant(agent), { status: "granted", account: arc.MSCA });

    await arc.revokeAgent(agent);
    assert.equal(await isSessionKeyOf(arc.MSCA, agent), false);
    assert.deepEqual(await connector0.findGrant(agent), { status: "withdrawn", account: arc.MSCA });
  });

  it("a wallet remembered from before codes is not spent from, even while its allowance is live", async () => {
    const agent = agentFor("legacy");
    await ownerGrant(agent, null);
    const connector0 = await connector({
      [agent.toLowerCase()]: { account: arc.MSCA, searched: { low: "60625268", high: "61477649" } },
    });

    assert.deepEqual(await connector0.findGrant(agent), { status: "unpaired", legacy: arc.MSCA });
    assert.equal((await connector0.readAllowance(arc.MSCA, agent)).limit, LIMIT, "the allowance itself is live");
  });

  /**
   * Today's behaviour, written down: one grant per agent per wallet. Re-pairing from the same wallet
   * therefore needs the old allowance revoked first, which is the step a one-step replace would take
   * away. The plugin refuses the second grant outright, with the agent's address in the reason.
   */
  it("granting again to an agent already on the same wallet is refused by the plugin", async () => {
    const agent = agentFor("twice");
    await ownerGrant(agent, null);

    const again = buildGrantPlan(
      mandateTermsFor({ agent, limit: Usdc.parse(LIMIT), days: DAYS }, CODE, Date.now()), true,
    ).management;
    const refusal = (await arc.ownerRefusal(again)).toLowerCase();
    assert.ok(refusal.includes(toFunctionSelector("InvalidSessionKey(address)").slice(2)),
      `the refusal is not InvalidSessionKey: ${refusal}`);
    assert.ok(refusal.includes(agent.slice(2).toLowerCase()), "the refusal does not name the agent");
    assert.deepEqual((await arc.sessionKeys()).filter((key) => key === agent), [agent], "the agent is on the wallet once");
  });

  /**
   * A search reads forward from where the code was shown, a window at a time, and records how far it
   * got, so one cut off by a rate limit carries on from there instead of starting again.
   */
  it("a search starts where the code was shown, crosses windows, and resumes where it stopped", async () => {
    const agent = agentFor("resume");

    // Carrying the code before the code was shown: below the floor, so never found.
    const early = await grantFrom(SECOND_WALLET, agent, pairingTag(CODE));
    const floor = early.blockNumber + 1n;
    await arc.mine(25_000);
    await ownerGrant(agent, CODE);
    const head = await arc.publicClient.getBlockNumber({ cacheTime: 0 });
    const pairing = (searchedTo: bigint | null) => ({
      [agent.toLowerCase()]: {
        pairing: { code: CODE, shownAt: String(floor), searchedTo: searchedTo === null ? null : String(searchedTo) },
      },
    });

    // From the floor, across three windows, to the owner's grant at the top.
    assert.deepEqual(await (await connector(pairing(null))).findGrant(agent), { status: "granted", account: arc.MSCA });

    // Interrupted just below the owner's grant: carries on and finds it.
    assert.deepEqual(await (await connector(pairing(head - 1n))).findGrant(agent), { status: "granted", account: arc.MSCA });

    // Recorded as read through the head: nothing is read again, so nothing is found.
    assert.deepEqual(await (await connector(pairing(head))).findGrant(agent), { status: "unpaired", legacy: null });
  });
});
