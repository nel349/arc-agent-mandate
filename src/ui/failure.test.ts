import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpRequestError } from "viem";
import {
  ALREADY_GRANTED, ARC_BUSY, describeFailure, isCancellation, MANDATE_FAILURES, walletFailure,
} from "./failure.ts";

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

test("a refusal for asking too often says Arc is busy, not that something broke", () => {
  const refused = new HttpRequestError({
    url: "https://rpc.testnet.arc.network/",
    status: 429,
    details: "{\"code\":-32005,\"message\":\"rate limit exceeded\"}",
  });
  assert.equal(describeFailure(new Error("reading the allowances failed", { cause: refused }), MANDATE_FAILURES), ARC_BUSY);
});

/**
 * The launch after a reinstall asks iOS for a passkey only if one is already on the phone. When
 * there is none, iOS ends the request with the same code as a person closing the sheet, and the
 * app must stay quiet for both. It must not stay quiet about anything else: a person who chose their
 * passkey and was then let down by the network needs to be told.
 */
test("a dismissed or empty passkey request is a cancellation, however deeply it is wrapped", () => {
  assert.equal(isCancellation(IOS_DISMISSED), true);
  assert.equal(isCancellation(new Error("signing in failed", { cause: IOS_DISMISSED })), true);
  assert.equal(
    isCancellation(new Error("outer", { cause: new Error("middle", { cause: IOS_DISMISSED }) })),
    true,
    "a cancellation two links down was missed",
  );
});

/**
 * Granting an agent that already has an allowance from this wallet is refused by the plugin with
 * `InvalidSessionKey(address)`, which reached the screen as a revert and a hex selector. The selector
 * is `cast sig "InvalidSessionKey(address)"`, followed by the agent's address.
 */
test("the plugin refusing a second grant to one agent says what to do, not the revert", () => {
  const refused = Object.assign(new Error("execution reverted"), {
    details: "UserOperation reverted during simulation with reason: 0xd3d0f659" +
      "0000000000000000000000003535816e967ad2b6271dfadf9138fb07eab161ce",
  });
  assert.equal(
    describeFailure(new Error("granting 5.000000 USDC to 0x3535… failed", { cause: refused }), MANDATE_FAILURES),
    ALREADY_GRANTED,
  );
});

/**
 * The welcome screen showed "Cancelled. Nothing changed." under "Create a wallet" after the person
 * closed the passkey sheet themselves: the launch path stayed quiet, and the buttons' path did not.
 */
test("the wallet screens say nothing when the passkey sheet is closed, and still say a real failure", () => {
  assert.equal(walletFailure(new Error("signing in failed", { cause: IOS_DISMISSED })), null);
  assert.equal(
    walletFailure(new Error("creating a wallet failed", {
      cause: new Error("NotAllowedError: The operation either timed out or was not allowed"),
    })),
    null,
  );

  const failed = new Error(
    "Failed to request credential. (com.apple.AuthenticationServices.AuthorizationError error 1004.)",
  );
  assert.equal(
    walletFailure(new Error("signing in failed", { cause: failed })),
    "Error: Failed to request credential. (com.apple.AuthenticationServices.AuthorizationError error 1004.)",
  );
  assert.equal(
    walletFailure(new Error("creating a wallet failed", {
      cause: new Error("The RP ID is not associated with domain arc.example"),
    })),
    "This app is not associated with the passkey domain yet.",
  );
});

test("a real failure after the passkey is not taken for a cancellation", () => {
  const failed = new Error(
    "Failed to request credential. (com.apple.AuthenticationServices.AuthorizationError error 1004.)",
  );
  assert.equal(isCancellation(new Error("signing in failed", { cause: failed })), false);
  const network = new HttpRequestError({ url: "https://modular-sdk.circle.com/v1/rpc/w3s/buidl", status: 502 });
  assert.equal(isCancellation(new Error("signing in failed", { cause: network })), false);
  assert.equal(isCancellation("a string, not an error"), false);
});
