import { test } from "node:test";
import assert from "node:assert/strict";
import type { Activity } from "../arc/activity.ts";
import { Amount } from "../arc/amount.ts";
import type { Mandate } from "../arc/mandate.ts";
import { SPENDING_FOR_S, lastSpentBy, later, noteSpending, pulseOf, pulseWords, stoppedBy, type SeenSpending } from "./pulse.ts";

const NOW_S = 1_800_000_000;
/** Part-way through a second, as now always is, so a rule that forgot to round down is caught. */
const NOW = NOW_S * 1000 + 700;
/** Letters in it, so a comparison that forgot about case has something to get wrong. */
const AGENT = "0xAbCdEf1111111111111111111111111111aBcDeF";

const mandate = (spent: string, over: Partial<Mandate> = {}): Mandate => {
  const limit = Amount.parse("5");
  const gone = Amount.parse(spent);
  return {
    agent: AGENT, limit, spent: gone,
    remaining: gone.compare(limit) >= 0 ? Amount.ZERO : limit.subtract(gone),
    agentFloat: Amount.ZERO, escrow: Amount.ZERO, lastUsedAt: null, rail: "erc20",
    ...over,
  };
};

const paid = (agent: string, at: number, kind: Activity["kind"] = "paid"): Activity => ({
  kind, agent: agent as `0x${string}`, amount: Amount.parse("0.02"), at,
  block: 1n, tx: "0x00", logIndex: 0,
});

test("an agent reads as spending for a minute and a half after it pays", () => {
  assert.equal(SPENDING_FOR_S, 90);
});

test("an agent that paid a moment ago is spending, and one that paid long ago is resting", () => {
  assert.equal(pulseOf(mandate("1"), NOW_S - 5, NOW), "spending");
  assert.equal(pulseOf(mandate("1"), NOW_S - SPENDING_FOR_S, NOW), "spending");
  assert.equal(pulseOf(mandate("1"), NOW_S - SPENDING_FOR_S - 1, NOW), "resting");
});

test("an agent the wallet has never seen pay is resting, not spending", () => {
  assert.equal(pulseOf(mandate("0"), null, NOW), "resting");
});

/** A phone whose clock is behind the chain's sees a payment made "in the future". It was just made. */
test("a payment timed after now reads as now, however far after", () => {
  assert.equal(pulseOf(mandate("1"), NOW_S + 40, NOW), "spending");
  assert.equal(pulseOf(mandate("1"), NOW_S + 5000, NOW), "spending");
});

test("an allowance that has ended is stopped however lately it paid", () => {
  const ended = mandate("1", { expiresAt: NOW_S - 1 });
  assert.equal(stoppedBy(ended, NOW), "ended");
  assert.equal(pulseOf(ended, NOW_S - 2, NOW), "stopped");
});

test("an allowance with nothing left is stopped, and says that and not that it ended", () => {
  const out = mandate("5");
  assert.equal(stoppedBy(out, NOW), "spent out");
  assert.equal(pulseOf(out, NOW_S - 2, NOW), "stopped");
  assert.equal(pulseWords("stopped", "spent out"), "Nothing left");
});

test("one that has both ended and run out says it ended, which is the one that cannot be undone by a top-up", () => {
  assert.equal(stoppedBy(mandate("5", { expiresAt: NOW_S - 1 }), NOW), "ended");
});

test("an allowance with no end date and something left is never stopped", () => {
  assert.equal(stoppedBy(mandate("4.99"), NOW), null);
});

test("the chain's own time is used where it keeps one, and the feed where it does not", () => {
  const feed = [paid(AGENT, NOW_S - 300), paid(AGENT, NOW_S - 20, "draw"), paid(AGENT, NOW_S - 1, "granted")];
  assert.equal(lastSpentBy(mandate("1", { lastUsedAt: NOW_S - 7 }), feed), NOW_S - 7);
  // A grant is not a payment, so the newest thing that counts is the draw.
  assert.equal(lastSpentBy(mandate("1"), feed), NOW_S - 20);
  assert.equal(lastSpentBy(mandate("1"), []), null);
});

test("another agent's payments do not make this one look busy, whatever the case of the address", () => {
  const other = "0x2222222222222222222222222222222222222222";
  assert.equal(lastSpentBy(mandate("1"), [paid(other, NOW_S - 1)]), null);
  assert.equal(lastSpentBy(mandate("1"), [paid(AGENT.toLowerCase(), NOW_S - 3)]), NOW_S - 3);
  assert.equal(lastSpentBy(mandate("1"), [paid(`0x${AGENT.slice(2).toUpperCase()}`, NOW_S - 4)]), NOW_S - 4);
});

test("the later of two times, either of which may not be known", () => {
  assert.equal(later(null, null), null);
  assert.equal(later(5, null), 5);
  assert.equal(later(null, 7), 7);
  assert.equal(later(5, 7), 7);
  assert.equal(later(9, 7), 9);
});

test("the words for each state", () => {
  assert.equal(pulseWords("spending", null), "Spending now");
  assert.equal(pulseWords("resting", null), "Resting");
  assert.equal(pulseWords("stopped", "ended"), "Ended");
});

test("the first sight of an agent's spending is not a rise, and a rise is timed when it is seen", () => {
  const seen = new Map<string, SeenSpending>();
  assert.equal(noteSpending(seen, "a", 500n, NOW), null);
  assert.equal(noteSpending(seen, "a", 500n, NOW + 9000), null);
  assert.equal(noteSpending(seen, "a", 520n, NOW + 10_000), NOW_S + 10);
  // Unchanged since: still the time it rose, not the time it was asked.
  assert.equal(noteSpending(seen, "a", 520n, NOW + 60_000), NOW_S + 10);
});

/** A list row sees the payment; the agent's page, opened a moment later, has to know of it too. */
test("what one screen saw rise, another asking about the same agent is told", () => {
  const seen = new Map<string, SeenSpending>();
  noteSpending(seen, "a", 500n, NOW);
  noteSpending(seen, "a", 520n, NOW + 10_000);
  assert.equal(noteSpending(seen, "a", 520n, NOW + 12_000), NOW_S + 10);
  assert.equal(noteSpending(seen, "b", 520n, NOW + 12_000), null);
});

/** Revoked and granted again: the new allowance has spent nothing, whatever the old one did. */
test("a figure that falls is a new allowance, and forgets when the old one rose", () => {
  const seen = new Map<string, SeenSpending>();
  noteSpending(seen, "a", 500n, NOW);
  noteSpending(seen, "a", 520n, NOW + 10_000);
  assert.equal(noteSpending(seen, "a", 0n, NOW + 20_000), null);
  assert.equal(noteSpending(seen, "a", 0n, NOW + 30_000), null);
  assert.equal(noteSpending(seen, "a", 2n, NOW + 40_000), NOW_S + 40);
});
