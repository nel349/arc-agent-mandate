import { test } from "node:test";
import assert from "node:assert/strict";
import { ringGeometry, roundedArc, RING_WARNS_AT } from "./ring-geometry.ts";

/**
 * The rule, not the drawing.
 *
 * These are the assertions the web makes about the same mark in `arc-maze/test/brand.test.ts`. Two
 * repositories, one rule: if these two files stop agreeing, the phone and the web are drawing
 * different marks and calling them the same brand.
 */

const RADIUS = 40;
const circumference = 2 * Math.PI * RADIUS;

test("an untouched allowance draws no arc at all", () => {
  const ring = ringGeometry(0, RADIUS);
  assert.equal(ring.empty, true);
  assert.equal(ring.drawn, 0);
});

test("an exhausted one draws the whole ring", () => {
  const ring = ringGeometry(1, RADIUS);
  assert.equal(ring.empty, false);
  assert.equal(ring.drawn.toFixed(2), circumference.toFixed(2));
});

/**
 * A limit can be lowered below what is already spent — the supported way to rein an agent in
 * without revoking it. The ring must not wrap past its own start, because a ring that has gone all
 * the way round twice is indistinguishable from one that has not started.
 */
test("more spent than the limit allows is clamped, not wrapped", () => {
  const ring = ringGeometry(1.8, RADIUS);
  assert.equal(ring.fraction, 1);
  assert.equal(ring.drawn.toFixed(2), circumference.toFixed(2));
});

test("a negative or absent figure reads as nothing spent, never as more", () => {
  for (const bad of [-3, Number.NaN, Number.POSITIVE_INFINITY]) {
    const ring = ringGeometry(bad, RADIUS);
    assert.equal(ring.fraction, 0, `${bad} should clamp to nought`);
    assert.equal(ring.empty, true);
    // The direction that matters: an unknown figure must never look like an emptier allowance.
    assert.equal(ring.warning, false);
  }
});

test("the warning starts at nine tenths, and nine tenths is inside it", () => {
  assert.equal(ringGeometry(RING_WARNS_AT, RADIUS).warning, true);
  assert.equal(ringGeometry(RING_WARNS_AT - 0.001, RADIUS).warning, false);
  assert.equal(ringGeometry(1, RADIUS).warning, true);
});

test("the arc is the fraction of the circumference, at whatever radius it is drawn", () => {
  for (const radius of [12, 40, 96]) {
    const ring = ringGeometry(0.25, radius);
    assert.equal(ring.circumference.toFixed(4), (2 * Math.PI * radius).toFixed(4));
    assert.equal(ring.drawn.toFixed(4), (ring.circumference * 0.25).toFixed(4));
  }
});

/**
 * Zero and "very nearly zero" are different pictures on purpose: a dasharray of length 0 with a
 * round linecap renders as a dot on iOS, so an untouched allowance would show a bead at twelve
 * o'clock rather than a clean empty ring.
 */
test("a sliver spent is an arc, not the empty state", () => {
  const sliver = ringGeometry(0.001, RADIUS);
  assert.equal(sliver.empty, false);
  assert.ok(sliver.drawn > 0);
});

/**
 * The part that is left is the arc that is drawn, so it has to begin exactly where the gone part
 * ends and the two have to make the whole ring between them.
 */
test("what is left begins where what is gone ends, and together they are the ring", () => {
  for (const fraction of [0, 0.25, 0.5, 0.9]) {
    const ring = ringGeometry(fraction, RADIUS);
    assert.equal((ring.drawn + ring.left).toFixed(4), ring.circumference.toFixed(4));
    assert.equal(ring.leftFrom, 360 * fraction);
  }
});

test("only an allowance with nothing left is spent out, and it draws no arc", () => {
  assert.equal(ringGeometry(1, RADIUS).spentOut, true);
  assert.equal(ringGeometry(1, RADIUS).left, 0);
  assert.equal(ringGeometry(1.8, RADIUS).spentOut, true);
  assert.equal(ringGeometry(0.999, RADIUS).spentOut, false);
  assert.equal(ringGeometry(Number.NaN, RADIUS).spentOut, false);
});

/**
 * Round ends reach half a stroke past each end of a dash. Drawn at full length, a ring half spent
 * showed about 54% left and one 1% spent showed no gap at all.
 */
const STROKE = 12;
const seen = (fraction: number) => {
  const ring = ringGeometry(fraction, RADIUS);
  const arc = roundedArc(ring, STROKE);
  const perUnit = 360 / ring.circumference;
  // What is on screen, ends included: from half a stroke before the dash to half a stroke after it.
  return { ring, from: arc.from - (STROKE / 2) * perUnit, to: arc.from + (arc.dash + STROKE / 2) * perUnit };
};

test("with its round ends, what is drawn is exactly what is left", () => {
  for (const fraction of [0.01, 0.03, 0.2, 0.5, 0.9]) {
    const { ring, from, to } = seen(fraction);
    assert.equal(from.toFixed(4), ring.leftFrom.toFixed(4), `${fraction} starts where the gone part ends`);
    assert.equal(to.toFixed(4), "360.0000", `${fraction} ends at twelve o'clock, not past it`);
  }
});

test("a sliver too short for round ends is a bead inside what is left of the ring", () => {
  const ring = ringGeometry(0.995, RADIUS);
  assert.ok(ring.left < STROKE);
  const arc = roundedArc(ring, STROKE);
  assert.ok(arc.dash > 0 && arc.dash < 1);
  assert.ok(arc.from > ring.leftFrom && arc.from < 360);
});
