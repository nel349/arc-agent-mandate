import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpRequestError } from "viem";
import { isRateLimited } from "./client.ts";

// The shape Arc's public endpoint returned on 09-10, copied from the phone's log.
const refused = () => new HttpRequestError({
  url: "https://rpc.testnet.arc.network/",
  status: 429,
  details: "{\"code\":-32005,\"message\":\"rate limit exceeded\"}",
});

test("Arc's refusal is recognised as a rate limit", () => {
  assert.equal(isRateLimited(refused()), true);
});

test("it is recognised under our own wrappers too", () => {
  const wrapped = new Error("reading the allowances failed", { cause: new Error("outer", { cause: refused() }) });
  assert.equal(isRateLimited(wrapped), true);
});

test("a JSON-RPC limit error without the HTTP status is recognised by its code", () => {
  assert.equal(isRateLimited(Object.assign(new Error("limit"), { code: -32005 })), true);
});

test("other failures are not mistaken for one", () => {
  assert.equal(isRateLimited(new HttpRequestError({ url: "x", status: 500 })), false);
  assert.equal(isRateLimited(new Error("fetch failed")), false);
  assert.equal(isRateLimited(null), false);
  assert.equal(isRateLimited("rate limit"), false);
});
