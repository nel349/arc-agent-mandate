import { test } from "node:test";
import assert from "node:assert/strict";
import { ARC_TESTNET, MONAD_TESTNET } from "@kuiralabs/mandate-core";
import { briefingSteps } from "./briefing.ts";

const WALLET = "https://kuiralabs.github.io/mandate/";

test("on Arc the agent is briefed in exactly the words it was given before the steps moved to the core", () => {
  assert.deepEqual(briefingSteps(ARC_TESTNET, WALLET), [
    `1. Get the app, and add test USDC (their phone). It opens in the phone's browser at ${WALLET}, with nothing to install, and makes a wallet with a passkey.`,
    "2. Connect your agent (their laptop). You are connected, so this one is done.",
    "3. Scan to grant (their phone): New allowance, then Scan the agent's code.",
    "4. Tell your agent to play (their laptop): they give you the task.",
    "5. Watch it spend, revoke any time (their phone).",
  ]);
});

test("on Monad the agent is told its user adds test MON, and nothing else about the path changes", () => {
  const arc = briefingSteps(ARC_TESTNET, WALLET);
  const monad = briefingSteps(MONAD_TESTNET, WALLET);
  assert.match(monad[0] ?? "", /^1\. Get the app, and add test MON \(their phone\)/);
  assert.deepEqual(monad.slice(1), arc.slice(1));
});
