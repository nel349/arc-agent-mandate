import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The figures on screen have to be true, and an interval is not enough to make them so.
 *
 * Both screens poll, and both re-read after every write, which looks like enough until you notice
 * what a backgrounded app does to a timer: the platform suspends it. Not slows — stops. So the
 * numbers were as old as the last time the app was open, and were corrected only when the next tick
 * eventually fired, ten seconds after somebody was already reading them.
 *
 * That matters more here than on most screens. The two figures involved are how much an agent may
 * still spend and what the wallet holds — the numbers a person opens this app to check *before*
 * deciding whether to intervene. Being stale at that moment is the whole failure.
 *
 * Structural because these are hooks: nothing in this directory with React in it is reachable by
 * the unit suite, and what went wrong was never a function returning a wrong value. It was a
 * missing subscription.
 */

const here = dirname(fileURLToPath(import.meta.url));
const source = (name: string): string => readFileSync(join(here, name), "utf8");

const SCREENS = [
  ["the mandate screen", "useMandate.ts"],
  ["the wallet", "useArcAccount.ts"],
] as const;

test("both screens read again when the app comes back to the foreground", () => {
  for (const [what, file] of SCREENS) {
    const code = source(file);
    assert.match(code, /AppState\.addEventListener\(\s*"change"/,
      `${what} never learns that the app came back`);
    assert.match(code, /=== "active"|!== "active"/,
      `${what} reacts to every app state rather than to becoming active`);
  }
});

test("and the subscription is given back, so screens do not stack up listeners", () => {
  for (const [what, file] of SCREENS) {
    const code = source(file);
    assert.match(code, /\.remove\(\)/, `${what} leaks its AppState subscription`);
  }
});

/**
 * The wake-up is an addition, not a replacement.
 *
 * An agent spends from outside this app while somebody is looking at the screen, so a figure that
 * only refreshed on foreground would sit still during the very demonstration it exists for.
 */
test("both screens still poll while they are open", () => {
  for (const [what, file] of SCREENS) {
    const code = source(file);
    assert.match(code, /setInterval\(/, `${what} stopped polling`);
    assert.match(code, /clearInterval\(/, `${what} leaks its timer`);
  }
});

/**
 * Ten seconds, stated as a literal in one place.
 *
 * Both screens name their own constant and the comments claim they match deliberately. Two
 * constants that are supposed to be equal, and are only equal by coincidence, drift the first time
 * one of them is tuned — and then the wallet and the allowance on the same screen are read at
 * different moments and can disagree about what has been spent.
 */
test("the two screens poll at the same rate, which their comments both claim", () => {
  const mandate = /POLL_INTERVAL_MS = ([0-9_]+)/.exec(source("useMandate.ts"))?.[1];
  const wallet = /BALANCE_POLL_MS = ([0-9_]+)/.exec(source("useArcAccount.ts"))?.[1];
  assert.ok(mandate !== undefined && wallet !== undefined, "a poll interval is gone");
  assert.equal(mandate, wallet, "the two screens poll at different rates");
  assert.equal(Number(mandate.replaceAll("_", "")), 10_000);
});
