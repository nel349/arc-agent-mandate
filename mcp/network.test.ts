import { test } from "node:test";
import assert from "node:assert/strict";
import { ARC_MAINNET, ARC_TESTNET, MONAD_TESTNET } from "@kuiralabs/mandate-core";
import { networkNamed, networkStarted, NETWORK_SETTING, WALLET_URL, walletOn } from "./network.ts";

test("with nothing set the connector is on Arc, as every install before this setting was", () => {
  assert.equal(networkNamed(undefined), ARC_TESTNET);
  assert.equal(networkNamed(""), ARC_TESTNET);
  assert.equal(networkNamed("  "), ARC_TESTNET);
});

test("each network is named the way Circle names it", () => {
  assert.equal(networkNamed("arcTestnet"), ARC_TESTNET);
  assert.equal(networkNamed("monadTestnet"), MONAD_TESTNET);
  assert.equal(networkNamed(" monadTestnet "), MONAD_TESTNET);
  assert.equal(networkNamed("arc"), ARC_MAINNET);
});

test("started with the word mainnet it spends on Arc mainnet, and with nothing on Arc testnet", () => {
  assert.equal(networkStarted(["mainnet"], undefined), ARC_MAINNET);
  assert.equal(networkStarted(["testnet"], undefined), ARC_TESTNET);
  assert.equal(networkStarted([], undefined), ARC_TESTNET);
  // The setting still works, for every install that already uses it.
  assert.equal(networkStarted([], "arc"), ARC_MAINNET);
  assert.equal(networkStarted([], "monadTestnet"), MONAD_TESTNET);
});

test("the wallet is named with the agent's network, so the phone opens on the right money", () => {
  assert.equal(walletOn(ARC_MAINNET), "https://kuiralabs.github.io/mandate/?network=arc");
  assert.equal(walletOn(ARC_TESTNET), "https://kuiralabs.github.io/mandate/?network=arcTestnet");
});

test("a word it does not know is refused, naming the ones it does", () => {
  assert.throws(() => networkStarted(["mainet"], undefined), /mainnet or testnet/);
});

test("a network it does not know is refused, naming the setting and the ones it does", () => {
  assert.throws(() => networkNamed("monad"), (error: unknown) =>
    error instanceof Error && error.message.includes(NETWORK_SETTING) && error.message.includes("arcTestnet, monadTestnet, arc"));
});

test("a person is sent to the one wallet, whatever network their agent is on", () => {
  // There were two addresses while the wallet that runs on Monad was published beside the older one.
  assert.equal(WALLET_URL, "https://kuiralabs.github.io/mandate/");
  assert.equal(WALLET_URL.includes("mandate-next"), false);
});
