import { test } from "node:test";
import assert from "node:assert/strict";
import { circleEndpoint, circleHeaders, CIRCLE_SHARED_TESTNET, sharedKeyServes } from "./circle.ts";
import { ARC_TESTNET, MONAD_TESTNET, type NetworkProfile } from "./networks.ts";

/**
 * Circle refuses a request whose endpoint names another network or whose headers leave out the key's
 * domain, and says only "Invalid credentials". So the shapes are pinned here, to the ones that reached a
 * live bundler on Arc and on Monad.
 */

test("one endpoint per network: the client URL, then the network's own path, with no doubled slash", () => {
  assert.equal(circleEndpoint(ARC_TESTNET, "https://modular-sdk.circle.com/v1/rpc/w3s/buidl"), "https://modular-sdk.circle.com/v1/rpc/w3s/buidl/arcTestnet");
  assert.equal(circleEndpoint(MONAD_TESTNET, "https://modular-sdk.circle.com/v1/rpc/w3s/buidl/"), "https://modular-sdk.circle.com/v1/rpc/w3s/buidl/monadTestnet");
  assert.equal(circleEndpoint(MONAD_TESTNET, "https://example.test//"), "https://example.test/monadTestnet");
});

test("the key goes as a bearer token, and its domain in X-AppInfo, without which Circle refuses it", () => {
  const headers = circleHeaders({ clientKey: "TEST_CLIENT_KEY:a:b", passkeyDomain: "wallet.example" });
  assert.equal(headers.Authorization, "Bearer TEST_CLIENT_KEY:a:b");
  assert.equal(headers["X-AppInfo"], "platform=web;version=1.0.0;uri=wallet.example");
});

test("the shared testnet key serves Arc and Monad, the two networks its sponsorship was proven on, and nothing else", () => {
  assert.equal(sharedKeyServes(ARC_TESTNET), true);
  assert.equal(sharedKeyServes(MONAD_TESTNET), true);
  const elsewhere: NetworkProfile = { ...MONAD_TESTNET, circlePath: "baseSepolia", chainId: 84532 };
  assert.equal(sharedKeyServes(elsewhere), false);
});

test("the shared key is a test key, which Circle refuses on mainnet, bound to the published wallet's domain", () => {
  assert.match(CIRCLE_SHARED_TESTNET.clientKey, /^TEST_CLIENT_KEY:/);
  assert.equal(CIRCLE_SHARED_TESTNET.passkeyDomain, "kuiralabs.github.io");
});
