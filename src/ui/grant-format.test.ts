import { test } from "node:test";
import { ARC_TESTNET, MONAD_TESTNET } from "@kuiralabs/mandate-core";
import assert from "node:assert/strict";
import { amountPresets, CARD_TERMS, exceedsWallet, expiryDate, faceOf, grantedSentence, grantSummary, windowEndLabel } from "./grant-format.ts";
import { Amount } from "../arc/amount.ts";

/** Fixed so the wording is asserted, not the clock. 2026-09-04T12:00:00Z. */
const NOW = Date.UTC(2026, 8, 4, 12);

test("an expiry lands the given number of days out", () => {
  const until = expiryDate(7, NOW);
  assert.equal(until?.toISOString(), new Date(Date.UTC(2026, 8, 11, 12)).toISOString());
});

test("a missing, zero or negative window is open-ended rather than a date in the past", () => {
  assert.equal(expiryDate(null, NOW), null);
  assert.equal(expiryDate(0, NOW), null);
  assert.equal(expiryDate(-3, NOW), null);
  assert.equal(expiryDate(Number.NaN, NOW), null);
});

test("the summary names the limit, the date and the fee float", () => {
  const text = grantSummary({
    limit: Amount.parse("20"),
    days: 7,
    network: ARC_TESTNET,
    now: NOW,
  });
  assert.match(text, /up to 20\.00 USDC/);
  assert.match(text, /until 11 Sep/);
  assert.match(text, /Nothing is transferred to the agent/);
});

test("an open-ended allowance says so instead of naming a date", () => {
  const text = grantSummary({
    limit: Amount.parse("5"),
    days: null,
    network: ARC_TESTNET,
    now: NOW,
  });
  assert.match(text, /no expiry date/);
  assert.doesNotMatch(text, /until/);
});

test("a window running into next year names the year, so the date cannot be misread", () => {
  const text = grantSummary({
    limit: Amount.parse("20"),
    days: 365,
    network: ARC_TESTNET,
    now: NOW,
  });
  assert.match(text, /until 4 Sep 2027/);
});

test("a window inside this year leaves the year off", () => {
  const text = grantSummary({
    limit: Amount.parse("20"),
    days: 7,
    network: ARC_TESTNET,
    now: NOW,
  });
  assert.doesNotMatch(text, /202\d/);
});

test("each length of allowance says the day it would end", () => {
  // Wednesday 9 Sep 2026, local noon, so the date holds in every time zone.
  const now = new Date(2026, 8, 10, 12).getTime();
  assert.equal(windowEndLabel(7, now), "Ends Thu 17 Sep");
  assert.equal(windowEndLabel(1, now), "Ends Fri 11 Sep");
});

test("a limit above what the wallet holds is flagged, and an unknown balance is not", () => {
  assert.equal(exceedsWallet(Amount.parse("20"), Amount.parse("4.39")), true);
  assert.equal(exceedsWallet(Amount.parse("4.39"), Amount.parse("4.39")), false);
  assert.equal(exceedsWallet(Amount.parse("20"), null), false);
});

test("the confirmation names who, how much and until when, and says nothing has moved", () => {
  const now = new Date(2026, 8, 10, 12).getTime();
  assert.equal(
    grantedSentence({ who: "Maze runner", limit: Amount.parse("20"), days: 7, network: ARC_TESTNET, now }),
    "Maze runner can now spend up to 20.00 USDC until 17 Sep. Nothing has left your wallet yet.",
  );
});

test("on Monad the grant is worded in MON, at the precision it was granted", () => {
  const now = new Date(2026, 8, 10, 12).getTime();
  assert.equal(
    grantedSentence({ who: "Runner", limit: Amount.parse("0.005"), days: 7, network: MONAD_TESTNET, now }),
    "Runner can now spend up to 0.005 MON until 17 Sep. Nothing has left your wallet yet.",
  );
  assert.match(grantSummary({ limit: Amount.parse("0.005"), days: 7, network: MONAD_TESTNET, now }), /up to 0\.005 MON until/);
});

test("the preset limits fit the coin: dollars on Arc, small amounts of MON on Monad", () => {
  assert.deepEqual(amountPresets(ARC_TESTNET), ["5", "20", "100"]);
  assert.deepEqual(amountPresets(MONAD_TESTNET), ["0.01", "0.05", "0.1"]);
});

test("a card prints each thing once: the limit in the coin, the end date, and only what the code asked", () => {
  const now = new Date(2026, 9, 4, 12).getTime();
  const agent = "0x806dC09Fc68509E77B5909f88f2A934b3D2852E5";
  const face = faceOf({ terms: { agent, limit: Amount.parse("0.01"), days: 7 }, name: null, askedBy: "A test app", payees: [], network: MONAD_TESTNET, now });
  assert.equal(face.ends, "11 Oct");
  assert.equal(face.askedBy, "A test app");
  assert.equal(face.name, null);
  // a screen reader hears the whole allowance as the sentence the form always said
  assert.match(face.spoken, /up to 0\.01 MON until 11 Oct/);
});

test("what is said under a card repeats nothing printed on it", () => {
  assert.doesNotMatch(CARD_TERMS, /\d/);
  assert.doesNotMatch(CARD_TERMS, /MON|USDC|—/);
});
