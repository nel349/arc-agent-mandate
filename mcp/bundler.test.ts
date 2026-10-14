import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { bundlerConfigured, missingBundlerConfig, usesSharedTestnetKey } from "./bundler.ts";

/**
 * Which Circle values the connector pays with.
 *
 * A stranger on testnet sets nothing and can pay, through the key the wallet's web build already
 * publishes. Anyone who sets values of their own gets only theirs, and a mix is never assembled:
 * a key sent with another key's domain is refused as "Invalid credentials", naming neither.
 */

const NAMES = [
  "CIRCLE_CLIENT_URL", "CIRCLE_CLIENT_KEY", "CIRCLE_PASSKEY_DOMAIN",
  "EXPO_PUBLIC_CIRCLE_CLIENT_URL", "EXPO_PUBLIC_CIRCLE_CLIENT_KEY", "EXPO_PUBLIC_CIRCLE_PASSKEY_DOMAIN",
  "ARC_CIRCLE_CHAIN_PATH",
] as const;

let saved: Partial<Record<(typeof NAMES)[number], string>> = {};

beforeEach(() => {
  saved = {};
  for (const name of NAMES) {
    if (process.env[name] !== undefined) saved[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of NAMES) {
    delete process.env[name];
    if (saved[name] !== undefined) process.env[name] = saved[name];
  }
});

test("with nothing set, testnet pays through the shared key", () => {
  assert.equal(usesSharedTestnetKey(), true);
  assert.equal(bundlerConfigured(), true);
  assert.deepEqual(missingBundlerConfig(), []);
});

test("all three of your own are used instead of the shared ones", () => {
  process.env.CIRCLE_CLIENT_URL = "https://modular-sdk.circle.com/v1/rpc/w3s/buidl";
  process.env.CIRCLE_CLIENT_KEY = "TEST_CLIENT_KEY:yours";
  process.env.CIRCLE_PASSKEY_DOMAIN = "yours.example";
  assert.equal(usesSharedTestnetKey(), false);
  assert.equal(bundlerConfigured(), true);
});

test("one of your own and the shared ones do not fill the gaps; what is missing is named", () => {
  process.env.CIRCLE_CLIENT_KEY = "TEST_CLIENT_KEY:yours";
  assert.equal(usesSharedTestnetKey(), false);
  assert.equal(bundlerConfigured(), false);
  assert.deepEqual(missingBundlerConfig(), ["CIRCLE_CLIENT_URL", "CIRCLE_PASSKEY_DOMAIN"]);
});

test("the app's own values count as yours, as they always did", () => {
  process.env.EXPO_PUBLIC_CIRCLE_PASSKEY_DOMAIN = "yours.example";
  assert.equal(usesSharedTestnetKey(), false);
  assert.deepEqual(missingBundlerConfig(), ["CIRCLE_CLIENT_URL", "CIRCLE_CLIENT_KEY"]);
});

/**
 * The test key is never offered on mainnet, where Circle refuses it. Since 14 October Arc mainnet has
 * a shared key of its own, a LIVE one whose gas policy carries a daily cap, so an owner's agent pays
 * there with nothing set too.
 */
test("on Arc mainnet the shared LIVE key is used, never the test one", () => {
  process.env.ARC_CIRCLE_CHAIN_PATH = "arc";
  assert.equal(usesSharedTestnetKey(), false);
  assert.equal(bundlerConfigured(), true);
  assert.deepEqual(missingBundlerConfig(), []);
});

test("off any network a shared key serves, every value is asked for", () => {
  process.env.ARC_CIRCLE_CHAIN_PATH = "somewhereElse";
  assert.equal(usesSharedTestnetKey(), false);
  assert.equal(bundlerConfigured(), false);
  assert.deepEqual(missingBundlerConfig(), ["CIRCLE_CLIENT_URL", "CIRCLE_CLIENT_KEY", "CIRCLE_PASSKEY_DOMAIN"]);
});
