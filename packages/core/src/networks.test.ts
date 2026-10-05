import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress, isAddress } from "viem";
import { ARC_TESTNET, MONAD_TESTNET, NETWORKS, networkByChainId } from "./networks.ts";

/**
 * The profiles are data every program trusts, so what they hold is checked here rather than found out
 * by a payment that goes to a typo. Whether each address has code on its chain is checked against the
 * live chains by the integration suite, not here, where nothing reaches a network.
 */

const addressesOf = (value: unknown): string[] =>
  typeof value === "string" ? [value] : typeof value === "object" && value !== null ? Object.values(value).flatMap(addressesOf) : [];

test("every contract in every profile is a checksummed address", () => {
  for (const network of NETWORKS) {
    for (const address of addressesOf(network.contracts)) {
      assert.ok(isAddress(address), `${network.name}: ${address} is not an address`);
      assert.equal(address, getAddress(address), `${network.name}: ${address} is not checksummed`);
    }
  }
});

test("each network is found by its chain id, and no two share one", () => {
  assert.equal(networkByChainId(5042002), ARC_TESTNET);
  assert.equal(networkByChainId(10143), MONAD_TESTNET);
  assert.equal(networkByChainId(1), undefined);
  assert.equal(new Set(NETWORKS.map((network) => network.chainId)).size, NETWORKS.length);
});

test("Arc meters USDC through its ERC-20 view, and Monad meters MON natively, with no view to name", () => {
  assert.equal(ARC_TESTNET.meter, "erc20View");
  assert.ok(ARC_TESTNET.contracts.erc20View);
  assert.equal(MONAD_TESTNET.meter, "native");
  assert.equal(MONAD_TESTNET.contracts.erc20View, undefined);
  assert.equal(MONAD_TESTNET.coin.symbol, "MON");
});

test("the plugin and the EntryPoint are one address on every network, as the deterministic deploy places them", () => {
  assert.equal(new Set(NETWORKS.map((network) => network.contracts.sessionKeyPlugin)).size, 1);
  assert.equal(new Set(NETWORKS.map((network) => network.contracts.entryPoint)).size, 1);
});

/** the most log queries looking back may take, when it is not known when the code was shown */
const MOST_QUERIES_LOOKING_BACK = 40n;

test("looking back for a grant costs a few whole windows on every network, never a walk through its history", () => {
  for (const network of NETWORKS) {
    assert.equal(network.logs.recent % network.logs.window, 0n, `${network.name}: the look-back is not whole windows`);
    assert.ok(network.logs.recent / network.logs.window <= MOST_QUERIES_LOOKING_BACK, `${network.name}: looking back takes too many queries`);
  }
  // Monad's public node refuses a query spanning more than 100 blocks, as it answered on 3 Oct
  assert.ok(MONAD_TESTNET.logs.window <= 100n);
});

test("the wallet's feed reads a bounded number of windows at a time, and falls back no further than it reads", () => {
  for (const network of NETWORKS) {
    const { span, mostBehind } = network.logs.feed;
    assert.ok((span + network.logs.window - 1n) / network.logs.window <= MOST_QUERIES_LOOKING_BACK, `${network.name}: one read of the feed takes too many queries`);
    assert.ok(mostBehind === null || mostBehind >= span, `${network.name}: it would start again sooner than one read reaches`);
    assert.ok(network.logs.floor > 0n, `${network.name}: no block the plugin arrived in`);
  }
});
