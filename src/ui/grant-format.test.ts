import { test } from "node:test";
import assert from "node:assert/strict";
import { exceedsWallet, expiryDate, grantedSentence, grantSummary, windowEndLabel } from "./grant-format.ts";
import { Usdc } from "../arc/usdc.ts";

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
    limit: Usdc.parse("20"),
    days: 7,
    now: NOW,
  });
  assert.match(text, /up to 20\.00 USDC/);
  assert.match(text, /until 11 Sep/);
  assert.match(text, /Nothing is transferred to the agent/);
});

test("an open-ended allowance says so instead of naming a date", () => {
  const text = grantSummary({
    limit: Usdc.parse("5"),
    days: null,
    now: NOW,
  });
  assert.match(text, /no expiry date/);
  assert.doesNotMatch(text, /until/);
});

test("a window running into next year names the year, so the date cannot be misread", () => {
  const text = grantSummary({
    limit: Usdc.parse("20"),
    days: 365,
    now: NOW,
  });
  assert.match(text, /until 4 Sep 2027/);
});

test("a window inside this year leaves the year off", () => {
  const text = grantSummary({
    limit: Usdc.parse("20"),
    days: 7,
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
  assert.equal(exceedsWallet(Usdc.parse("20"), Usdc.parse("4.39")), true);
  assert.equal(exceedsWallet(Usdc.parse("4.39"), Usdc.parse("4.39")), false);
  assert.equal(exceedsWallet(Usdc.parse("20"), null), false);
});

test("the confirmation names who, how much and until when, and says nothing has moved", () => {
  const now = new Date(2026, 8, 10, 12).getTime();
  assert.equal(
    grantedSentence({ who: "Maze runner", limit: Usdc.parse("20"), days: 7, now }),
    "Maze runner can now spend up to 20.00 USDC until 17 Sep. Nothing has left your wallet yet.",
  );
});
