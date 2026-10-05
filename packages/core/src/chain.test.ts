import { test } from "node:test";
import assert from "node:assert/strict";
import { chainOf } from "./chain.ts";
import { ARC_TESTNET, MONAD_TESTNET } from "./networks.ts";

test("a network's chain carries its id, coin, node and explorer, as its profile says them", () => {
  const monad = chainOf(MONAD_TESTNET);
  assert.equal(monad.id, 10143);
  assert.deepEqual(monad.nativeCurrency, { name: "MON", symbol: "MON", decimals: 18 });
  assert.deepEqual(monad.rpcUrls.default.http, ["https://testnet-rpc.monad.xyz"]);
  assert.equal(monad.blockExplorers?.default.url, "https://testnet.monadexplorer.com");
  assert.equal(chainOf(ARC_TESTNET).id, 5042002);
});
