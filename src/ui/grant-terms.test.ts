import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_WINDOW_DAYS, readGrantTerms } from "./grant-terms.ts";

const AGENT = "0x68c91fb4f4e7f0236fd68c7d2605b5740787b17e";
const ok = { agent: AGENT, amount: "20", days: "7" };
const has = (r: ReturnType<typeof readGrantTerms>) => "terms" in r;

test("a complete form reads as terms", () => {
  const read = readGrantTerms(ok);
  assert.ok(has(read));
  assert.equal(read.terms.days, 7);
  assert.equal(read.terms.limit.format(2), "20.00");
  assert.equal(read.terms.agent, AGENT);
});

/**
 * The regression this file exists for. Every one of these used to leave the Grant button lit and
 * produce a mandate with no expiry at all — invalid input resolving to the most permissive
 * possible reading of it.
 */
for (const days of ["", "   ", "abc", "0", "-5", "7abc", "NaN", "Infinity"]) {
  test(`an unreadable window (${JSON.stringify(days)}) is refused, never treated as "no expiry"`, () => {
    const read = readGrantTerms({ ...ok, days });
    assert.ok(!has(read), `"${days}" was accepted as a window`);
    assert.notEqual(read.problems.days, null);
  });
}

test("a bad address is refused and named", () => {
  const read = readGrantTerms({ ...ok, agent: "0xnope" });
  assert.ok(!has(read));
  assert.notEqual(read.problems.agent, null);
  assert.equal(read.problems.amount, null);
  assert.equal(read.problems.days, null);
});

test("an unusable amount is refused, including a negative or zero one", () => {
  // "-1" parses cleanly into a negative quantity, which is nonsense as a limit and would
  // otherwise fail only when viem refused to encode it as a uint256, long after the button lit.
  for (const amount of ["", "abc", "-1", "-0.5", "0", "0.00"]) {
    const read = readGrantTerms({ ...ok, amount });
    assert.ok(!has(read), `"${amount}" was accepted as an amount`);
    assert.notEqual(read.problems.amount, null);
  }
});

test("every problem is reported at once, not one per attempt", () => {
  const read = readGrantTerms({ agent: "nope", amount: "x", days: "" });
  assert.ok(!has(read));
  assert.notEqual(read.problems.agent, null);
  assert.notEqual(read.problems.amount, null);
  assert.notEqual(read.problems.days, null);
});

test("fractional and long-but-sane windows are allowed", () => {
  assert.ok(has(readGrantTerms({ ...ok, days: "0.5" })));
  assert.ok(has(readGrantTerms({ ...ok, days: "365" })));
  assert.ok(has(readGrantTerms({ ...ok, days: String(MAX_WINDOW_DAYS) })));
});

/**
 * The contract holds an expiry in a uint48. Past that, viem throws while encoding the call — an
 * unhandled error raised by a button that looked ready. Well before that, the number stops
 * meaning anything: an expiry in the year 275,000 is no expiry at all.
 */
test("a window beyond the maximum is refused, not encoded", () => {
  for (const days of [String(MAX_WINDOW_DAYS + 1), "99999999", "9999999999999", "1e30"]) {
    const read = readGrantTerms({ ...ok, days });
    assert.ok(!has(read), `"${days}" was accepted as a window`);
  }
});

test("the expiry the maximum produces still fits a uint48", () => {
  const read = readGrantTerms({ ...ok, days: String(MAX_WINDOW_DAYS) });
  assert.ok(has(read));
  const expiresAt = Math.floor(Date.now() / 1000) + Math.round(read.terms.days * 86_400);
  assert.ok(expiresAt < 2 ** 48, "the maximum window overflows the contract's uint48");
});
