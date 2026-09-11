import { randomBytes } from "node:crypto";
import { getAddress, toHex, type Address, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

/** What a seller advertises in a `402`, narrowed to the one shape we can pay. */
export interface PaymentOption {
  readonly scheme: string;
  readonly network: string;
  readonly asset: string;
  readonly amount: string;
  readonly payTo: Address;
  readonly maxTimeoutSeconds?: number;
  readonly extra: { readonly name: string; readonly version: string; readonly verifyingContract: string };
}

export interface Authorization {
  readonly from: Address;
  readonly to: Address;
  readonly value: string;
  readonly validAfter: string;
  readonly validBefore: string;
  readonly nonce: Hex;
}

export interface SignedPayment {
  readonly authorization: Authorization;
  readonly signature: Hex;
}

/** Whether the caller could cover the price. Refusing costs the buyer nothing. */
export type Funding = { readonly ok: true; readonly toppedUp: bigint } | { readonly ok: false; readonly reason: string };

export interface BuyRequest {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: BodyInit;
  readonly agent: PrivateKeyAccount;
  readonly ensureFunds: (needed: bigint, option: PaymentOption) => Promise<Funding>;
}

/**
 * What the seller reported about settling, narrowed to what a buyer acts on: whether the payment was
 * taken, which batch it went into, and, when it was refused, why.
 *
 * Deliberately not the whole body: typing the rest would be inventing a schema no seller promises to
 * keep.
 */
export interface Settlement {
  readonly success?: boolean;
  readonly transaction?: string;
  readonly errorReason?: string;
  readonly error?: string;
}

/**
 * A union rather than a bag of optional fields, because the two outcomes carry different facts:
 * a settled purchase always knows what it paid and to whom, and an unsettled one never does. Every
 * caller has to branch on `paid` anyway, so this makes the branch produce the right shape instead
 * of leaving each one to re-check fields the successful path always fills.
 */
export type BuyOutcome =
  | {
      readonly paid: true;
      readonly response: Response;
      readonly amount: bigint;
      readonly payTo: Address;
      /** False when the seller took the payment and then failed the request. */
      readonly delivered: boolean;
    }
  | {
      readonly paid: false;
      readonly response: Response;
      /** Set when we could not even try — a seller we cannot pay, or an unreadable offer. */
      readonly problem?: string;
      readonly amount?: bigint;
      readonly settlement?: Settlement;
      /**
       * The seller stopped answering after it was sent a signed payment, so whether it took it is not
       * known. Counted as spent until the escrow says otherwise, which errs toward topping up.
       */
      readonly perhapsCharged?: true;
    };

/** Where an x402 seller reports what became of a payment it was sent. */
const SETTLEMENT_HEADER = "PAYMENT-RESPONSE";

/** What the buyer is told when the seller went quiet between being paid and answering. */
export const SELLER_WENT_QUIET =
  "The seller stopped answering after it was sent the payment, so whether it took it is not known. " +
  "The agent's escrow shows it within about a quarter of an hour; check before trying again.";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Does this advertised option have everything the Gateway scheme needs? */
function isPayableOn(network: string, value: unknown): value is PaymentOption {
  if (!isRecord(value) || !isRecord(value["extra"])) return false;
  const extra = value["extra"];
  return value["network"] === network
    && extra["name"] === "GatewayWalletBatched"
    && extra["version"] === "1"
    && typeof extra["verifyingContract"] === "string"
    && typeof value["payTo"] === "string"
    && typeof value["amount"] === "string";
}
import { arc } from "./chain.ts";
import { GATEWAY_WALLET, USDC_ERC20_VIEW } from "./gateway.ts";

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
 * the mandate lives — see `mcp/gateway.ts`.
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
  decode: (value: string): unknown => JSON.parse(Buffer.from(value, "base64").toString("utf8")),
  encode: (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64"),
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
export function payableOption(
  paymentRequired: unknown,
): { ok: true; option: PaymentOption } | { ok: false; reason: string } {
  const accepts = isRecord(paymentRequired) ? paymentRequired["accepts"] : undefined;
  if (!Array.isArray(accepts) || accepts.length === 0) {
    return { ok: false, reason: "The seller returned 402 without saying what it accepts." };
  }
  const network = `eip155:${arc.id}`;
  const option = accepts.find((o): o is PaymentOption => isPayableOn(network, o));
  if (option) return { ok: true, option };

  const networks = [...new Set(
    accepts.map((o) => (isRecord(o) && typeof o["network"] === "string" ? o["network"] : null))
      .filter((n): n is string => n !== null),
  )];
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
export async function signPayment(
  { agent, option }: { agent: PrivateKeyAccount; option: PaymentOption },
): Promise<SignedPayment> {
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
export async function fetchWithPayment(
  { url, method = "GET", headers = {}, body, agent, ensureFunds }: BuyRequest,
): Promise<BuyOutcome> {
  const first = await fetch(url, { method, headers, body: body ?? null });
  if (first.status !== 402) return { paid: false, response: first };

  const header = first.headers.get("PAYMENT-REQUIRED");
  if (!header) {
    return { paid: false, response: first, problem: "The seller asked for payment without saying how much." };
  }

  let paymentRequired: unknown;
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
  const amount = BigInt(option.amount);
  let paid: Response;
  try {
    paid = await fetch(url, {
      method,
      headers: {
        ...headers,
        "Payment-Signature": b64.encode({
          x402Version: (isRecord(paymentRequired) ? paymentRequired["x402Version"] : undefined) ?? 2,
          scheme: option.scheme,
          network: option.network,
          resource: isRecord(paymentRequired) ? paymentRequired["resource"] : undefined,
          accepted: option,
          payload: { authorization, signature },
        }),
      },
      body: body ?? null,
    });
  } catch {
    // The payment went out and no answer came back, so nobody here can say whether it was taken.
    return { paid: false, response: first, amount, perhapsCharged: true, problem: SELLER_WENT_QUIET };
  }

  const { charged, settlement } = chargeOf(paid.ok, paid.headers.get(SETTLEMENT_HEADER));
  if (charged) return { paid: true, delivered: paid.ok, response: paid, amount, payTo: option.payTo };
  return { paid: false, response: paid, amount, ...(settlement === undefined ? {} : { settlement }) };
}

/**
 * Whether a request sent with a payment cost the buyer, from the seller's answer.
 *
 * Read from the settlement the seller reports rather than from the status. A seller can take the
 * payment and then fail the request, as the maze does when it cannot record a step it was paid for,
 * and reading only the status told the person nothing had been charged. A seller that served without
 * a settlement header was still paid, since it served.
 */
export function chargeOf(
  ok: boolean, settlementHeader: string | null,
): { readonly charged: boolean; readonly settlement?: Settlement } {
  const settlement = settlementHeader === null
    ? undefined
    : asSettlement(safely(() => b64.decode(settlementHeader)));
  return { charged: ok || settlement?.success === true, ...(settlement === undefined ? {} : { settlement }) };
}

/** Keeps only the fields we read, so an unfamiliar body degrades to "refused, no reason". */
function asSettlement(value: unknown): Settlement | undefined {
  if (!isRecord(value)) return undefined;
  const { success, transaction, errorReason, error } = value;
  return {
    ...(typeof success === "boolean" ? { success } : {}),
    ...(typeof transaction === "string" ? { transaction } : {}),
    ...(typeof errorReason === "string" ? { errorReason } : {}),
    ...(typeof error === "string" ? { error } : {}),
  };
}

function safely<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

export { USDC_ERC20_VIEW, GATEWAY_WALLET };
