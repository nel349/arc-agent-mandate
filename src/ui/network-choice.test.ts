import { test } from "node:test";
import assert from "node:assert/strict";
import { ARC_TESTNET, MONAD_TESTNET } from "@kuiralabs/mandate-core";
import { anotherAddressOn, choiceOf, networkOfChoice, reopenOrder, shortNameOf } from "./network-choice.ts";

test("a phone that never chose shows Arc, as every wallet before networks did", () => {
  assert.equal(networkOfChoice(null), ARC_TESTNET);
  assert.equal(networkOfChoice(""), ARC_TESTNET);
});

test("a choice is remembered by the network's name, and read back as that network", () => {
  assert.equal(networkOfChoice(choiceOf(MONAD_TESTNET)), MONAD_TESTNET);
  assert.equal(networkOfChoice(choiceOf(ARC_TESTNET)), ARC_TESTNET);
});

test("a choice this build no longer knows falls back to Arc rather than to nothing", () => {
  assert.equal(networkOfChoice("someRetiredTestnet"), ARC_TESTNET);
});

test("the remembered wallet is tried on the chosen network first, and on Arc before it is given up", () => {
  assert.deepEqual(reopenOrder(MONAD_TESTNET), [MONAD_TESTNET, ARC_TESTNET]);
  assert.deepEqual(reopenOrder(ARC_TESTNET), [ARC_TESTNET], "Arc is tried once, not twice");
});

test("a network that would open another address is named, and the person told their wallet stayed", () => {
  assert.match(anotherAddressOn(MONAD_TESTNET), /different address on Monad Testnet/i);
  assert.match(anotherAddressOn(MONAD_TESTNET), /stayed where it was/);
  assert.doesNotMatch(anotherAddressOn(MONAD_TESTNET), /—/, "no em dash in what a person reads");
});

test("a network goes by the part of its name that tells it apart", () => {
  assert.equal(shortNameOf(ARC_TESTNET), "Arc");
  assert.equal(shortNameOf(MONAD_TESTNET), "Monad");
});
