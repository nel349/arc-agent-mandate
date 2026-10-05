import { test } from "node:test";
import assert from "node:assert/strict";
import { BaseError } from "viem";
import { correctedGas, MOST_GAS_CORRECTIONS, sendCorrectingGas, type GasLimits } from "./gas.ts";
import { ARC_TESTNET, MONAD_TESTNET } from "./networks.ts";

/**
 * The refusals here are Circle's bundler's own words, as it answered on Monad testnet on 3 Oct, and the
 * corrections are the ones that then landed: an agent's payment went through at the corrected figures.
 */

const PRE_VERIFICATION_REFUSAL = "precheck failed: preVerificationGas is 150000 but must be at least 3196019";
const VERIFICATION_REFUSAL = "Verification gas limit efficiency too low. Required: 0.4, Actual: 0.12157625";

const LIMITS: GasLimits = {
  callGasLimit: 500_000n, verificationGasLimit: 500_000n, preVerificationGas: 150_000n,
  paymasterVerificationGasLimit: 150_000n, paymasterPostOpGasLimit: 20_000n,
};

/** A refusal as it reaches a caller: inside viem's error, among its other lines. */
const asViemSays = (words: string): BaseError =>
  new BaseError("An error occurred while executing user operation", { details: words });

test("too little preVerificationGas: the least the bundler names, and a tenth more, nothing else touched", () => {
  const corrected = correctedGas(asViemSays(PRE_VERIFICATION_REFUSAL), LIMITS);
  assert.deepEqual(corrected, { ...LIMITS, preVerificationGas: 3_515_620n });
  assert.ok(corrected && corrected.preVerificationGas > 3_196_019n);
});

test("a verification limit too generous: lowered to one the operation uses six tenths of, from the share it used", () => {
  const corrected = correctedGas(asViemSays(VERIFICATION_REFUSAL), LIMITS);
  // 0.12157625 of 500k is 60788 used; a limit it uses 0.6 of is 101313
  assert.deepEqual(corrected, { ...LIMITS, verificationGasLimit: 101_313n });
  assert.ok(corrected && 60_788n * 10n >= corrected.verificationGasLimit * 4n, "the corrected limit still clears the bundler's 0.4");
});

test("a refusal that is not about gas is not corrected, since no limit would change it", () => {
  assert.equal(correctedGas(asViemSays("AA23 reverted: session key not valid"), LIMITS), undefined);
  assert.equal(correctedGas(new Error("Cannot find target wallet in the system."), LIMITS), undefined);
  assert.equal(correctedGas("anything", LIMITS), undefined);
});

test("sending corrects as many times as the bundler names better figures, and keeps the limits that landed", async () => {
  const sentWith: GasLimits[] = [];
  const refusals = [PRE_VERIFICATION_REFUSAL, VERIFICATION_REFUSAL];
  const { sent, limits } = await sendCorrectingGas(LIMITS, async (tried) => {
    sentWith.push(tried);
    const refusal = refusals.shift();
    if (refusal) throw asViemSays(refusal);
    return "0xhash";
  });
  assert.equal(sent, "0xhash");
  assert.equal(sentWith.length, 3);
  assert.deepEqual(limits, { ...LIMITS, preVerificationGas: 3_515_620n, verificationGasLimit: 101_313n });
});

test("a refusal that is not about gas is the answer at once, sent no second time", async () => {
  let sends = 0;
  await assert.rejects(sendCorrectingGas(LIMITS, async () => {
    sends++;
    throw asViemSays("The `validateUserOp` function on the Smart Account reverted.");
  }), /validateUserOp/);
  assert.equal(sends, 1);
});

test("a bundler that keeps asking is answered a few times and then believed", async () => {
  let sends = 0;
  await assert.rejects(sendCorrectingGas(LIMITS, async () => {
    sends++;
    throw asViemSays(PRE_VERIFICATION_REFUSAL);
  }), /preVerificationGas/);
  assert.equal(sends, MOST_GAS_CORRECTIONS + 1);
});

test("each network starts an agent's payment from figures its bundler takes: Arc's as the connector has always sent", () => {
  assert.deepEqual(ARC_TESTNET.gas.agent, LIMITS_THE_CONNECTOR_SENT);
  // Monad's are the figures a payment landed with there, so the first try is usually the only one
  assert.ok(MONAD_TESTNET.gas.agent.preVerificationGas >= 1_169_298n);
  assert.ok(MONAD_TESTNET.gas.agent.verificationGasLimit < ARC_TESTNET.gas.agent.verificationGasLimit);
  // the operation that makes the wallet and grants is the heavier one on both
  for (const network of [ARC_TESTNET, MONAD_TESTNET]) assert.ok(network.gas.grant.verificationGasLimit > network.gas.agent.verificationGasLimit);
});

/** what mcp/spend.ts has sent for every agent payment on Arc, unchanged by the move */
const LIMITS_THE_CONNECTOR_SENT: GasLimits = {
  callGasLimit: 500_000n, verificationGasLimit: 500_000n, preVerificationGas: 100_000n,
  paymasterVerificationGasLimit: 150_000n, paymasterPostOpGasLimit: 20_000n,
};
