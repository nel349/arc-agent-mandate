import { test } from "node:test";
import assert from "node:assert/strict";
import { ARC_MAINNET, ARC_TESTNET, MONAD_TESTNET } from "@kuiralabs/mandate-core";
import { anotherAddressOn, choiceOf, networkAsked, networkOfChoice, reopenOrder } from "./network-choice.ts";

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

test("a real-money wallet is reopened where it was chosen, never on a testnet its passkey cannot open", () => {
  assert.deepEqual(reopenOrder(ARC_MAINNET), [ARC_MAINNET]);
});

test("a phone that chose mainnet reads it back as mainnet", () => {
  assert.equal(networkOfChoice(choiceOf(ARC_MAINNET)), ARC_MAINNET);
});

test("a network that would open another address is named, and the person told their wallet stayed", () => {
  assert.match(anotherAddressOn(MONAD_TESTNET), /different address on Monad Testnet/i);
  assert.match(anotherAddressOn(MONAD_TESTNET), /stayed where it was/);
  assert.doesNotMatch(anotherAddressOn(MONAD_TESTNET), /—/, "no em dash in what a person reads");
});

test("a link that names a network opens the wallet on it, and one that names none or an unknown one does not", () => {
  assert.equal(networkAsked("?network=arc"), ARC_MAINNET);
  assert.equal(networkAsked("?return=x&network=arcTestnet"), ARC_TESTNET);
  assert.equal(networkAsked("?network=monadTestnet"), MONAD_TESTNET);
  assert.equal(networkAsked(""), null);
  assert.equal(networkAsked("?network=somewhere"), null);
});
