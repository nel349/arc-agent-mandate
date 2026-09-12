import { test } from "node:test";
import assert from "node:assert/strict";
import {
  arcRpcUrl, asksForARange, BUILT_IN_ARC_RPC, PUBLIC_ARC_RPC, readEndpoint, useArcRpcUrl, usingOwnEndpoint,
} from "./endpoint.ts";

/**
 * The endpoint Arc is read through: the one a phone was given, the one a build carries, or Arc's own.
 *
 * The rule that matters is that none of the three is required. A fresh clone with no `.env`, a build
 * with one, and a phone that has been handed an endpoint all have to work, which is why the fallback
 * is a chain rather than a setting somebody must fill in.
 */

test("with nothing chosen, reads go to whatever this build carries", () => {
  useArcRpcUrl(null);
  assert.equal(arcRpcUrl(), BUILT_IN_ARC_RPC);
  assert.equal(usingOwnEndpoint(), false);
});

test("there is always an endpoint, whether or not anything was configured", () => {
  useArcRpcUrl(null);
  // The point of the chain: a clone with no `.env` at all still reads Arc. If this ever resolves to
  // undefined or an empty string, the app has no endpoint and every screen fails at once.
  assert.match(arcRpcUrl(), /^https:\/\/.+/);
  assert.match(PUBLIC_ARC_RPC, /^https:\/\/.+/);
  // Nothing configured means Arc's own, which is what a fresh clone and CI both get.
  if (
    process.env["EXPO_PUBLIC_ALCHEMY_ARC_TESTNET"] === undefined
    && process.env["ARC_TESTNET_RPC_URL"] === undefined
  ) {
    assert.equal(BUILT_IN_ARC_RPC, PUBLIC_ARC_RPC);
  }
});

test("an endpoint this phone was given is used until it is taken away", () => {
  useArcRpcUrl("https://arc.example/rpc");
  assert.equal(arcRpcUrl(), "https://arc.example/rpc");
  assert.equal(usingOwnEndpoint(), true);

  useArcRpcUrl(null);
  assert.equal(arcRpcUrl(), BUILT_IN_ARC_RPC, "clearing it must fall back, never leave the app with none");
  assert.equal(usingOwnEndpoint(), false);
});

test("only the reads that span blocks are the ones an endpoint can refuse on size", () => {
  // The one call this app makes that asks for a range, and the reason reads are routed at all.
  assert.equal(asksForARange("eth_getLogs"), true);
  // Everything else is a single point in time and goes wherever the person pointed the app.
  assert.equal(asksForARange("eth_call"), false);
  assert.equal(asksForARange("eth_getBalance"), false);
  assert.equal(asksForARange("eth_blockNumber"), false);
});

test("what a person types is an endpoint, or says exactly what is wrong with it", () => {
  assert.deepEqual(readEndpoint("  https://arc.example/rpc  "), { url: "https://arc.example/rpc" });
  assert.deepEqual(readEndpoint(""), {
    problem: "Paste an endpoint, or leave it empty to use the default.",
  });
  assert.deepEqual(readEndpoint("   "), {
    problem: "Paste an endpoint, or leave it empty to use the default.",
  });
  assert.deepEqual(readEndpoint("not an address"), {
    problem: "That is not a web address. It should start with https://",
  });
  assert.deepEqual(readEndpoint("http://arc.example/rpc"), {
    problem: "The address has to start with https://",
  });
});
