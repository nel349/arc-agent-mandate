import { test } from "node:test";
import assert from "node:assert/strict";
import { applyStoredEndpoint, chooseEndpoint, describeEndpoint, endpointHost } from "./endpoint-setting.ts";
import { arcRpcUrl, BUILT_IN_ARC_RPC, usingOwnEndpoint } from "../arc/endpoint.ts";

/**
 * An endpoint somebody pasted, and the two things that must never happen to it: that it silently
 * stops being used, and that it is shown in full to a room.
 */

const MINE = "https://arc-testnet.example.com/v2/secret-key-here";

test("what is shown names the endpoint without giving away the key in it", () => {
  assert.equal(endpointHost(MINE), "arc-testnet.example.com");
  assert.doesNotMatch(describeEndpoint(MINE), /secret-key-here/);
  assert.match(describeEndpoint(MINE), /arc-testnet\.example\.com/);
  // Nothing configured is a state worth describing too, and it is not a warning.
  assert.match(describeEndpoint(null), /came with/);
});

test("a kept endpoint is used, and giving it up goes back to the built-in one", async () => {
  await chooseEndpoint(MINE);
  assert.equal(arcRpcUrl(), MINE);
  assert.equal(usingOwnEndpoint(), true);

  assert.equal(await applyStoredEndpoint(), MINE, "a relaunch has to find what was kept");
  assert.equal(arcRpcUrl(), MINE);

  await chooseEndpoint(null);
  assert.equal(arcRpcUrl(), BUILT_IN_ARC_RPC);
  assert.equal(await applyStoredEndpoint(), null);
  assert.equal(usingOwnEndpoint(), false);
});

test("a stored value that no longer passes is not the endpoint an account is read through", async () => {
  await chooseEndpoint(MINE);
  // Written straight past `chooseEndpoint`, as an older build or a hand-edited store would have.
  const { writePreference } = await import("./preference-store.ts");
  await writePreference("arc.endpoint", "http://plain.example/rpc");

  assert.equal(await applyStoredEndpoint(), null, "http is refused on the way out, not only on entry");
  assert.equal(arcRpcUrl(), BUILT_IN_ARC_RPC);
});
