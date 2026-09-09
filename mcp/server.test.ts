import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A structural test, for a bug that unit tests could not have caught.
 *
 * `escrowLedger` was correct and thoroughly tested. The defect was that two of the three places
 * asking "how much is in escrow" never went through it: `check_allowance` reported the chain's raw
 * figure and told the user $0.063 was spendable when $0.039 was, and `top_up` sized its deposit
 * against the same raw figure, asking for whatever had not settled a second time — money that
 * escrow only releases as a payment or a delayed withdrawal.
 *
 * No test of the ledger can find that, because the ledger was never wrong. What was wrong was a
 * call site not using it, so what is worth asserting is that exactly one call site exists. The
 * maze does the same thing to keep its router and its published endpoint list in step.
 */

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "server.ts"), "utf8");

/** Ignore the import statement, which names the symbol without calling it. */
const callSites = (haystack: string, fn: string): number =>
  (haystack.match(new RegExp(`\\b${fn}\\(`, "g")) ?? []).length;

test("the chain's escrow figure is read in exactly one place", () => {
  assert.equal(
    callSites(source, "readEscrow"),
    1,
    "A second reader of the raw balance has appeared. Every caller must go through " +
      "spendableEscrow(), or reporting and funding will disagree by whatever has not settled.",
  );
});

test("that one place subtracts what has been claimed and not yet settled", () => {
  const body = source.slice(source.indexOf("async function spendableEscrow("));
  const end = body.indexOf("\n}");
  assert.ok(end > 0, "spendableEscrow() is gone; the single reader it enforces went with it");
  const fn = body.slice(0, end);
  assert.match(fn, /escrow\.spendable\(/, "the one reader stopped consulting the ledger");
  assert.match(fn, /readEscrow\(/, "the one reader stopped consulting the chain");
});

test("the settlement adjustment is not reimplemented anywhere else", () => {
  // A second `escrow.spendable(...)` would be a second answer to the same question, free to drift
  // from the first exactly as the raw reads did. One reader, one adjustment, one answer.
  assert.equal(
    (source.match(/escrow\.spendable\(/g) ?? []).length,
    1,
    "the ledger is consulted in more than one place; fold it back into spendableEscrow()",
  );
});

test("each of the three consumers goes through the reader", () => {
  // Named rather than counted: a count breaks on any honest refactor and proves nothing about
  // which caller was fixed. These are the three questions asked of escrow — what to report, what a
  // purchase still needs, and what a top-up adds to.
  for (const [consumer, marker] of [
    ["check_allowance", "async function escrowLine("],
    ["buy", "async function fundEscrow("],
    ["top_up", "const held = await spendableEscrow();\n    const funded = await fundEscrow("],
  ] as const) {
    const at = source.indexOf(marker);
    assert.ok(at > 0, `${consumer}: could not find ${marker}`);
    const body = source.slice(at, at + 900);
    assert.match(body, /spendableEscrow\(/, `${consumer} does not read escrow through the ledger`);
  }
});
