import { test } from "node:test";
import assert from "node:assert/strict";
import { isPluginInstalled, listMandates } from "../src/arc/mandate.ts";
import { readingLive } from "./arc-endpoint.ts";

/**
 * A wallet that has never sent anything must still be able to grant.
 *
 * A Circle smart account is counterfactual: the passkey gives it an address immediately, funds
 * arrive at it, and the contract is only created by its first user operation. Every read against
 * that address returns `0x` until then.
 *
 * That is the state every wallet is in at the moment of its **first** grant, which makes it the
 * least skippable state in the product and the easiest one to never test — the fork suites all
 * start from an account that already exists. `isPluginInstalled` asked such an address for its
 * plugin list, viem raised a decoding error, and the screen reported "the allowance contract is
 * not deployed on this network yet": the plugin was deployed and fine, and the real answer was
 * that the account was new. The first grant was unreachable and the message pointed elsewhere.
 *
 * An address with no code is checked here rather than a mock, because the thing under test is
 * precisely what the chain returns for one.
 */

/** No code at this address, and none coming. Any address without code exercises the same path. */
const NEVER_DEPLOYED = "0x00000000000000000000000000000000deadbeef";

test("an account with no code reports no plugin, rather than raising", async () => {
  assert.equal(
    await readingLive("an undeployed account's plugins", () => isPluginInstalled(NEVER_DEPLOYED)),
    false,
    "reading an undeployed account must answer 'no plugins', not throw — that answer is what " +
    "sends buildGrantCalls down the installPlugin path a first grant needs",
  );
});

test("an account with no code has no mandates, rather than raising", async () => {
  assert.deepEqual(await readingLive("an undeployed account's mandates", () => listMandates(NEVER_DEPLOYED)), []);
});
