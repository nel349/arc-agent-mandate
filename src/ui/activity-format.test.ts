import { test } from "node:test";
import assert from "node:assert/strict";
import type { Activity } from "../arc/activity.ts";
import { Usdc } from "../arc/usdc.ts";
import { activityAmount, activityRowText, dayHeading, formatAmount, groupByDay, lastSpentAt } from "./activity-format.ts";

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime() / 1000;
const row = (seconds: number, amount: string | null = "0.001"): Activity => ({
  kind: amount === null ? "granted" : "draw",
  agent: "0x3535816e967Ad2B6271dfadf9138fb07eAB161Ce",
  amount: amount === null ? null : Usdc.parse(amount),
  at: seconds,
  block: 1n,
  tx: `0x${"1".repeat(64)}`,
  logIndex: 0,
});

test("an amount shows the places it has, never fewer than two", () => {
  assert.equal(formatAmount(Usdc.parse("0.001")), "0.001");
  assert.equal(formatAmount(Usdc.parse("0.28")), "0.28");
  assert.equal(formatAmount(Usdc.parse("12")), "12.00");
  assert.equal(formatAmount(Usdc.parse("0.000265")), "0.000265");
});

test("money leaving is written with a minus, and a grant carries no figure", () => {
  assert.equal(activityAmount(row(1, "0.001")), "−0.001");
  assert.equal(activityAmount(row(1, null)), null);
});

test("days read as today, yesterday, then the date", () => {
  const now = new Date(2026, 8, 10, 20).getTime();
  assert.equal(dayHeading(at(2026, 8, 10, 9), now), "Today");
  assert.equal(dayHeading(at(2026, 8, 9, 23), now), "Yesterday");
  assert.equal(dayHeading(at(2026, 8, 7), now), "Mon 7 Sep");
});

test("rows are grouped under their day in the order given", () => {
  const now = new Date(2026, 8, 10, 20).getTime();
  const days = groupByDay([row(at(2026, 8, 10, 19)), row(at(2026, 8, 10, 9)), row(at(2026, 8, 9)), row(at(2026, 8, 7))], now);
  assert.deepEqual(days.map((d) => [d.heading, d.items.length]), [["Today", 2], ["Yesterday", 1], ["Mon 7 Sep", 1]]);
});

test("across every agent a row leads with who, on one agent's screen with what happened", () => {
  const now = new Date(2026, 8, 10, 20).getTime();
  const item = row(at(2026, 8, 10, 19));
  assert.deepEqual(
    activityRowText(item, { name: "Maze runner", withAgent: true, underDayHeading: true }, now),
    { title: "Maze runner", detail: "Moved to its escrow · 19:00", titleIsAddress: false },
  );
  assert.deepEqual(
    activityRowText(item, { name: null, withAgent: false, underDayHeading: false }, now),
    { title: "Moved to its escrow", detail: "Today 19:00", titleIsAddress: false },
  );
  const unnamed = activityRowText(item, { name: null, withAgent: true, underDayHeading: true }, now);
  assert.match(unnamed.title, /^0x3535816e…/);
  assert.equal(unnamed.titleIsAddress, true);
});

/**
 * The chain never writes a last-used time on the rail the app grants, so "Last used" never showed.
 * The feed knows when money last moved.
 */
test("when the agent last spent is its newest draw in the feed, and a grant is not spending", () => {
  const spent = [row(at(2026, 8, 10, 9)), row(at(2026, 8, 10, 19)), row(at(2026, 8, 9))];
  assert.equal(lastSpentAt(spent), at(2026, 8, 10, 19));
  assert.equal(lastSpentAt([row(at(2026, 8, 10, 21), null), row(at(2026, 8, 10, 8))]), at(2026, 8, 10, 8));
  assert.equal(lastSpentAt([row(at(2026, 8, 10), null)]), null);
  assert.equal(lastSpentAt([]), null);
});
