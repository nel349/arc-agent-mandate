import { test } from "node:test";
import assert from "node:assert/strict";
import { ARC_TESTNET, MONAD_TESTNET } from "@kuiralabs/mandate-core";
import { Amount } from "../arc/amount.ts";
import { figure, formatAmount, inCoin, unitOf } from "./coin.ts";

test("an amount keeps the places it has, and never fewer than two", () => {
  assert.equal(formatAmount(Amount.parse("0.001")), "0.001");
  assert.equal(formatAmount(Amount.parse("0.28")), "0.28");
  assert.equal(formatAmount(Amount.parse("12")), "12.00");
  assert.equal(formatAmount(Amount.parse("0.000265")), "0.000265");
});

test("on Arc a figure is in cents, as it always was", () => {
  assert.equal(figure(Amount.parse("19.723"), ARC_TESTNET), "19.72");
  assert.equal(inCoin(Amount.parse("20"), ARC_TESTNET), "20.00 USDC");
});

test("on Monad a small limit is shown as granted, never rounded up to twice itself", () => {
  assert.equal(figure(Amount.parse("0.005"), MONAD_TESTNET), "0.005");
  assert.equal(figure(Amount.parse("2"), MONAD_TESTNET), "2.00");
  assert.equal(inCoin(Amount.parse("0.008"), MONAD_TESTNET), "0.008 MON");
});

test("the money is called what the network calls its coin", () => {
  assert.equal(unitOf(ARC_TESTNET), "USDC");
  assert.equal(unitOf(MONAD_TESTNET), "MON");
});
