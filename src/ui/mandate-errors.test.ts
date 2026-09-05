import { test } from "node:test";
import assert from "node:assert/strict";
import { describeMandateFailure } from "./mandate-errors.ts";

/**
 * The SDK wraps a failure and puts the reason in `cause`. Matching only the outer message meant
 * every friendly mapping below was tested against `granting 20.000000 USDC to 0x… failed` and
 * none of them could ever match — a paymaster refusal, a revert and a network drop all reached
 * the screen as the same sentence, with the real reason one link down and never read.
 */
const wrap = (inner: Error) =>
  new Error("granting 20.000000 USDC to 0xB8A5 failed", { cause: inner });

test("a reason inside the cause chain is recognised, not just the outer wrapper", () => {
  assert.match(
    describeMandateFailure(wrap(new Error("The contract function returned no data (\"0x\")"))),
    /not deployed/i,
  );
  assert.match(
    describeMandateFailure(wrap(new Error("user rejected the request"))),
    /cancelled/i,
  );
  assert.match(
    describeMandateFailure(wrap(new Error("AA23 reverted PermissionsCheckFailed"))),
    /refused/i,
  );
});

test("an unrecognised failure reports the innermost message, not our own wrapper", () => {
  const text = describeMandateFailure(wrap(new Error("paymaster did not accept the operation")));
  assert.match(text, /paymaster did not accept/);
  assert.doesNotMatch(text, /granting 20/, "the wrapper was reported instead of the reason");
});

test("a chain several links deep still reaches the bottom", () => {
  const deep = wrap(new Error("bundler rejected", { cause: new Error("AA33 paymaster reverted") }));
  assert.match(describeMandateFailure(deep), /refused|AA33/i);
});

test("a cause cycle terminates rather than hanging the screen", () => {
  const a = new Error("outer");
  const b = new Error("inner", { cause: a });
  (a as { cause?: unknown }).cause = b;
  assert.ok(describeMandateFailure(a).length > 0);
});

/**
 * The field that identifies a revert is not the message.
 *
 * Circle's bundler answers a failed operation with `execution reverted` and puts the four-byte
 * error selector in `data.revertData`. Logging the message alone showed nothing usable, which is
 * exactly how a RuntimeValidationFailed survived a round trip disguised as "granting failed".
 */
test("a bundler revert surfaces its revertData, not just 'execution reverted'", () => {
  const rpc = Object.assign(new Error("execution reverted"), {
    code: -32521,
    data: { revertData: "0x6d4fdb090000000000000000000000000000000c984aff541d6ce86bb697e68ec57873c8" },
  });
  const text = describeMandateFailure(new Error("granting 20.000000 USDC failed", { cause: rpc }));
  assert.match(text, /0x6d4fdb09/, "the revert selector was dropped, leaving nothing to identify it by");
});

/**
 * viem hides the useful part in `details` too. Here the AA23 code lives only there, and it is what
 * lets the screen say "the account refused this" instead of quoting a sentence of library prose.
 */
test("viem's details reach the matcher, not only the message", () => {
  const viemish = Object.assign(new Error("long viem prose"), {
    shortMessage: "UserOperation reverted during simulation",
    details: "AA23 reverted",
  });
  const text = describeMandateFailure(new Error("wrapper", { cause: viemish }));
  assert.match(text, /account refused/i, "AA23 sat in `details` and was never read");
  assert.doesNotMatch(text, /long viem prose/, "library prose reached the screen");
});
