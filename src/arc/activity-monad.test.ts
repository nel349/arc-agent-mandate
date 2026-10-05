import { test } from "node:test";
import assert from "node:assert/strict";
import { ARC_TESTNET, MONAD_TESTNET, sessionKeyExecutionAbi } from "@kuiralabs/mandate-core";
import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { entryPoint07Abi } from "viem/account-abstraction";
import {
  activityFromLog, agentInNonce, EMPTY_FEED, feedKeyOf, feedRulesOf, mergeFeed, newWindows, earlierWindows, operationCallData,
  parseFeed, paymentsIn, serializeFeed, tooFarBehind, type Activity, type Feed,
} from "./activity.ts";

/**
 * The feed on a network whose agents pay in its own coin. The figures are the connector's proof on
 * Monad testnet, 3 Oct: wallet 0xB0D5…8e55 paid 0.002 MON to 0x9C1a…f281 through agent 0x806d…52E5,
 * in an operation whose nonce carried the agent; the owner's own operations that day were keyed by
 * the time, 0x1a1054ae5b6.
 */

const WALLET: Address = "0xB0D5AB6792a6abdF22d35e02F6525ae13Afd8e55";
const AGENT: Address = "0x806dC09Fc68509E77B5909f88f2A934b3D2852E5";
const PAYEE: Address = "0x9C1a07dCf5B8c1Da6025d84754Bb3a7d3345f281";
const POD_JOBS: Address = "0xc831b6e4414E064F7713A3b6017be4a1Eb9F5E9b";
const SEQUENCE_BITS = 64n;
const AGENT_NONCE = (BigInt(AGENT) << SEQUENCE_BITS) + 1n;
const OWNER_NONCE = (0x1a1054ae5b6n << SEQUENCE_BITS) + 4n;
const TWO_THOUSANDTHS = 2_000_000_000_000_000n;

const agentCalls = (calls: readonly { target: Address; value: bigint; data: Hex }[], key: Address = AGENT): Hex =>
  encodeFunctionData({ abi: sessionKeyExecutionAbi, functionName: "executeWithSessionKey", args: [calls, key] });

const NO_GAS: Hex = `0x${"00".repeat(32)}`;
const bundle = (ops: readonly { sender: Address; nonce: bigint; callData: Hex }[]): Hex =>
  encodeFunctionData({
    abi: entryPoint07Abi,
    functionName: "handleOps",
    args: [ops.map((op) => ({
      ...op, initCode: "0x" as Hex, accountGasLimits: NO_GAS, preVerificationGas: 1_200_000n,
      gasFees: NO_GAS, paymasterAndData: "0x" as Hex, signature: "0x" as Hex,
    })), getAddress("0x00000000000000000000000000000000000000b0")],
  });

test("an agent's payment in MON is read out of the calls its operation made", () => {
  const paid = paymentsIn(agentCalls([{ target: PAYEE, value: TWO_THOUSANDTHS, data: "0x" }]), AGENT);
  assert.deepEqual(paid, [{ to: PAYEE, value: TWO_THOUSANDTHS, call: 0 }]);
});

test("each call that carried MON is its own payment, and a call that carried none is not one", () => {
  const paid = paymentsIn(agentCalls([
    { target: PAYEE, value: 1n, data: "0x" },
    { target: POD_JOBS, value: 0n, data: "0x12345678" },
    { target: POD_JOBS, value: 5n, data: "0x12345678" },
  ]), AGENT);
  assert.deepEqual(paid, [{ to: PAYEE, value: 1n, call: 0 }, { to: POD_JOBS, value: 5n, call: 2 }]);
});

test("an owner's operation, keyed by the time, looks like an agent by its nonce but is no agent's payment", () => {
  // the nonce alone would name a made-up agent
  assert.notEqual(agentInNonce(OWNER_NONCE), null);
  const ownersOwn = encodeFunctionData({
    abi: [{ type: "function", name: "execute", inputs: [{ type: "address" }, { type: "uint256" }, { type: "bytes" }], outputs: [], stateMutability: "payable" }],
    functionName: "execute", args: [PAYEE, TWO_THOUSANDTHS, "0x"],
  });
  const claimed = agentInNonce(OWNER_NONCE);
  assert.ok(claimed !== null);
  assert.equal(paymentsIn(ownersOwn, claimed), null);
  // nor is one agent's operation credited to another key
  assert.equal(paymentsIn(agentCalls([{ target: PAYEE, value: 1n, data: "0x" }]), PAYEE), null);
});

test("an operation is found in its bundle by its wallet and nonce, and nothing else is taken for it", () => {
  const mine = agentCalls([{ target: PAYEE, value: TWO_THOUSANDTHS, data: "0x" }]);
  const theirs = agentCalls([{ target: WALLET, value: 9n, data: "0x" }]);
  const input = bundle([
    { sender: PAYEE, nonce: AGENT_NONCE, callData: theirs },
    { sender: WALLET, nonce: AGENT_NONCE, callData: mine },
  ]);
  assert.equal(operationCallData(input, WALLET, AGENT_NONCE), mine);
  assert.equal(operationCallData(input, WALLET, AGENT_NONCE + 1n), null, "another nonce is another operation");
  assert.equal(operationCallData("0xdeadbeef", WALLET, AGENT_NONCE), null, "not a bundle at all");
});

test("a payment in MON is counted in the coin's eighteen decimals, not the view's six", () => {
  const item = activityFromLog("paid", {
    agent: AGENT, value: TWO_THOUSANDTHS, rail: "native", call: 0, to: PAYEE,
    blockNumber: 68_026_961n, timestamp: 1_790_000_000n, transactionHash: `0x${"ab".repeat(32)}`, logIndex: 7,
  });
  assert.equal(item?.amount?.format(3), "0.002");
  assert.equal(item?.call, 0);
});

const paidRow = (call: number, value: string): Activity => {
  const row = activityFromLog("paid", {
    agent: AGENT, value: BigInt(value), rail: "native", call, to: PAYEE,
    blockNumber: 68_026_961n, timestamp: 1_790_000_000n, transactionHash: `0x${"ab".repeat(32)}`, logIndex: 7,
  });
  assert.ok(row !== null);
  return row;
};

test("two payments in one operation are both kept, in order, and survive the phone's store", () => {
  const feed = mergeFeed({ coverage: { low: 68_026_900n, high: 68_027_000n }, items: [], since: null }, [paidRow(0, "1"), paidRow(1, "2")]);
  assert.deepEqual(feed.items.map((item) => item.call), [1, 0]);
  assert.deepEqual(parseFeed(serializeFeed(feed)).items, feed.items);
});

test("Monad's feed reads a hundred blocks at a time, never below the plugin's arrival", () => {
  const rules = feedRulesOf(MONAD_TESTNET);
  const head = 68_100_000n;
  const windows = newWindows(null, head, rules.floor, rules.span, rules.window);
  assert.equal(windows.length, 36);
  // Monad's node takes a query whose last block is at most 100 past its first, as it answered on 3 Oct
  for (const window of windows) assert.ok(window.to - window.from <= 100n);
  assert.deepEqual(newWindows(null, rules.floor + 10n, rules.floor, rules.span, rules.window), [{ from: rules.floor, to: rules.floor + 10n }]);
  assert.equal(earlierWindows({ low: head - 99n, high: head }, rules.floor, rules.span, rules.window).length, 36);
});

test("a Monad feed left longer than half an hour starts again from the latest, and Arc's always catches up", () => {
  const coverage = { low: 1_000n, high: 2_000n };
  const monad = feedRulesOf(MONAD_TESTNET).mostBehind;
  assert.equal(tooFarBehind(coverage, 2_000n + 3_600n, monad), false);
  assert.equal(tooFarBehind(coverage, 2_000n + 3_601n, monad), true);
  assert.equal(tooFarBehind(null, 10n ** 9n, monad), false, "a first read is no catching up");
  assert.equal(tooFarBehind(coverage, 10n ** 9n, feedRulesOf(ARC_TESTNET).mostBehind), false);
});

test("one wallet keeps a feed per network, and Arc's is found where this phone always kept it", () => {
  assert.equal(feedKeyOf(ARC_TESTNET, WALLET), `arc.activity.${WALLET.toLowerCase()}`);
  assert.equal(feedKeyOf(MONAD_TESTNET, WALLET), `arc.activity.monadTestnet:${WALLET.toLowerCase()}`);
  const kept: Feed = { ...EMPTY_FEED };
  assert.deepEqual(parseFeed(serializeFeed(kept)), EMPTY_FEED);
});
