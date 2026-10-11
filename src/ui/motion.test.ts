import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARRIVE_MS, BEAT_MS, COUNT_MS, DEMO_STEP_MS, FLAT_PATH, LIT_MS, REST_PATH, TRACE_BOX, TRACE_DASH,
  TRACE_LENGTH, TRACE_LIT, TRACE_PATH, between, easeOut, traceOffset,
} from "./motion.ts";

test("easing starts at nought, ends at one, never goes back, and is clamped outside that", () => {
  assert.equal(easeOut(0), 0);
  assert.equal(easeOut(1), 1);
  assert.equal(easeOut(-2), 0);
  assert.equal(easeOut(7), 1);
  let last = 0;
  for (let t = 0; t <= 1; t += 0.05) {
    assert.ok(easeOut(t) >= last, `went backwards at ${t}`);
    last = easeOut(t);
  }
  assert.ok(easeOut(0.5) > 0.5, "fast first, then settling");
});

test("between is the first value at nought and the second at one", () => {
  assert.equal(between(2, 10, 0), 2);
  assert.equal(between(2, 10, 1), 10);
  assert.equal(between(2, 10, 0.25), 4);
});

/** A payment has to finish before the next one starts, or the example is two things at once. */
test("a figure settles inside a beat, and a beat inside a step of the example", () => {
  assert.ok(COUNT_MS < BEAT_MS);
  assert.ok(BEAT_MS < DEMO_STEP_MS);
  assert.ok(ARRIVE_MS < LIT_MS);
  // A line is no longer lit when the next one arrives, or two are lit at once and neither is new.
  assert.ok(LIT_MS < DEMO_STEP_MS);
});

test("the line runs the full width, and is longer than its width because it has beats in it", () => {
  assert.ok(TRACE_PATH.startsWith("M0 "));
  assert.ok(TRACE_PATH.includes(`L${TRACE_BOX.width} `));
  assert.ok(TRACE_LENGTH > TRACE_BOX.width);
  for (const path of [REST_PATH, FLAT_PATH]) assert.ok(path.endsWith(`L${TRACE_BOX.width} 24`));
});

/** The lit part is off one end at the start and off the other at the end, so the loop has no jump in it. */
test("the lit part starts just off the left and ends just off the right", () => {
  assert.equal(traceOffset(0), TRACE_LIT);
  assert.equal(traceOffset(1).toFixed(6), (-TRACE_LENGTH).toFixed(6));
  assert.ok(traceOffset(0.5) < traceOffset(0.25));
});

test("there is never room for a second lit part on the line", () => {
  const [lit, gap] = TRACE_DASH;
  assert.equal(lit, TRACE_LIT);
  assert.ok(gap >= TRACE_LENGTH + TRACE_LIT);
});

/** The path as drawn, read back from its own text, so the length is checked against the drawing and not against itself. */
const drawn = (path: string): [number, number][] =>
  [...path.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

test("the length the dash is built on is the length of the line that is drawn", () => {
  const points = drawn(TRACE_PATH);
  assert.ok(points.length > 4);
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i] ?? [0, 0];
    const [px, py] = points[i - 1] ?? [0, 0];
    length += Math.hypot(x - px, y - py);
  }
  assert.equal(TRACE_LENGTH.toFixed(6), length.toFixed(6));
});

test("every point of every line is inside the box it is drawn in, and runs left to right", () => {
  for (const path of [TRACE_PATH, REST_PATH, FLAT_PATH]) {
    const points = drawn(path);
    points.forEach(([x, y], i) => {
      assert.ok(x >= 0 && x <= TRACE_BOX.width && y >= 0 && y <= TRACE_BOX.height, `${x},${y} is outside the box`);
      if (i > 0) assert.ok(x >= (points[i - 1]?.[0] ?? 0), "the line doubles back");
    });
  }
});

test("the lit part moves at one speed", () => {
  assert.equal(traceOffset(0.5).toFixed(6), ((traceOffset(0) + traceOffset(1)) / 2).toFixed(6));
  assert.equal((traceOffset(0.25) - traceOffset(0)).toFixed(6), (traceOffset(1) - traceOffset(0.75)).toFixed(6));
});
