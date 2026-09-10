import { test } from "node:test";
import assert from "node:assert/strict";
import { agentHoldingNote, expiryLabel, fractionUsed, lastUsedLabel, shortAddress, spentPercentLabel } from "./mandate-format.ts";
import { Usdc } from "../arc/usdc.ts";
import type { Mandate } from "../arc/mandate.ts";

const mandate = (limit: string, spent: string, expiresAt?: number): Mandate => {
  const l = Usdc.parse(limit);
  const s = Usdc.parse(spent);
  return {
    agent: "0x1111111111111111111111111111111111111111",
    limit: l, spent: s,
    remaining: s.compare(l) >= 0 ? Usdc.ZERO : l.subtract(s),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    agentFloat: Usdc.parse("0.5"),
    lastUsedAt: null,
    rail: "erc20",
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

/**
 * The cutovers themselves, not values near them.
 *
 * Every one of these is an `<` that could as easily have been `<=`, and the difference only ever
 * shows at the exact boundary — which is where a person watching a countdown will see it.
 */
test("each expiry cutover reads correctly at the second it happens", () => {
  const now = 1_800_000_000_000;
  const at = (seconds: number) => mandate("50", "0", Math.floor(now / 1000) + seconds);

  assert.equal(expiryLabel(at(0), now), "expired", "the moment it expires, not a minute left");
  assert.equal(expiryLabel(at(1), now), "1 min left", "a second left never reads as zero minutes");
  assert.equal(expiryLabel(at(3600), now), "1h left", "an hour exactly is an hour, not 60 min");
  assert.equal(expiryLabel(at(3599), now), "59 min left");
  assert.equal(expiryLabel(at(3600 * 47), now), "47h left");
  assert.equal(expiryLabel(at(3600 * 48), now), "2 days left", "48h exactly is where days begin");
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

/**
 * Nothing is transferred to an agent under the current design, so any holding is an anomaly. The
 * card must not raise one for an amount that cannot be acted on: dust smaller than the gas needed
 * to return it once rendered as "agent holds 0.00", warning about nothing.
 */
test("an agent holding nothing says nothing", () => {
  assert.equal(agentHoldingNote(Usdc.ZERO), null);
});

test("dust too small to be worth returning is not raised as an alarm", () => {
  assert.equal(agentHoldingNote(Usdc.parse("0.000265")), null, "warned about less than the gas to move it");
  assert.equal(agentHoldingNote(Usdc.parse("0.004")), null);
});

test("the thresholds for mentioning a holding are exact", () => {
  // 0.005 USDC is the smallest holding worth raising; 0.01 is where two decimals stop rounding
  // the figure away to "0.00".
  assert.equal(agentHoldingNote(Usdc.parse("0.004999")), null);
  assert.match(String(agentHoldingNote(Usdc.parse("0.005"))), /0\.0050/);
  assert.match(String(agentHoldingNote(Usdc.parse("0.009999"))), /0\.0099/);
  assert.equal(agentHoldingNote(Usdc.parse("0.01")), "agent holds 0.01");
});

test("a holding worth acting on is shown, with enough precision to be a number", () => {
  assert.equal(agentHoldingNote(Usdc.parse("0.005")), "agent holds 0.0050");
  assert.equal(agentHoldingNote(Usdc.parse("0.5")), "agent holds 0.50");
  assert.equal(agentHoldingNote(Usdc.parse("2")), "agent holds 2.00");
});

test("the percentage tracks what has been spent", () => {
  assert.equal(spentPercentLabel(mandate("50", "0")), "0%");
  assert.equal(spentPercentLabel(mandate("50", "25")), "50%");
  assert.equal(spentPercentLabel(mandate("50", "50")), "100%");
});

/**
 * Rounding must not claim nothing has happened, or that nothing is left, when neither is true.
 * The same defect as dust rendering "0.00": a real value rounded away to a reassuring one.
 */
test("a little spending is not rounded away to nothing", () => {
  assert.equal(spentPercentLabel(mandate("50", "0.01")), "<1%");
});

test("an allowance with anything left is never shown as fully spent", () => {
  assert.equal(spentPercentLabel(mandate("50", "49.99")), ">99%");
});

test("spending past the limit reads as fully spent, not more", () => {
  assert.equal(spentPercentLabel(mandate("50", "60")), "100%");
});

/** The clock is fixed so the wording is asserted, not the time of day. */
const NOW = Date.UTC(2026, 8, 6, 12);
const used = (secondsAgo: number | null, spent = "10") => ({
  ...mandate("50", spent),
  lastUsedAt: secondsAgo === null ? null : Math.floor(NOW / 1000) - secondsAgo,
});

test("an agent that has never spent says so, and does not claim to be disconnected", () => {
  // Reading the chain leaves no trace, so "never used" is all anyone can honestly say — an agent
  // that is installed and running looks the same as one that was never set up.
  assert.equal(lastUsedLabel(used(null, "0"), NOW), "never used");
});

/**
 * The contradiction this test used to assert.
 *
 * It called `used(null)` on a mandate that had spent 10 and expected "never used", which is how a
 * real card came to read `0.10 spent · never used` — a claim standing next to the number that
 * disproves it. The chain is the reason: the plugin writes `lastUsedTime` only to measure a refresh
 * window, and every mandate this app grants has no refresh interval, so the field is zero for ever.
 *
 * Verified against the live mandate rather than reasoned about: `limitUsed` 101000, `lastUsedTime`
 * 0. So when money has moved, the honest move is to decline to say *when* rather than to say it
 * never did.
 */
test("money that has moved is never reported as an agent that has never spent", () => {
  assert.equal(lastUsedLabel(used(null, "10"), NOW), "");
  assert.equal(lastUsedLabel(used(null, "0.01"), NOW), "");
  // And the zero case keeps its sentence, because there it is simply true.
  assert.equal(lastUsedLabel(used(null, "0"), NOW), "never used");
});

test("recent use reads as recent", () => {
  assert.equal(lastUsedLabel(used(10), NOW), "used just now");
  assert.equal(lastUsedLabel(used(60 * 5), NOW), "used 5 min ago");
  assert.equal(lastUsedLabel(used(3600 * 3), NOW), "used 3h ago");
  assert.equal(lastUsedLabel(used(86_400 * 4), NOW), "used 4 days ago");
});

test("the unit changes before the number gets silly", () => {
  assert.match(lastUsedLabel(used(3600 * 47), NOW), /^used 47h ago$/);
  assert.match(lastUsedLabel(used(3600 * 49), NOW), /days ago$/);
});

test("and it changes at the exact second, not a second either side", () => {
  assert.equal(lastUsedLabel(used(89), NOW), "used just now");
  assert.equal(lastUsedLabel(used(90), NOW), "used 1 min ago", "90 seconds stops being 'just now'");
  assert.equal(lastUsedLabel(used(60 * 59), NOW), "used 59 min ago");
  assert.equal(lastUsedLabel(used(3600), NOW), "used 1h ago", "an hour exactly is an hour");
  assert.equal(lastUsedLabel(used(3600 * 48), NOW), "used 2 days ago");
});
