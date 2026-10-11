import { test } from "node:test";
import assert from "node:assert/strict";
import { rowKey, type Activity } from "../arc/activity.ts";
import { Amount } from "../arc/amount.ts";
import { JUST_NOW_S, arrivedSince, feedOf, newestOf } from "./arrivals.ts";

/** Now, for these tests. Rows are a few seconds old unless they say otherwise. */
const NOW_S = 1_800_000_000;
const NOW = NOW_S * 1000;

const row = (block: bigint, logIndex: number, call?: number, at: number = NOW_S - 5): Activity => ({
  kind: "paid", agent: "0x1111111111111111111111111111111111111111", amount: Amount.parse("0.02"),
  at, block, tx: `0x${block.toString(16)}${logIndex}` as `0x${string}`, logIndex,
  ...(call === undefined ? {} : { call }),
});

test("the newest row is found wherever it sits in the list", () => {
  assert.deepEqual(newestOf([row(5n, 1), row(9n, 0), row(7n, 3)]), { block: 9n, logIndex: 0, call: 0 });
  assert.deepEqual(newestOf([row(9n, 0), row(9n, 4), row(9n, 2)]), { block: 9n, logIndex: 4, call: 0 });
  assert.deepEqual(newestOf([row(9n, 4, 1), row(9n, 4, 3)]), { block: 9n, logIndex: 4, call: 3 });
  assert.equal(newestOf([]), null);
});

test("a row after the mark has arrived; the marked row and everything before it has not", () => {
  const feed = [row(12n, 0), row(10n, 2), row(10n, 1), row(8n, 0)];
  const mark = newestOf([row(10n, 1), row(8n, 0)]);
  assert.deepEqual(arrivedSince(feed, mark, NOW), [rowKey(row(12n, 0)), rowKey(row(10n, 2))]);
});

/** "Show earlier" brings in rows older than anything on screen. They did not just happen. */
test("rows older than the mark are not arrivals, however many are added", () => {
  const mark = newestOf([row(10n, 0)]);
  assert.deepEqual(arrivedSince([row(10n, 0), row(4n, 0), row(3n, 5), row(1n, 0)], mark, NOW), []);
});

test("a second payment by the same operation is after the first", () => {
  const mark = newestOf([row(10n, 0, 0)]);
  assert.deepEqual(arrivedSince([row(10n, 0, 1), row(10n, 0, 0)], mark, NOW), [rowKey(row(10n, 0, 1))]);
});

test("into a feed that was empty, every recent row has arrived", () => {
  assert.equal(arrivedSince([row(3n, 0), row(2n, 0)], null, NOW).length, 2);
  assert.deepEqual(arrivedSince([], null, NOW), []);
});

/**
 * A phone that was offline, or whose first read failed, catches up on rows that are after the mark
 * and an hour old. They are new to the phone and they did not just happen.
 */
test("a row after the mark but older than a moment ago has not just arrived", () => {
  const mark = newestOf([row(10n, 0)]);
  const caughtUp = [row(14n, 0, undefined, NOW_S - 3600), row(13n, 0, undefined, NOW_S - JUST_NOW_S - 1)];
  assert.deepEqual(arrivedSince(caughtUp, mark, NOW), []);
  assert.deepEqual(arrivedSince(caughtUp, null, NOW), []);
  const onTheEdge = row(15n, 0, undefined, NOW_S - JUST_NOW_S);
  assert.deepEqual(arrivedSince([onTheEdge, ...caughtUp], mark, NOW), [rowKey(onTheEdge)]);
});

test("a feed belongs to a network and a wallet, whatever the case the address was written in", () => {
  assert.equal(feedOf(5042002, "0xABCdef"), feedOf(5042002, "0xabcDEF"));
  assert.notEqual(feedOf(5042002, "0xabc"), feedOf(10143, "0xabc"));
  assert.notEqual(feedOf(5042002, "0xabc"), feedOf(5042002, "0xdef"));
  assert.equal(feedOf(5042002, null), feedOf(5042002, undefined));
});
