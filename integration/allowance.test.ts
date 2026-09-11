import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, keccak256, parseAbi, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as arc from "./harness.ts";
import { buildGrantPlan } from "../src/arc/mandate.ts";
import { Usdc } from "../src/arc/usdc.ts";
import { mandateTermsFor } from "../src/ui/grant-entry.ts";
import {
  IDENTITY_REGISTRY, identityState, registerCall, registeredIdentity, setUpIdentity, type Submit,
} from "../mcp/erc8004.ts";
import { GATEWAY_WALLET, topUpCalls, type Call } from "../mcp/gateway.ts";

/**
 * What the app's allowance lets an agent's key do from the owner's wallet, on a forked Arc.
 *
 * The grant is the phone's own calldata, sent by the real Circle account to the real plugin, and
 * every call goes through the real EntryPoint signed by the agent's key. The identity is set up by
 * the connector's own code. Until 09-11 an unscoped allowance was a denylist, and on this fork the
 * agent's key moved the owner's identity to a stranger; these pin that it no longer can.
 *
 * One limit of a fork, stated where it bites: Arc's USDC balance moves through a precompile a fork
 * cannot run (docs/FINDINGS.md, finding 9). So a top-up is shown passing the allowance's checks and
 * then stopping inside the Gateway, at the point where the money would move.
 */

const seed = (role: string): Hex => keccak256(toHex(`kuiralabs.arc-agent-mandate.allowance.${role}`));
const AGENT_PK = seed("agent");
const agent = privateKeyToAccount(AGENT_PK);
const CODE = "0123456789abcdef0123456789abcdef";
const LIMIT = "5";
const DAYS = 7;

const registry = parseAbi([
  "function register() returns (uint256)",
  "function register(string agentURI) returns (uint256)",
  "function ownerOf(uint256 agentId) view returns (address)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "function transferFrom(address from, address to, uint256 tokenId)",
  "function setApprovalForAll(address operator, bool approved)",
]);
const usdcView = parseAbi([
  "function approve(address spender, uint256 value) returns (bool)",
  "function transferFrom(address from, address to, uint256 value) returns (bool)",
]);
const gateway = parseAbi(["function initiateWithdrawal(address token, uint256 value)"]);
const accountAbi = parseAbi(["function execute(address target, uint256 value, bytes data) returns (bytes)"]);
const meterAbi = parseAbi([
  "function getERC20SpendLimitInfo(address account, address sessionKey, address token) view returns ((bool hasLimit, uint256 limit, uint256 limitUsed, uint48 refreshInterval, uint48 lastUsedTime))",
]);

/** The agent's calls, from the owner's account, through the fork's EntryPoint. */
const asAgent = (calls: readonly Call[]) =>
  arc.spend({ calls: calls.map(({ to, value, data }) => ({ target: to, value, data })), key: AGENT_PK });

/** The connector's `Submit`, sent through the fork's EntryPoint in place of Circle's bundler. */
let submissions = 0;
const submit: Submit = async (calls) => {
  submissions += 1;
  try {
    return { ok: true, logs: (await asAgent(calls)).logs };
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) };
  }
};

const read = (functionName: "ownerOf" | "getAgentWallet", agentId: bigint) =>
  arc.publicClient.readContract({ address: IDENTITY_REGISTRY, abi: registry, functionName, args: [agentId] });

const meter = () =>
  arc.publicClient.readContract({
    address: arc.pluginAddress(), abi: meterAbi, functionName: "getERC20SpendLimitInfo",
    args: [arc.MSCA, agent.address, arc.USDC_ERC20_VIEW],
  });

/** Sets the identity up as the connector does, from what it remembers, and records what it keeps. */
async function setUp(remembered: bigint | null) {
  const kept: bigint[] = [];
  const outcome = await setUpIdentity({
    agent, owner: arc.MSCA, remembered, client: arc.publicClient, submit, remember: (id) => kept.push(id),
  });
  return { outcome, kept };
}

/** An identity set up and linked, for the tests that start from one. */
async function linkedIdentity(): Promise<bigint> {
  const { outcome } = await setUp(null);
  assert.ok(outcome.ok, `setting up failed: ${outcome.ok ? "" : outcome.reason}`);
  submissions = 0;
  return outcome.agentId;
}

describe("what the app's allowance lets an agent do, on a forked Arc", () => {
  let clean: string;

  before(async () => {
    await arc.start();
    const terms = mandateTermsFor({ agent: agent.address, limit: Usdc.parse(LIMIT), days: DAYS }, CODE, Date.now());
    const granted = await arc.asOwner(buildGrantPlan(terms, true).management);
    assert.equal(granted.status, "success", "the phone's grant did not land");
    clean = await arc.snapshot();
  });
  after(() => arc.stop());
  beforeEach(async () => {
    await arc.revert(clean);
    clean = await arc.snapshot();
    submissions = 0;
  });

  it("the agent sets up its own identity, owned by the wallet that granted it, and moves no money", async () => {
    const { outcome, kept } = await setUp(null);
    assert.ok(outcome.ok, `setting up failed: ${outcome.ok ? "" : outcome.reason}`);

    assert.equal(outcome.registered, true);
    assert.deepEqual(kept, [outcome.agentId], "the number was not remembered the moment it existed");
    assert.equal(submissions, 2, "one registration and one link");
    assert.equal(await read("ownerOf", outcome.agentId), arc.MSCA);
    assert.equal(await read("getAgentWallet", outcome.agentId), agent.address);
    assert.equal((await meter()).limitUsed, 0n, "setting up an identity spent from the allowance");
  });

  it("asked again, it finds the identity linked and sends nothing", async () => {
    const agentId = await linkedIdentity();

    const { outcome, kept } = await setUp(agentId);
    assert.deepEqual(outcome, { ok: true, agentId, registered: false });
    assert.deepEqual(kept, []);
    assert.equal(submissions, 0);
  });

  it("a link that never landed is made for the same identity, not a second one", async () => {
    const agentId = registeredIdentity((await asAgent([registerCall()])).logs, arc.MSCA);
    if (agentId === null) assert.fail("registering minted no identity to the wallet");
    assert.equal(await identityState(arc.publicClient, agentId, arc.MSCA, agent.address), "unlinked");

    const { outcome, kept } = await setUp(agentId);
    assert.deepEqual(outcome, { ok: true, agentId, registered: false });
    assert.deepEqual(kept, []);
    assert.equal(submissions, 1, "only the link");
    assert.equal(await read("getAgentWallet", agentId), agent.address);
  });

  it("an identity that has left the wallet is replaced by a new one rather than declared", async () => {
    const moved = await linkedIdentity();
    // The owner gives it away, with the passkey. The registry clears its agent wallet as it goes.
    const given = await arc.asOwner(encodeFunctionData({
      abi: accountAbi, functionName: "execute",
      args: [IDENTITY_REGISTRY, 0n, encodeFunctionData({
        abi: registry, functionName: "transferFrom", args: [arc.MSCA, arc.STRANGER, moved],
      })],
    }));
    assert.equal(given.status, "success", "the owner could not give the identity away");
    assert.equal(await identityState(arc.publicClient, moved, arc.MSCA, agent.address), "gone");

    const { outcome, kept } = await setUp(moved);
    assert.ok(outcome.ok, `setting up failed: ${outcome.ok ? "" : outcome.reason}`);
    assert.equal(outcome.registered, true);
    assert.notEqual(outcome.agentId, moved);
    assert.deepEqual(kept, [outcome.agentId]);
    assert.equal(await read("ownerOf", outcome.agentId), arc.MSCA);
    assert.equal(await read("getAgentWallet", outcome.agentId), agent.address);
    assert.equal(await read("ownerOf", moved), arc.STRANGER, "the identity given away stays given away");
  });

  it("the agent's key cannot give the owner's identity away, or let anybody else", async () => {
    const agentId = await linkedIdentity();

    await assert.rejects(
      () => asAgent([{ to: IDENTITY_REGISTRY, value: 0n, data: encodeFunctionData({
        abi: registry, functionName: "transferFrom", args: [arc.MSCA, arc.STRANGER, agentId],
      }) }]),
      /REFUSED/,
    );
    await assert.rejects(
      () => asAgent([{ to: IDENTITY_REGISTRY, value: 0n, data: encodeFunctionData({
        abi: registry, functionName: "setApprovalForAll", args: [arc.STRANGER, true],
      }) }]),
      /REFUSED/,
    );
    assert.equal(await read("ownerOf", agentId), arc.MSCA);
    assert.equal(await read("getAgentWallet", agentId), agent.address);
  });

  it("nothing the allowance does not name can be called, even carrying no money", async () => {
    const unnamed: readonly (readonly [string, Call])[] = [
      ["a zero-value call to an ordinary address", { to: arc.STRANGER, value: 0n, data: "0x" }],
      ["the registry's other register", { to: IDENTITY_REGISTRY, value: 0n, data: encodeFunctionData({
        abi: registry, functionName: "register", args: ["https://example.com/agent.json"],
      }) }],
      ["a withdrawal from the Gateway", { to: GATEWAY_WALLET, value: 0n, data: encodeFunctionData({
        abi: gateway, functionName: "initiateWithdrawal", args: [arc.USDC_ERC20_VIEW, 1n],
      }) }],
      ["moving USDC by transferFrom, which the meter does not count", { to: arc.USDC_ERC20_VIEW, value: 0n,
        data: encodeFunctionData({ abi: usdcView, functionName: "transferFrom", args: [arc.MSCA, arc.STRANGER, 1n] }) }],
    ];
    for (const [what, call] of unnamed) {
      await assert.rejects(() => asAgent([call]), /REFUSED/, `${what} was not refused`);
    }
  });

  it("approving a top-up is counted against the one limit", async () => {
    await asAgent([{ to: arc.USDC_ERC20_VIEW, value: 0n, data: encodeFunctionData({
      abi: usdcView, functionName: "approve", args: [GATEWAY_WALLET, 1_250_000n],
    }) }]);
    assert.equal((await meter()).limitUsed, 1_250_000n);
  });

  it("a whole top-up passes the allowance, and stops only where the fork cannot move USDC", async () => {
    // REVERTED rather than REFUSED: the allowance accepted both calls, and the deposit then failed
    // inside the Gateway, where it moves USDC through the precompile a fork does not have.
    await assert.rejects(() => asAgent(topUpCalls(agent.address, 1_000_000n)), /REVERTED/);
  });
});
