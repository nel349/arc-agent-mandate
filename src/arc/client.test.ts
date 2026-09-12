import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpRequestError } from "viem";
import { isRangeRefusal, isRateLimited } from "./client.ts";

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

/**
 * The shape a provider's free plan returned on 09-11, copied from the phone's log with the key taken
 * out of the URL. It took out the payments feed, the pairing search and the badges at once, while
 * every other read on the same endpoint kept working — the sentence that says so is in `details`,
 * not in the message.
 */
const rangeRefused = () => new HttpRequestError({
  url: "https://arc-testnet.example.com/v2/<key>",
  status: 400,
  details: "{\"code\":-32600,\"message\":\"Under the Free tier plan, you can make eth_getLogs requests "
    + "with up to a 10 block range. Based on your parameters, this block range should work: "
    + "[0x3aab3f5, 0x3aab3fe]. Upgrade to PAYG for expanded block range.\"}",
});

test("a plan that will not serve a window that wide is recognised", () => {
  assert.equal(isRangeRefusal(rangeRefused()), true);
});

test("and under our own wrappers, which is how the feed's reads arrive", () => {
  assert.equal(isRangeRefusal(new Error("reading the feed failed", { cause: rangeRefused() })), true);
});

test("a provider that caps results rather than blocks is recognised too", () => {
  assert.equal(isRangeRefusal(new Error("query returned more than 10000 results")), true);
});

/**
 * The two refusals are answered in opposite ways, so telling them apart is the whole point.
 */
test("neither refusal is ever read as the other", () => {
  // A rate limit is waited out. Read as a range refusal, it would move history to the shared
  // endpoint permanently, on an endpoint that was merely busy for a second.
  assert.equal(isRangeRefusal(refused()), false);
  // A range refusal is permanent for that endpoint. Read as a rate limit, it would retry the same
  // rejected query, a little later each time, for ever.
  assert.equal(isRateLimited(rangeRefused()), false);
});

test("ordinary failures are not read as a range refusal", () => {
  assert.equal(isRangeRefusal(new HttpRequestError({ url: "x", status: 500 })), false);
  assert.equal(isRangeRefusal(new Error("fetch failed")), false);
  assert.equal(isRangeRefusal(null), false);
});
