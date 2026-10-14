import { test } from "node:test";
import assert from "node:assert/strict";
import { ARC_MAINNET, ARC_TESTNET } from "@kuiralabs/mandate-core";
import { gatewayApiFor } from "./gateway-balance.ts";

test("an agent's escrow is asked of Circle's service for the money it spends: live for mainnet, testnet for testnet", () => {
  assert.equal(gatewayApiFor(ARC_MAINNET), "https://gateway-api.circle.com");
  assert.equal(gatewayApiFor(ARC_TESTNET), "https://gateway-api-testnet.circle.com");
});

test("each Arc's Gateway contract is the one Circle's own service lists for it", () => {
  // From GET /v1/info on each service, 14 October 2026: one address on live chains, another on test ones.
  assert.equal(ARC_MAINNET.contracts.gatewayWallet, "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE");
  assert.equal(ARC_TESTNET.contracts.gatewayWallet, "0x0077777d7EBA4688BDeF3E311b846F25870A19B9");
});
