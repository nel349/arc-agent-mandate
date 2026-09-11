import { test } from "node:test";
import assert from "node:assert/strict";
import { clockTime, dayMonth, daysAgo, weekdayDayMonth } from "./calendar.ts";

// Built from local calendar fields, so every assertion holds in whatever time zone the test runs.
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m, d, h, min).getTime() / 1000;

test("a date reads as day and short month", () => {
  assert.equal(dayMonth(at(2026, 8, 17)), "17 Sep");
  assert.equal(weekdayDayMonth(at(2026, 8, 9)), "Wed 9 Sep");
});

test("a time reads on the 24-hour clock, padded", () => {
  assert.equal(clockTime(at(2026, 8, 10, 19, 10)), "19:10");
  assert.equal(clockTime(at(2026, 8, 10, 7, 5)), "07:05");
});

test("days ago counts calendar days, not 24-hour spans", () => {
  // `now` is milliseconds, as `Date.now()` gives it; the dates are the chain's seconds.
  const now = new Date(2026, 8, 10, 0, 30).getTime();
  assert.equal(daysAgo(at(2026, 8, 10, 0, 5), now), 0);
  // Eleven hours earlier, but on the previous date: yesterday, not today.
  assert.equal(daysAgo(at(2026, 8, 9, 13, 30), now), 1);
  assert.equal(daysAgo(at(2026, 8, 3), now), 7);
});
