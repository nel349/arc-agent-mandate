import { test } from "node:test";
import assert from "node:assert/strict";
import { figureSizeFor, onTheWay, stepBetween } from "./counting.ts";

/** Amounts in a coin's smallest units, eighteen places, as the wallet keeps them. */
const units = (decimal: string): bigint => {
  const [whole, fraction = ""] = decimal.split(".");
  return BigInt(whole ?? "0") * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
};

/** A hundredth of the coin: the smallest step a figure is ever printed in. */
const HUNDREDTH = 10n ** 16n;

test("the step is the coarsest both ends are whole multiples of", () => {
  assert.equal(stepBetween(units("25"), units("23.75")), 10n ** 16n);     // hundredths
  assert.equal(stepBetween(units("0.01"), units("0.008")), 10n ** 15n);   // thousandths
  assert.equal(stepBetween(units("50"), units("0")), 10n ** 19n);
  assert.equal(stepBetween(units("0.000001"), units("5")), 10n ** 12n);
});

/** 5 to 4 was one step, so it jumped; 0 to 20 showed 10.00 and nothing else. */
test("a round figure still counts, in hundredths", () => {
  assert.equal(stepBetween(units("5"), units("4"), HUNDREDTH), HUNDREDTH);
  assert.equal(stepBetween(units("0"), units("20"), HUNDREDTH), HUNDREDTH);
  assert.equal(stepBetween(units("0.01"), units("0.008"), HUNDREDTH), 10n ** 15n);
  const halfway = Number(units("5")) + (Number(units("4")) - Number(units("5"))) * 0.37;
  assert.equal(onTheWay(units("5"), units("4"), halfway, HUNDREDTH), units("4.63"));
});

test("two noughts do not search for ever", () => {
  assert.ok(stepBetween(0n, 0n) > 0n);
});

/** 0.01 to 0.008 on an eighteen-decimal coin passed through 0.009458: six places where three were granted. */
test("on the way it shows no digit finer than its two ends", () => {
  const from = units("0.01");
  const to = units("0.008");
  for (const part of [0.1, 0.271, 0.5, 0.83]) {
    const shown = Number(from) + (Number(to) - Number(from)) * part;
    assert.equal(onTheWay(from, to, shown) % 10n ** 15n, 0n, `part ${part}`);
  }
  assert.equal(onTheWay(from, to, Number(from) + (Number(to) - Number(from)) * 0.5), units("0.009"));
});

/** 590.33 does not survive a float. Redrawn from one it read 590.32 for a frame. */
test("standing at either end it is that end exactly", () => {
  for (const amount of ["590.33", "0.07", "4999.99", "1234.56"]) {
    const at = units(amount);
    assert.equal(onTheWay(at, units("1"), Number(at)), at, amount);
    assert.equal(onTheWay(units("1"), at, Number(at)), at, amount);
  }
});

test("it is never outside the two ends, whichever way it is travelling", () => {
  const low = units("1");
  const high = units("2");
  assert.equal(onTheWay(high, low, Number(units("0.5"))), low);
  assert.equal(onTheWay(high, low, Number(units("2.5"))), high);
  assert.equal(onTheWay(low, high, Number(units("2.5"))), high);
  assert.equal(onTheWay(low, high, Number.NaN), high);
});

test("a short figure is set at the largest size, and a long one as large as fits the ring", () => {
  const room = 122;
  assert.equal(figureSizeFor(4, room, 40, 16), 40);          // "5.00"
  assert.ok(figureSizeFor(5, room, 40, 16) < 40);            // "22.56" does not touch the stroke
  for (const characters of [5, 6, 8, 10]) {
    const size = figureSizeFor(characters, room, 40, 16);
    assert.ok(characters * size * 0.68 <= room, `${characters} characters at ${size} overrun`);
  }
  assert.equal(figureSizeFor(40, room, 40, 16), 16);
  assert.equal(figureSizeFor(0, room, 40, 16), 40);
});
