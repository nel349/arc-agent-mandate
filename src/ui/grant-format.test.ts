import { test } from "node:test";
import assert from "node:assert/strict";
import { expiryDate, grantSummary } from "./grant-format.ts";
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
    gasFloat: Usdc.parse("0.5"),
    now: NOW,
  });
  assert.match(text, /up to 20\.00 USDC/);
  assert.match(text, /until Sep 11/);
  assert.match(text, /further 0\.50 USDC/);
});

test("an open-ended allowance says so instead of naming a date", () => {
  const text = grantSummary({
    limit: Usdc.parse("5"),
    days: null,
    gasFloat: Usdc.parse("0.5"),
    now: NOW,
  });
  assert.match(text, /no expiry date/);
  assert.doesNotMatch(text, /until/);
});

test("a window running into next year names the year, so the date cannot be misread", () => {
  const text = grantSummary({
    limit: Usdc.parse("20"),
    days: 365,
    gasFloat: Usdc.parse("0.5"),
    now: NOW,
  });
  assert.match(text, /until Sep 4, 2027/);
});

test("a window inside this year leaves the year off", () => {
  const text = grantSummary({
    limit: Usdc.parse("20"),
    days: 7,
    gasFloat: Usdc.parse("0.5"),
    now: NOW,
  });
  assert.doesNotMatch(text, /202\d/);
});
