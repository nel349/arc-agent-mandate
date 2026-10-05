import { test } from "node:test";
import assert from "node:assert/strict";
import { ARC_TESTNET, MONAD_TESTNET } from "./networks.ts";
import { stepsOn } from "./steps.ts";

/** The frame every program shows, so a page, the wallet and the connector cannot tell a person different paths. */

test("five steps, in one order, alternating the phone and the laptop as a person actually moves", () => {
  const steps = stepsOn(ARC_TESTNET);
  assert.deepEqual(steps.map((step) => step.id), ["wallet", "connect", "grant", "task", "watch"]);
  assert.deepEqual(steps.map((step) => step.where), ["phone", "laptop", "phone", "laptop", "phone"]);
});

test("on Arc the steps read as the connector and the maze have always said them", () => {
  assert.deepEqual(stepsOn(ARC_TESTNET).map((step) => step.title), [
    "Get the app, and add test USDC",
    "Connect your agent",
    "Scan to grant",
    "Tell your agent to play",
    "Watch it spend, revoke any time",
  ]);
});

test("on Monad the money is MON, and only the step about money says so", () => {
  const arc = stepsOn(ARC_TESTNET);
  const monad = stepsOn(MONAD_TESTNET);
  assert.equal(monad[0]?.title, "Get the app, and add test MON");
  assert.deepEqual(monad.slice(1), arc.slice(1));
});
