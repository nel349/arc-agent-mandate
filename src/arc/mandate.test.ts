import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { decodeAbiParameters, parseAbiParameters } from "viem";
import { SESSION_KEY_PLUGIN, SESSION_KEY_PLUGIN_MANIFEST_HASH } from "./mandate.ts";

/**
 * These two constants are the SDK's only hard links to the deployed contract. If either drifts,
 * `installPlugin` fails on-chain with a hash mismatch or the calls go to the wrong address — so
 * they are checked against the compiled contract rather than trusted.
 */
const forge = (args: string[]) =>
  execFileSync("forge", args, {
    cwd: new URL("../../contracts", import.meta.url).pathname,
    env: { ...process.env, FOUNDRY_DISABLE_NIGHTLY_WARNING: "1" },
    encoding: "utf8",
  });

test("the manifest hash matches the compiled plugin", () => {
  const out = forge(["script", "script/DeploySessionKeyPlugin.s.sol", "--sig", "manifestHash()"]);
  const hash = out.match(/0x[0-9a-f]{64}/)?.[0];
  assert.equal(
    hash,
    SESSION_KEY_PLUGIN_MANIFEST_HASH,
    "installPlugin verifies this hash; a stale constant fails on-chain, not here",
  );
});

test("the plugin address matches where CREATE2 will put it", () => {
  const out = forge(["script", "script/DeploySessionKeyPlugin.s.sol"]);
  const predicted = out.match(/predicted address:\s*(0x[0-9a-fA-F]{40})/)?.[1];
  assert.equal(predicted?.toLowerCase(), SESSION_KEY_PLUGIN.toLowerCase());
});

test("install data round-trips through the ABI encoding the plugin expects", async () => {
  // `onInstall` decodes (address[], bytes32[], bytes[][]). Getting this shape wrong is not a
  // type error anywhere — it surfaces as a revert during install.
  const { encodeAbiParameters } = await import("viem");
  const keys = ["0x1111111111111111111111111111111111111111"] as const;
  const tags = ["0x" + "ab".repeat(32)] as const;
  const updates = [["0xdeadbeef"]] as const;

  const encoded = encodeAbiParameters(parseAbiParameters("address[], bytes32[], bytes[][]"),
    [keys as never, tags as never, updates as never]);
  const [gotKeys, gotTags, gotUpdates] =
    decodeAbiParameters(parseAbiParameters("address[], bytes32[], bytes[][]"), encoded);

  assert.deepEqual(gotKeys, keys);
  assert.deepEqual(gotTags, tags);
  assert.deepEqual(gotUpdates, updates);
});
