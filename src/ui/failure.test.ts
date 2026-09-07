import { test } from "node:test";
import assert from "node:assert/strict";
import { describeFailure, MANDATE_FAILURES } from "./failure.ts";

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
    describeFailure(wrap(new Error("The contract function returned no data (\"0x\")")), MANDATE_FAILURES),
    /not deployed/i,
  );
  assert.match(
    describeFailure(wrap(new Error("user rejected the request"))),
    /cancelled/i,
  );
  assert.match(
    describeFailure(wrap(new Error("AA23 reverted PermissionsCheckFailed")), MANDATE_FAILURES),
    /refused/i,
  );
});

test("an unrecognised failure reports the innermost message, not our own wrapper", () => {
  const text = describeFailure(wrap(new Error("paymaster did not accept the operation")));
  assert.match(text, /paymaster did not accept/);
  assert.doesNotMatch(text, /granting 20/, "the wrapper was reported instead of the reason");
});

test("a chain several links deep still reaches the bottom", () => {
  const deep = wrap(new Error("bundler rejected", { cause: new Error("AA33 paymaster reverted") }));
  assert.match(describeFailure(deep, MANDATE_FAILURES), /refused|AA33/i);
});

test("a cause cycle terminates rather than hanging the screen", () => {
  const a = new Error("outer");
  const b = new Error("inner", { cause: a });
  (a as { cause?: unknown }).cause = b;
  assert.ok(describeFailure(a).length > 0);
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
  const text = describeFailure(new Error("granting 20.000000 USDC failed", { cause: rpc }));
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
  const text = describeFailure(new Error("wrapper", { cause: viemish }), MANDATE_FAILURES);
  assert.match(text, /account refused/i, "AA23 sat in `details` and was never read");
  assert.doesNotMatch(text, /long viem prose/, "library prose reached the screen");
});

/**
 * The two other places viem hides the identifying mark: a numeric `code`, and a `shortMessage`
 * that says something the long `message` does not. A rule that can only read `message` matches
 * neither, and the screen falls back to quoting library prose.
 */
test("a failure identified only by its code, or only by its shortMessage, is still matched", () => {
  const byCode = Object.assign(new Error("execution reverted"), { code: -32521 });
  assert.match(
    describeFailure(byCode, [[/code=-32521/, "The node refused the operation."]]),
    /node refused/,
    "a numeric code never reached the matcher",
  );

  const byShortMessage = Object.assign(new Error("long viem prose"), {
    shortMessage: "The contract function \"getInstalledPlugins\" returned no data",
  });
  assert.match(
    describeFailure(byShortMessage, MANDATE_FAILURES),
    /not deployed on this network/,
    "shortMessage never reached the matcher",
  );
});

/**
 * The exact error a dismissed passkey prompt produces on iOS, from a real device log. None of
 * "cancelled", "rejected" or NotAllowedError appears in it, which is why the original check could
 * never match and a person who simply changed their mind was shown library prose about a failed
 * credential request.
 */
const IOS_DISMISSED = new Error(
  "Failed to request credential.\n\nDetails: The operation couldn’t be completed. " +
  "(com.apple.AuthenticationServices.AuthorizationError error 1001.)",
);
IOS_DISMISSED.name = "WebAuthnP256.CredentialRequestFailedError";

test("dismissing the passkey prompt reads as cancelled, not as a failure", () => {
  const text = describeFailure(
    new Error("revoking the mandate for 0xB8A5 failed", { cause: IOS_DISMISSED }),
  );
  assert.match(text, /cancelled/i);
  assert.doesNotMatch(text, /credential|AuthorizationError/i, "library prose reached the screen");
});

test("a genuine authorisation failure is not swept in with cancellation", () => {
  const failed = new Error(
    "Failed to request credential. (com.apple.AuthenticationServices.AuthorizationError error 1004.)",
  );
  const text = describeFailure(new Error("wrapper", { cause: failed }));
  assert.doesNotMatch(text, /cancelled/i, "a real failure was reported as a cancellation");
});

test("the web and Android shapes of cancellation are recognised too", () => {
  for (const message of ["NotAllowedError: The operation either timed out or was not allowed", "AbortError: signal is aborted"]) {
    assert.match(
      describeFailure(new Error("wrapper", { cause: new Error(message) })),
      /cancelled/i,
      `${message} was not recognised`,
    );
  }
});
