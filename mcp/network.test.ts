import { test } from "node:test";
import assert from "node:assert/strict";
import { ARC_TESTNET, MONAD_TESTNET } from "@kuiralabs/mandate-core";
import { networkNamed, NETWORK_SETTING, walletFor } from "./network.ts";

test("with nothing set the connector is on Arc, as every install before this setting was", () => {
  assert.equal(networkNamed(undefined), ARC_TESTNET);
  assert.equal(networkNamed(""), ARC_TESTNET);
  assert.equal(networkNamed("  "), ARC_TESTNET);
});

test("each network is named the way Circle names it", () => {
  assert.equal(networkNamed("arcTestnet"), ARC_TESTNET);
  assert.equal(networkNamed("monadTestnet"), MONAD_TESTNET);
  assert.equal(networkNamed(" monadTestnet "), MONAD_TESTNET);
});

test("a network it does not know is refused, naming the setting and the ones it does", () => {
  assert.throws(() => networkNamed("monad"), (error: unknown) =>
    error instanceof Error && error.message.includes(NETWORK_SETTING) && error.message.includes("arcTestnet and monadTestnet"));
});

test("a person is sent to the wallet that runs on their agent's network", () => {
  // the published wallet runs on Arc; on Monad it was where people were sent and could not grant from
  assert.equal(walletFor(ARC_TESTNET), "https://kuiralabs.github.io/mandate/");
  assert.equal(walletFor(MONAD_TESTNET), "https://kuiralabs.github.io/mandate-next/");
});
