import { test } from "node:test";
import assert from "node:assert/strict";
import { FIRST_INDEX, MOST_TO_READ, newestIndices } from "./reputation.ts";

/**
 * Which records a screen asks for.
 *
 * The registry numbers feedback from one and reverts on zero, so this arithmetic is the difference
 * between showing an agent's score and reporting that it has none.
 */

test("the newest record is read first, and numbering starts at one", () => {
  assert.deepEqual(newestIndices(1n), [1n]);
  assert.deepEqual(newestIndices(3n), [3n, 2n, 1n]);
  // Index 0 reverts on chain, so it must never be asked for.
  assert.equal(newestIndices(3n).includes(0n), false);
  assert.equal(FIRST_INDEX, 1n);
});

test("an agent nobody has written about is asked nothing", () => {
  assert.deepEqual(newestIndices(0n), []);
});

test("a long history is capped, so one screen cannot make twenty reads", () => {
  const many = newestIndices(50n);
  assert.equal(many.length, MOST_TO_READ);
  // Still the newest, not the oldest: a stale first score must not stand in for the latest.
  assert.equal(many[0], 50n);
  assert.equal(many.at(-1), 50n - BigInt(MOST_TO_READ) + 1n);
});
