import { randomBytes } from "node:crypto";
import { getAddress, toHex } from "viem";
import { arc } from "./chain.mjs";
import { GATEWAY_WALLET, USDC_ERC20_VIEW } from "./gateway.mjs";

/**
 * Paying for a web request, in the shape sellers already speak.
 *
 * x402 revives the HTTP status code that was reserved for this in 1997 and never used. A server
 * answers `402` with a machine-readable note saying what it costs and who to pay; the client signs
 * a payment, retries the same request carrying it, and is served. What makes it matter is not the
 * payment but what is absent from it — no account, no signup, no API key, no card on file, no
 * human agreeing to terms. It is the first way to buy something that does not assume a person did
 * onboarding first, which is exactly the assumption an agent cannot satisfy.
 *
 * The signature is over a `TransferWithAuthorization` message under Circle's
 * **`GatewayWalletBatched`** domain — not the token's own EIP-3009 domain, and not verified on
 * chain. Circle's Gateway API checks it off-chain and settles hundreds of them in one batch later,
 * which is why a payment costs no gas and can be worth less than a cent.
 *
 * Nothing here spends money on its own. When escrow is short it asks the caller, which is where
 * the mandate lives — see `mcp/gateway.mjs`.
 */

/** Circle's minimum: an authorisation has to stay valid long enough to be batched. Seven days. */
const MIN_VALIDITY_SECONDS = 7 * 24 * 60 * 60 + 100;

/** Backdated a little, so a seller whose clock runs slow does not reject a fresh authorisation. */
const BACKDATE_SECONDS = 600;

const AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

const b64 = {
  decode: (value) => JSON.parse(Buffer.from(value, "base64").toString("utf8")),
  encode: (value) => Buffer.from(JSON.stringify(value)).toString("base64"),
};

/**
 * The payment option this agent can actually satisfy, out of everything the seller offers.
 *
 * A `402` advertises an array, because one seller may take several kinds of money. We can pay
 * exactly one of them: Circle's Gateway scheme, on Arc, denominated in the USDC we hold. Anything
 * else — another chain, a Permit2 flow, a token we do not have — is not a failure to report as an
 * error so much as a seller we cannot buy from, and saying which is which is the difference
 * between a person adding funds and a person giving up.
 */
export function payableOption(paymentRequired) {
  const accepts = paymentRequired?.accepts;
  if (!Array.isArray(accepts) || accepts.length === 0) {
    return { ok: false, reason: "The seller returned 402 without saying what it accepts." };
  }
  const network = `eip155:${arc.id}`;
  const option = accepts.find(
    (o) =>
      o?.network === network &&
      o?.extra?.name === "GatewayWalletBatched" &&
      o?.extra?.version === "1" &&
      typeof o?.extra?.verifyingContract === "string",
  );
  if (option) return { ok: true, option };

  const networks = [...new Set(accepts.map((o) => o?.network).filter(Boolean))];
  return {
    ok: false,
    reason:
      `This seller does not take Arc payments. It accepts ${networks.join(", ") || "nothing recognisable"}, ` +
      `and this wallet is on ${network}.`,
  };
}

/**
 * Sign one payment.
 *
 * The signature is the agent's own, over its own address as `from`. That is not a shortcut around
 * the mandate — it is the only thing Gateway accepts, and the mandate binds what reached the
 * agent's escrow rather than what it signs against it.
 */
export async function signPayment({ agent, option }) {
  const now = Math.floor(Date.now() / 1000);
  const validity = Math.max(Number(option.maxTimeoutSeconds ?? 0), MIN_VALIDITY_SECONDS);
  const authorization = {
    from: getAddress(agent.address),
    to: getAddress(option.payTo),
    value: String(option.amount),
    validAfter: String(now - BACKDATE_SECONDS),
    validBefore: String(now + validity),
    // Not a counter: Gateway treats this as an idempotency key, so it must never repeat.
    nonce: toHex(randomBytes(32)),
  };
  const signature = await agent.signTypedData({
    domain: {
      name: "GatewayWalletBatched",
      version: "1",
      chainId: arc.id,
      verifyingContract: getAddress(option.extra.verifyingContract),
    },
    types: AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  });
  return { authorization, signature };
}

/**
 * Fetch a URL, paying if it asks.
 *
 * `ensureFunds` is handed the shortfall and returns whether it was covered. Keeping it a callback
 * is what stops this module from being able to spend: it knows how to sign a payment and nothing
 * about the account, the mandate or the budget.
 */
export async function fetchWithPayment({ url, method = "GET", headers = {}, body, agent, ensureFunds }) {
  const first = await fetch(url, { method, headers, body });
  if (first.status !== 402) return { paid: false, response: first };

  const header = first.headers.get("PAYMENT-REQUIRED");
  if (!header) {
    return { paid: false, response: first, problem: "The seller asked for payment without saying how much." };
  }

  let paymentRequired;
  try {
    paymentRequired = b64.decode(header);
  } catch {
    return { paid: false, response: first, problem: "The seller's payment request was not readable." };
  }

  const choice = payableOption(paymentRequired);
  if (!choice.ok) return { paid: false, response: first, problem: choice.reason };
  const { option } = choice;

  const funded = await ensureFunds(BigInt(option.amount), option);
  if (!funded.ok) return { paid: false, response: first, problem: funded.reason, amount: BigInt(option.amount) };

  const { authorization, signature } = await signPayment({ agent, option });
  const paid = await fetch(url, {
    method,
    headers: {
      ...headers,
      "Payment-Signature": b64.encode({
        x402Version: paymentRequired.x402Version ?? 2,
        scheme: option.scheme,
        network: option.network,
        resource: paymentRequired.resource,
        accepted: option,
        payload: { authorization, signature },
      }),
    },
    body,
  });

  // Present on success and, more usefully, on refusal — it carries the reason the facilitator gave.
  const settled = paid.headers.get("PAYMENT-RESPONSE");
  return {
    paid: paid.ok,
    response: paid,
    amount: BigInt(option.amount),
    payTo: option.payTo,
    settlement: settled ? safely(() => b64.decode(settled)) : undefined,
  };
}

function safely(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

export { USDC_ERC20_VIEW, GATEWAY_WALLET };
