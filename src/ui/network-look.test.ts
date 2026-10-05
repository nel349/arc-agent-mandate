import { test } from "node:test";
import assert from "node:assert/strict";
import { ARC_TESTNET, MONAD_TESTNET, type NetworkProfile } from "@kuiralabs/mandate-core";
import { accentOf } from "./network-look.ts";

test("each network brings its own colour, and no two share one", () => {
  assert.equal(accentOf(MONAD_TESTNET), "#836EF9");
  assert.notEqual(accentOf(MONAD_TESTNET), accentOf(ARC_TESTNET));
});

test("a network with no colour yet gets a neutral one, never another network's", () => {
  const unknown: NetworkProfile = { ...MONAD_TESTNET, chainId: 999_999, circlePath: "someTestnet", name: "Some testnet" };
  assert.notEqual(accentOf(unknown), accentOf(MONAD_TESTNET));
  assert.notEqual(accentOf(unknown), accentOf(ARC_TESTNET));
});
