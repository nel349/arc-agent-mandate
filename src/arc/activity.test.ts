import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activityFromLog, agentInNonce, agentsByTransaction, covering, earlierWindows, EMPTY_FEED,
  FIRST_BACKOFF_MS, hasEarlier, LOG_WINDOW, MAX_BACKOFF_MS, mergeFeed, newWindows, nextBackoff,
  parseFeed, serializeFeed, type Activity, type Feed,
} from "./activity.ts";
import { explorerTxUrl } from "./chain.ts";
import { Usdc } from "./usdc.ts";

const AGENT = "0x3535816e967Ad2B6271dfadf9138fb07eAB161Ce";
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;

const draw = (block: bigint, logIndex = 0, amount = "0.001"): Activity => ({
  kind: "draw", agent: AGENT, amount: Usdc.parse(amount), at: 1_789_067_422, block, tx: hash(Number(block)), logIndex,
});

test("a first read covers the last day, newest window first, each within the RPC's cap", () => {
  const head = 61_470_079n;
  const windows = newWindows(null, head, 0n, 25_000n);
  assert.deepEqual(windows[0], { from: head - LOG_WINDOW, to: head });
  for (const w of windows) assert.ok(w.to - w.from <= LOG_WINDOW);
  // Adjacent and whole: every block from the start of the day to the head, read once.
  for (let i = 1; i < windows.length; i++) assert.equal(windows[i]!.to, windows[i - 1]!.from - 1n);
  assert.equal(windows[windows.length - 1]!.from, head - 25_000n + 1n);
});

test("a first read never reaches below the plugin's deployment", () => {
  const windows = newWindows(null, 1_000n, 900n, 25_000n);
  assert.deepEqual(windows, [{ from: 900n, to: 1_000n }]);
});

test("after that, only the new blocks are read", () => {
  assert.deepEqual(newWindows({ low: 100n, high: 500n }, 520n, 0n), [{ from: 501n, to: 520n }]);
  assert.deepEqual(newWindows({ low: 100n, high: 520n }, 520n, 0n), []);
});

test("reading earlier takes one more day below, adjacent, and stops at the floor", () => {
  const coverage = { low: 50_000n, high: 60_000n };
  const windows = earlierWindows(coverage, 0n, 15_000n);
  assert.equal(windows[0]!.to, 49_999n);
  assert.equal(windows[windows.length - 1]!.from, 35_000n);
  assert.deepEqual(earlierWindows({ low: 10n, high: 20n }, 10n), []);
  assert.equal(hasEarlier({ low: 10n, high: 20n }, 10n), false);
  assert.equal(hasEarlier({ low: 11n, high: 20n }, 10n), true);
});

test("the span read grows by each window and stays one piece", () => {
  let coverage = covering(null, { from: 100n, to: 200n });
  coverage = covering(coverage, { from: 50n, to: 99n });
  coverage = covering(coverage, { from: 201n, to: 210n });
  assert.deepEqual(coverage, { low: 50n, high: 210n });
});

test("merging keeps each event once, newest first", () => {
  const feed: Feed = { coverage: { low: 0n, high: 10n }, items: [draw(5n), draw(3n)], since: null };
  const merged = mergeFeed(feed, [draw(5n), draw(8n), draw(5n, 1)]);
  assert.deepEqual(merged.items.map((i) => [i.block, i.logIndex]), [[8n, 0], [5n, 1], [5n, 0], [3n, 0]]);
});

test("past the cap the oldest go, and the span read is trimmed to match", () => {
  const feed: Feed = { coverage: { low: 1n, high: 10n }, items: [], since: 1 };
  const merged = mergeFeed(feed, [draw(9n), draw(7n), draw(2n)], 2);
  assert.deepEqual(merged.items.map((i) => i.block), [9n, 7n]);
  assert.deepEqual(merged.coverage, { low: 7n, high: 10n });
});

test("a draw is read at Gateway's six decimals", () => {
  const item = activityFromLog("draw", {
    agent: AGENT, value: 1000n, blockNumber: 61_444_111n, timestamp: 1_789_067_422n,
    transactionHash: hash(1), logIndex: 4,
  });
  assert.equal(item?.amount?.format(6), "0.001000");
  assert.equal(item?.at, 1_789_067_422);
});

test("a log missing its block, time or amount is not shown rather than shown wrong", () => {
  const base = { agent: AGENT, blockNumber: 1n, timestamp: 1n, transactionHash: hash(1), logIndex: 0 } as const;
  assert.equal(activityFromLog("draw", base), null);
  assert.equal(activityFromLog("granted", { ...base, blockNumber: null }), null);
  assert.equal(activityFromLog("granted", { ...base, timestamp: null }), null);
  assert.equal(activityFromLog("granted", { ...base, agent: undefined }), null);
  assert.equal(activityFromLog("granted", base)?.amount, null);
});

test("a stored feed reads back as it was written", () => {
  const feed: Feed = {
    coverage: { low: 61_000_000n, high: 61_470_079n },
    items: [draw(61_444_111n, 4), { ...draw(61_400_000n), kind: "granted", amount: null }],
    since: 1_789_000_000,
  };
  const back = parseFeed(serializeFeed(feed));
  assert.deepEqual(back.coverage, feed.coverage);
  assert.equal(back.since, feed.since);
  assert.equal(back.items.length, 2);
  assert.equal(back.items[0]?.amount?.toNativeUnits(), Usdc.parse("0.001").toNativeUnits());
  assert.equal(back.items[1]?.kind, "granted");
});

test("a stored feed that does not read is an empty one, and bad rows are dropped", () => {
  assert.deepEqual(parseFeed(null), EMPTY_FEED);
  assert.deepEqual(parseFeed("{nope"), EMPTY_FEED);
  // Rows without a span to resume from are not kept.
  assert.deepEqual(parseFeed(JSON.stringify({ c: null, i: [] })), EMPTY_FEED);
  const stored = JSON.parse(serializeFeed({ coverage: { low: 1n, high: 2n }, items: [draw(2n)], since: null }));
  stored.i.push({ k: "draw", a: "not an address", u: "1", t: 1, b: "2", h: hash(9), i: 0 });
  stored.i.push({ k: "stolen", a: AGENT, u: null, t: 1, b: "2", h: hash(8), i: 0 });
  assert.equal(parseFeed(JSON.stringify(stored)).items.length, 1);
});

/**
 * A payment straight to somebody, which the feed did not show at all: the wallet is the sender, so
 * the transfer alone cannot say which agent made it.
 *
 * The figures below are one real payment on Arc, transaction `0x431dafcf…a739a8` in block 61,632,911:
 * $0.01 through the ERC-20 view, and the EntryPoint's operation whose nonce carries the session key
 * in its high half and the sequence number in its low one.
 */
const REAL_NONCE = BigInt("0x000000003535816e967ad2b6271dfadf9138fb07eab161ce0000000000000017");
const OWNER = "0xEe1933BbBC8acd7B32caD469D4f22Ca5B19d7918";

test("the agent behind a payment is the session key in its operation's nonce", () => {
  assert.equal(agentInNonce(REAL_NONCE), AGENT);
  // An operation the owner signed themselves owns no key half, and names no agent.
  assert.equal(agentInNonce(23n), null);
});

test("only operations that ran, and were signed by an agent, name the payments in their transaction", () => {
  const agents = agentsByTransaction([
    { transactionHash: hash(1), nonce: REAL_NONCE, success: true },
    { transactionHash: hash(2), nonce: REAL_NONCE, success: false },
    { transactionHash: hash(3), nonce: 23n, success: true },
    { transactionHash: null, nonce: REAL_NONCE, success: true },
    { transactionHash: hash(4), nonce: undefined, success: true },
  ]);
  assert.deepEqual([...agents.entries()], [[hash(1), AGENT]]);
});

test("a payment is read at the view's six decimals, and names who was paid", () => {
  const item = activityFromLog("paid", {
    agent: AGENT, value: 10_000n, to: OWNER, blockNumber: 61_632_911n, timestamp: 1_789_100_000n,
    transactionHash: hash(1), logIndex: 101,
  });
  assert.equal(item?.amount?.format(6), "0.010000");
  assert.equal(item?.to, OWNER);
  assert.equal(item?.kind, "paid");
});

test("a payment with nobody to name, or no amount, is not shown rather than shown wrong", () => {
  const base = {
    agent: AGENT, blockNumber: 1n, timestamp: 1n, transactionHash: hash(1), logIndex: 0,
  } as const;
  assert.equal(activityFromLog("paid", { ...base, value: 1n }), null, "a payment with no payee");
  assert.equal(activityFromLog("paid", { ...base, to: OWNER }), null, "a payment with no amount");
});

test("a payment reads back from the store with its payee, and one stored without a payee is dropped", () => {
  const paid: Activity = {
    kind: "paid", agent: AGENT, amount: Usdc.parse("0.01"), to: OWNER, at: 1_789_100_000,
    block: 61_632_911n, tx: hash(1), logIndex: 101,
  };
  const feed: Feed = { coverage: { low: 61_000_000n, high: 61_700_000n }, items: [paid], since: null };
  assert.deepEqual(parseFeed(serializeFeed(feed)).items, [paid]);

  const stored = JSON.parse(serializeFeed(feed));
  delete stored.i[0].p;
  assert.deepEqual(parseFeed(JSON.stringify(stored)).items, []);
});

/**
 * An agent setting up the ERC-8004 identity its owner holds, which is what a seller credits. The
 * mint names the wallet; the operation in the same transaction names the agent that made it.
 */
test("a registration carries the identity it minted, and one without a number is not shown", () => {
  const base = {
    agent: AGENT, blockNumber: 61_632_911n, timestamp: 1_789_100_000n, transactionHash: hash(1), logIndex: 3,
  } as const;
  const item = activityFromLog("registered", { ...base, identity: 890_537n });
  assert.equal(item?.identity, 890_537n);
  assert.equal(item?.amount, null);
  assert.equal(activityFromLog("registered", base), null);
});

test("a registration reads back from the store with its number, and one stored without is dropped", () => {
  const registered: Activity = {
    kind: "registered", agent: AGENT, amount: null, identity: 890_537n, at: 1_789_100_000,
    block: 61_632_911n, tx: hash(1), logIndex: 3,
  };
  const feed: Feed = { coverage: { low: 61_000_000n, high: 61_700_000n }, items: [registered], since: null };
  assert.deepEqual(parseFeed(serializeFeed(feed)).items, [registered]);

  const stored = JSON.parse(serializeFeed(feed));
  delete stored.i[0].n;
  assert.deepEqual(parseFeed(JSON.stringify(stored)).items, []);
});

test("a transaction links to ArcScan", () => {
  assert.equal(explorerTxUrl(hash(1)), `https://testnet.arcscan.app/tx/${hash(1)}`);
});

test("after a refusal the feed waits half a minute, then twice as long each time, up to five minutes", () => {
  assert.equal(nextBackoff(null), FIRST_BACKOFF_MS);
  assert.equal(nextBackoff(FIRST_BACKOFF_MS), 2 * FIRST_BACKOFF_MS);
  let delay: number | null = null;
  for (let i = 0; i < 20; i++) delay = nextBackoff(delay);
  assert.equal(delay, MAX_BACKOFF_MS);
});
