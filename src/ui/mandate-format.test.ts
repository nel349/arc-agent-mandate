import { test } from "node:test";
import assert from "node:assert/strict";
import { expiryLabel, fractionUsed, shortAddress } from "./mandate-format.ts";
import { Usdc } from "../arc/usdc.ts";
import type { Mandate } from "../arc/mandate.ts";

const mandate = (limit: string, spent: string, expiresAt?: number): Mandate => {
  const l = Usdc.parse(limit);
  const s = Usdc.parse(spent);
  return {
    agent: "0x1111111111111111111111111111111111111111",
    limit: l, spent: s,
    remaining: s.compare(l) >= 0 ? Usdc.ZERO : l.subtract(s),
    expiresAt,
    agentFloat: Usdc.parse("0.5"),
  };
};

test("a fresh mandate reads as nothing used", () => {
  assert.equal(fractionUsed(mandate("50", "0")), 0);
});

test("a half-spent mandate reads as half", () => {
  assert.equal(fractionUsed(mandate("50", "25")), 0.5);
});

test("spending past the limit clamps to full rather than overflowing the bar", () => {
  // Lowering a limit below what is already spent is a supported way to stop an agent, so this
  // is a real state, not a corner case.
  assert.equal(fractionUsed(mandate("10", "25")), 1);
});

test("a zero limit reads as spent, not as a division by zero", () => {
  assert.equal(fractionUsed(mandate("0", "0")), 1);
});

test("very large amounts do not overflow the fraction", () => {
  // The ratio is computed in bigint and only the small result becomes a float, so a limit far
  // beyond Number.MAX_SAFE_INTEGER in native units is still exact.
  assert.equal(fractionUsed(mandate("1000000000", "500000000")), 0.5);
});

test("a spend too small to see rounds down rather than up", () => {
  // One millionth of a mandate is not renderable on a bar, and rounding it up would show
  // progress that has not happened.
  assert.equal(fractionUsed(mandate("1000000", "1")), 0);
});

test("an expiry in the past reads as expired, not as negative time", () => {
  const now = 1_800_000_000_000;
  assert.equal(expiryLabel(mandate("50", "0", 1_700_000_000), now), "expired");
});

test("expiry is reported in the unit a person would use", () => {
  const now = 1_800_000_000_000;
  const at = (seconds: number) => mandate("50", "0", Math.floor(now / 1000) + seconds);
  assert.equal(expiryLabel(at(1800), now), "30 min left");
  assert.equal(expiryLabel(at(7200), now), "2h left");
  assert.equal(expiryLabel(at(86_400 * 6), now), "6 days left");
});

test("no expiry says so rather than showing nothing", () => {
  assert.equal(expiryLabel(mandate("50", "0")), "no expiry");
});

test("addresses shorten to something recognisable", () => {
  assert.equal(
    shortAddress("0x68c91fb4f4e7f0236fd68c7d2605b5740787b17e"),
    "0x68c91fb4…787b17e",
  );
});
