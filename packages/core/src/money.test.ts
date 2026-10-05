import { test } from "node:test";
import assert from "node:assert/strict";
import { amountIn } from "./money.ts";
import { ARC_TESTNET, MONAD_TESTNET } from "./networks.ts";

test("on Arc an amount is dollars, as the coin is one", () => {
  assert.equal(amountIn(ARC_TESTNET, 2_500_000_000_000_000n), "$0.0025");
});

test("on Monad an amount is named MON, never written as dollars", () => {
  assert.equal(amountIn(MONAD_TESTNET, 2_000_000_000_000_000n), "0.002 MON");
  assert.equal(amountIn(MONAD_TESTNET, 1n), "0.000000000000000001 MON");
  assert.doesNotMatch(amountIn(MONAD_TESTNET, 10n ** 18n), /\$/);
});
