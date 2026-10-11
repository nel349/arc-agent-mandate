import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_EVENTS, DEMO_LIMIT, DEMO_PULSE, DEMO_STEPS, DEMO_STILL_STEP, demoFigure, demoFrame, exampleLayout,
  nextDemoStep,
} from "./welcome-demo.ts";

const ROWS = 2;

test("it starts granted, with everything left and nothing listed", () => {
  const frame = demoFrame(0, ROWS);
  assert.equal(frame.state, "granted");
  assert.equal(frame.left, DEMO_LIMIT);
  assert.equal(frame.spentFraction, 0);
  assert.deepEqual(frame.rows, []);
  assert.equal(frame.beat, 0);
});

test("each payment takes exactly its amount, and beats once", () => {
  let left = DEMO_LIMIT;
  let beat = 0;
  DEMO_EVENTS.forEach((event, index) => {
    const frame = demoFrame(index + 1, ROWS);
    if (!event.refused) { left -= event.amount; beat += 1; }
    assert.equal(frame.left, left, `after ${event.what}`);
    assert.equal(frame.beat, beat, `after ${event.what}`);
    assert.equal(frame.spentFraction, (DEMO_LIMIT - left) / DEMO_LIMIT);
  });
});

/** The promise the example ends on: what does not fit is turned away, and nothing moves. */
test("the last payment is more than is left, is refused, and spends nothing", () => {
  const last = DEMO_EVENTS[DEMO_EVENTS.length - 1];
  assert.ok(last?.refused);
  const before = demoFrame(DEMO_EVENTS.length - 1, ROWS);
  const after = demoFrame(DEMO_EVENTS.length, ROWS);
  assert.ok(last.amount > before.left, "the refused payment has to be one that could not fit");
  assert.equal(after.left, before.left);
  assert.equal(after.beat, before.beat);
  assert.equal(after.state, "refused");
  assert.equal(after.rows[0]?.refused, true);
});

test("no payment before the refusal is more than was left when it was made", () => {
  DEMO_EVENTS.forEach((event, index) => {
    if (event.refused) return;
    assert.ok(event.amount <= demoFrame(index, ROWS).left, `${event.what} would not have fitted`);
  });
});

test("rows are newest first, only as many as asked for, and only the newest is fresh", () => {
  const frame = demoFrame(4, ROWS);
  assert.deepEqual(frame.rows.map((row) => row.what), [DEMO_EVENTS[3]?.what, DEMO_EVENTS[2]?.what]);
  assert.deepEqual(frame.rows.map((row) => row.fresh), [true, false]);
  assert.equal(new Set(frame.rows.map((row) => row.key)).size, frame.rows.length);
  assert.equal(demoFrame(4, 1).rows.length, 1);
});

test("while the refusal is held nothing is fresh, and then it starts again", () => {
  const held = demoFrame(DEMO_EVENTS.length + 1, ROWS);
  assert.equal(held.state, "refused");
  assert.equal(held.rows.some((row) => row.fresh), false);
  assert.equal(nextDemoStep(DEMO_STEPS - 1), 0);
  assert.equal(nextDemoStep(0), 1);
});

test("the still frame is an agent at work with something left and nothing refused", () => {
  const still = demoFrame(DEMO_STILL_STEP, ROWS);
  assert.equal(still.state, "spending");
  assert.ok(still.left > 0 && still.left < DEMO_LIMIT);
  assert.equal(still.rows.some((row) => row.refused), false);
});

test("a step outside the example is clamped, not read past the end", () => {
  assert.equal(demoFrame(-3, ROWS).state, "granted");
  assert.equal(demoFrame(999, ROWS).left, demoFrame(DEMO_EVENTS.length, ROWS).left);
});

test("hundredths print as a figure with two places", () => {
  assert.equal(demoFigure(238), "2.38");
  assert.equal(demoFigure(500), "5.00");
  assert.equal(demoFigure(2), "0.02");
});

/** A line that has moved down one place is the same line, or it would arrive a second time. */
test("a row keeps its key when a newer one arrives above it", () => {
  for (let step = 1; step < DEMO_EVENTS.length; step++) {
    assert.equal(demoFrame(step, ROWS).rows[0]?.key, demoFrame(step + 1, ROWS).rows[1]?.key, `step ${step}`);
  }
});

test("the refusal arrives fresh like any other line, and stays refused for the whole hold", () => {
  assert.equal(demoFrame(DEMO_EVENTS.length, ROWS).rows[0]?.fresh, true);
  for (let step = DEMO_EVENTS.length; step < DEMO_STEPS; step++) {
    assert.equal(demoFrame(step, ROWS).state, "refused", `step ${step}`);
  }
});

test("a refusal is counted once, and only once it has happened", () => {
  assert.equal(demoFrame(DEMO_EVENTS.length - 1, ROWS).refusals, 0);
  assert.equal(demoFrame(DEMO_EVENTS.length, ROWS).refusals, 1);
  assert.equal(demoFrame(DEMO_STEPS - 1, ROWS).refusals, 1);
});

/** What is left after a refusal is still the agent's to spend, so the line must not say stopped. */
test("the line runs only while the example is spending, and never reads as stopped", () => {
  assert.equal(DEMO_PULSE.spending, "spending");
  assert.equal(DEMO_PULSE.granted, "resting");
  assert.equal(DEMO_PULSE.refused, "resting");
});

test("a short window gets one payment line, a tiny one none, and exactly at a threshold it is the larger", () => {
  assert.deepEqual(exampleLayout(548, 740, 600), { rows: 0, short: true, tiny: true });
  assert.deepEqual(exampleLayout(599, 740, 600), { rows: 0, short: true, tiny: true });
  assert.deepEqual(exampleLayout(600, 740, 600), { rows: 1, short: true, tiny: false });
  assert.deepEqual(exampleLayout(664, 740, 600), { rows: 1, short: true, tiny: false });
  assert.deepEqual(exampleLayout(740, 740, 600), { rows: 2, short: false, tiny: false });
  assert.deepEqual(exampleLayout(900, 740, 600), { rows: 2, short: false, tiny: false });
});

test("with no room for payment lines the example still plays, with none listed", () => {
  const frame = demoFrame(4, 0);
  assert.deepEqual(frame.rows, []);
  assert.equal(frame.state, "spending");
  assert.ok(frame.left < DEMO_LIMIT);
});
