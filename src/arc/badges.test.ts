import { test } from "node:test";
import assert from "node:assert/strict";
import type { Address } from "viem";
import { heldBy, mintedNumbers } from "./badges.ts";

/**
 * Finding a wallet's badge in a contract with no index.
 *
 * The cohort is a hundred places handed out in order, so what has been minted follows from what is
 * left. These are the two decisions that makes: which numbers to ask about, and which of the answers
 * is this wallet's.
 */

const MINE = "0xEe1933BbBC8acd7B32caD469D4f22Ca5B19d7918" as Address;
const SOMEBODY = "0xc3BB7bc7E375f7ffA34E652F560Dc802F7A76cFa" as Address;

test("what has been minted follows from the cohort's size and what is left of it", () => {
  // The cohort today: a hundred places, ninety-nine left, so badge one exists and nothing else does.
  assert.deepEqual(mintedNumbers(100n, 99n), [1]);
  assert.deepEqual(mintedNumbers(100n, 100n), [], "an untouched cohort has no badges to ask about");
  assert.deepEqual(mintedNumbers(100n, 97n), [1, 2, 3]);
  assert.equal(mintedNumbers(100n, 0n).length, 100, "a full cohort is the ceiling on the reads");
});

test("a cohort that says more is left than it holds is read as nothing minted, not as a negative", () => {
  assert.deepEqual(mintedNumbers(100n, 101n), []);
});

test("the wallet's badge is the first number it owns, whatever the case of the addresses", () => {
  const owners: [number, Address][] = [[1, SOMEBODY], [2, MINE.toLowerCase() as Address], [3, SOMEBODY]];
  assert.equal(heldBy(owners, MINE), 2);
  assert.equal(heldBy(owners, MINE.toLowerCase() as Address), 2);
  assert.equal(heldBy([[1, SOMEBODY]], MINE), null);
  assert.equal(heldBy([], MINE), null);
});
