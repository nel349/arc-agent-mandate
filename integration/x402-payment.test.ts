import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, parseAbi, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { payableOption, signPayment, type PaymentOption, type SignedPayment } from "../mcp/x402.ts";
import { GATEWAY_WALLET, topUpCalls, USDC_ERC20_VIEW } from "../mcp/gateway.ts";

/**
 * Would Circle actually take the payment we sign?
 *
 * Everything about an x402 payment on Arc is decided off chain. The signature is over Circle's
 * `GatewayWalletBatched` domain rather than the token's, it is verified by Circle's API rather
 * than by a contract, and the settlement contract checks only Circle's own batch signer — so
 * nothing on chain will ever tell us we got the message wrong. A unit test asserting we produced
 * the bytes we meant to produce would agree with itself and prove nothing.
 *
 * So this asks the live facilitator. `/v1/x402/verify` is unauthenticated on testnet and reports
 * `isValid` with a reason, which makes it usable as an oracle: it checks the signature and the
 * validity window and does **not** check funds, so a fresh key with no escrow verifies exactly as
 * a funded one would. Nothing here spends anything, and no key in this file has ever held money.
 *
 * The control matters as much as the assertion. A verifier that said yes to everything would let
 * a broken signature pass, so the same payment signed by the wrong key must come back rejected.
 */

const VERIFY = "https://gateway-api-testnet.circle.com/v1/x402/verify";
const NETWORK = "eip155:5042002";

/** A seller's terms, in the shape a `402` advertises them. */
function requirements(payTo: Address, overrides: Partial<PaymentOption> = {}): PaymentOption {
  return {
    scheme: "exact",
    network: NETWORK,
    asset: USDC_ERC20_VIEW,
    amount: "1000",
    payTo,
    maxTimeoutSeconds: 604800,
    extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: GATEWAY_WALLET.toLowerCase() },
    ...overrides,
  };
}

/** As much of the facilitator's answer as this test reads. */
interface Verdict {
  readonly isValid: boolean;
  readonly invalidReason?: string;
  readonly payer?: string;
}

async function verify({ authorization, signature }: SignedPayment, option: PaymentOption): Promise<Verdict> {
  const response = await fetch(VERIFY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paymentPayload: {
        x402Version: 2,
        scheme: option.scheme,
        network: option.network,
        resource: { url: "https://example.test/probe", description: "test", mimeType: "application/json" },
        accepted: option,
        payload: { authorization, signature },
      },
      paymentRequirements: option,
    }),
  });
  assert.equal(response.status, 200, "the facilitator rejected the request shape, not the payment");
  const body: unknown = await response.json();
  assert.ok(
    typeof body === "object" && body !== null && "isValid" in body,
    `the facilitator answered something that is not a verdict: ${JSON.stringify(body)}`,
  );
  return body as Verdict;
}

test("Circle accepts a payment this connector signed", async () => {
  const agent = privateKeyToAccount(generatePrivateKey());
  const option = requirements(privateKeyToAccount(generatePrivateKey()).address);

  const result = await verify(await signPayment({ agent, option }), option);
  assert.equal(
    result.isValid,
    true,
    `the facilitator refused a payment we consider well formed: ${result.invalidReason ?? "no reason given"}`,
  );
  assert.equal(result.payer?.toLowerCase(), agent.address.toLowerCase());
});

test("and refuses one signed by anybody else, so the check above means something", async () => {
  const agent = privateKeyToAccount(generatePrivateKey());
  const option = requirements(privateKeyToAccount(generatePrivateKey()).address);

  // The agent's own authorisation, carrying a stranger's signature.
  const mine = await signPayment({ agent, option });
  const theirs = await signPayment({ agent: privateKeyToAccount(generatePrivateKey()), option });

  const result = await verify({ authorization: mine.authorization, signature: theirs.signature }, option);
  assert.equal(result.isValid, false);
  assert.equal(result.invalidReason, "invalid_signature");
});

/**
 * Gateway will not batch an authorisation that could expire before the batch settles, so it
 * imposes a floor of seven days. A seller advertising a shorter timeout is not asking for a
 * shorter authorisation — it is asking for one the facilitator would reject — so the floor wins.
 */
test("a seller's short timeout does not produce an authorisation Circle would refuse", async () => {
  const agent = privateKeyToAccount(generatePrivateKey());
  const option = requirements(privateKeyToAccount(generatePrivateKey()).address, { maxTimeoutSeconds: 60 });

  const { authorization } = await signPayment({ agent, option });
  const window = Number(authorization.validBefore) - Math.floor(Date.now() / 1000);
  assert.ok(window >= 7 * 24 * 60 * 60, `authorisation valid for only ${window}s`);

  const result = await verify(await signPayment({ agent, option }), option);
  assert.equal(result.isValid, true, result.invalidReason ?? "");
});

test("two payments never reuse a nonce, which Circle treats as an idempotency key", async () => {
  const agent = privateKeyToAccount(generatePrivateKey());
  const option = requirements(privateKeyToAccount(generatePrivateKey()).address);
  const [a, b] = await Promise.all([signPayment({ agent, option }), signPayment({ agent, option })]);
  assert.notEqual(a.authorization.nonce, b.authorization.nonce);
});

// ------------------------------------------------------------------------ funding the escrow

/**
 * The approval and the deposit have to agree, and they are built in separate places. An approval
 * larger than its deposit leaves a standing authority over the account's USDC; smaller, and the
 * deposit reverts. Neither shows up as a wrong number on screen.
 */
test("a top-up approves exactly what it deposits, to the agent, in one batch", () => {
  const agent = privateKeyToAccount(generatePrivateKey()).address;
  const calls = topUpCalls(agent, 250_000n);
  const [approval, deposited] = calls;
  assert.ok(approval && deposited, "an approval without its deposit is a standing authority");
  assert.equal(calls.length, 2, "and a top-up is those two calls and nothing else");

  const approve = decodeFunctionData({
    abi: parseAbi(["function approve(address spender, uint256 value)"]),
    data: approval.data,
  });
  const deposit = decodeFunctionData({
    abi: parseAbi(["function depositFor(address token, address depositor, uint256 value)"]),
    data: deposited.data,
  });

  assert.equal(approval.to, USDC_ERC20_VIEW);
  assert.equal(deposited.to, GATEWAY_WALLET);
  assert.equal(approve.args[0], GATEWAY_WALLET, "the allowance must go to Gateway and nowhere else");
  assert.equal(approve.args[1], 250_000n);
  assert.equal(deposit.args[1].toLowerCase(), agent.toLowerCase(), "the escrow is credited to the agent");
  assert.equal(deposit.args[2], approve.args[1], "approval and deposit must be the same amount");
  assert.equal(approval.value, 0n, "this rail carries no native value; the ERC-20 amount is the spend");
});

test("a top-up of nothing is refused rather than sent as a no-op operation", () => {
  const agent = privateKeyToAccount(generatePrivateKey()).address;
  assert.throws(() => topUpCalls(agent, 0n), /positive/);
  assert.throws(() => topUpCalls(agent, -1n), /positive/);
});

// ------------------------------------------------------------------------ choosing an option

test("the Arc option is picked out of a seller offering several chains", () => {
  const payTo = privateKeyToAccount(generatePrivateKey()).address;
  const arcOption = requirements(payTo);
  const choice = payableOption({
    accepts: [
      { ...requirements(payTo), network: "eip155:8453" },
      { ...requirements(payTo), network: "eip155:84532" },
      arcOption,
    ],
  });
  assert.equal(choice.ok, true);
  assert.equal(choice.option.network, NETWORK);
});

/**
 * The failure a person can act on. "Payment failed" sends someone to check their balance; naming
 * the chains the seller does take tells them the truth, which is that this seller is not for them.
 */
test("a seller that does not take Arc is explained rather than reported as an error", () => {
  const payTo = privateKeyToAccount(generatePrivateKey()).address;
  const choice = payableOption({ accepts: [{ ...requirements(payTo), network: "eip155:8453" }] });
  assert.equal(choice.ok, false);
  assert.match(choice.reason, /eip155:8453/);
  assert.match(choice.reason, /eip155:5042002/);
});

test("an Arc option that is not the Gateway scheme is not mistaken for one we can pay", () => {
  const payTo = privateKeyToAccount(generatePrivateKey()).address;
  const choice = payableOption({
    accepts: [{ ...requirements(payTo), extra: { name: "Permit2", version: "1" } }],
  });
  assert.equal(choice.ok, false);
});

test("a 402 with nothing in it is refused rather than crashing on an empty list", () => {
  assert.equal(payableOption({}).ok, false);
  assert.equal(payableOption({ accepts: [] }).ok, false);
});
