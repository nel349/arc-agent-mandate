import { test } from "node:test";
import assert from "node:assert/strict";
import type { Activity } from "../arc/activity.ts";
import { activityRoute, agentRoute, isReceiptFor, receiptRoute, ROUTES } from "./routes.ts";

/**
 * The addresses screens push each other to.
 *
 * A route is a string until it is wrong, and then it is a tap that does nothing. These pin the ones
 * that are built rather than written, including the receipt's two parameter names, which were spelled
 * by hand at three call sites.
 */

const AGENT = "0x3535816e967Ad2B6271dfadf9138fb07eAB161Ce";

test("an agent's screen and the fixed screens are where every caller expects", () => {
  assert.equal(agentRoute(AGENT), `/agent/${AGENT}`);
  assert.deepEqual(ROUTES, {
    allowances: "/",
    rewards: "/rewards",
    welcome: "/welcome",
    connect: "/connect",
    grant: "/grant",
    activity: "/activity",
    settings: "/settings",
    dev: "/dev",
    preview: "/preview",
  });
});

test("a receipt is addressed by the row's own log, under the names the screen reads", () => {
  const item = { tx: `0x${"1".repeat(64)}`, logIndex: 101 } as Pick<Activity, "tx" | "logIndex">;
  assert.deepEqual(receiptRoute(item), {
    pathname: "/receipt",
    params: { tx: `0x${"1".repeat(64)}`, log: "101" },
  });
});

test("the feed is scoped to one agent only when one is named", () => {
  assert.deepEqual(activityRoute(), { pathname: "/activity" });
  assert.deepEqual(activityRoute(AGENT), { pathname: "/activity", params: { agent: AGENT } });
});

test("a payment that shared its operation with another is addressed by its call too, and finds only itself", () => {
  const tx = `0x${"2".repeat(64)}` as const;
  const first = { tx, logIndex: 7, call: 0 };
  const second = { tx, logIndex: 7, call: 1 };
  const route = receiptRoute(second);
  assert.deepEqual(route.params, { tx, log: "7", call: "1" });
  assert.equal(isReceiptFor(second, route.params), true);
  assert.equal(isReceiptFor(first, route.params), false);
  // a row that is its own log carries no call, and is found as it always was
  const own = { tx, logIndex: 3 };
  assert.equal(isReceiptFor(own, receiptRoute(own).params), true);
  assert.equal(isReceiptFor(own, route.params), false);
});
