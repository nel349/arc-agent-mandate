import { publicClient } from "./chain.ts";
import { bundlerConfigured, bundlerSetupInstructions } from "./bundler.ts";

/**
 * Getting the agent's payment onto the chain, without the agent ever holding money.
 *
 * **Revised 2026-09-05, after the first real grant showed what the old design cost.**
 *
 * The agent used to submit `handleOps` itself over Arc's public RPC. That required funding it
 * first — a transaction's sender must hold a balance before it can send one — so every grant
 * transferred it half a dollar, and whatever remained stayed with the agent afterwards. Dust left
 * behind in an agent's pocket is not a rounding detail: the product's whole claim is that an
 * allowance is authority rather than a balance, and a wallet that visibly leaks money to agents
 * contradicts it no matter how little leaks.
 *
 * So the operation goes to a bundler instead, and the agent holds nothing at any point. Circle's
 * is the only bundler on Arc — checked, not assumed: Arc's own RPC answers
 * `eth_supportedEntryPoints` with "method not supported".
 *
 * Two things fall out of the change, both good. The paymaster sponsors the operation, so the
 * **account** pays no gas either — and it previously paid for everything the agent did, unbounded,
 * because the mandate counts `call.value` and gas is not `call.value`. And because these now go
 * through Circle, an agent's payments appear in the same console as the grants that authorised
 * them, instead of being invisible there.
 *
 * What it costs: the agent is configured with the Circle client key. That is the key the mobile
 * app already ships in its bundle, bound to a passkey domain, and it grants no authority by
 * itself — a spend still needs a session-key signature the mandate permits. See `bundler.ts`.
 */

import { createBundlerClient } from "viem/account-abstraction";
import type { Address, Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { toSessionKeyAccount } from "./session-account.ts";
import { circleTransport } from "./bundler.ts";
import type { Call } from "./gateway.ts";

export interface SpendRequest {
  readonly agent: PrivateKeyAccount;
  /** The granting account, which pays. */
  readonly account: Address;
  readonly calls: readonly Call[];
}

export type SpendResult =
  /** The connector has no way to submit yet; `reason` is the walkthrough, not an error. */
  | { readonly ok: false; readonly setup: true; readonly reason: string }
  | { readonly ok: false; readonly reason: string }
  | { readonly ok: true; readonly hash: Hex; readonly userOpHash: Hex };

type Bundler = ReturnType<typeof createBundlerClient>;

/**
 * Submit one or more calls as a single operation, signed by the session key.
 *
 * `calls` rather than a single payee, because buying is not transferring. A transfer moves money
 * and tells the seller nothing; a purchase has to name what it is for, and funding an escrow takes
 * an approval and a deposit that must land together or not at all. The plugin already accepts a
 * batch — `executeWithSessionKey` takes an array — and meters every call in it, so a batch is
 * bounded exactly as a single call is.
 *
 * The generality stops here, deliberately. Nothing an agent says reaches this as calldata: callers
 * build these calls from narrow arguments, so an agent can ask to pay an invoice or top up its
 * float and cannot ask to invoke an arbitrary function. A spend limit bounds the value moved, not
 * what is called, so that distinction is the whole difference between an agent that pays and an
 * agent that transacts.
 */
export async function submitSpend({ agent, account, calls }: SpendRequest): Promise<SpendResult> {
  if (!bundlerConfigured()) {
    // The full walkthrough, not a list of variable names. This is the one wall a new person hits.
    return { ok: false, setup: true, reason: bundlerSetupInstructions() };
  }
  if (!Array.isArray(calls) || calls.length === 0) throw new Error("submitSpend needs at least one call");

  try {
    const smartAccount = await toSessionKeyAccount({ address: account, agent, client: publicClient });
    const bundler = createBundlerClient({
      account: smartAccount,
      client: publicClient,
      transport: circleTransport(),
      // Sponsorship. The account pays no gas, and neither does the agent — which is the whole
      // reason nothing has to be transferred to an agent in the first place.
      paymaster: true,
    });

    const userOpHash = await sendWithFeeBump(bundler, calls);
    const receipt = await bundler.waitForUserOperationReceipt({ hash: userOpHash });
    if (!receipt.success) return { ok: false, reason: "refused during validation" };
    return { ok: true, hash: receipt.receipt.transactionHash, userOpHash };
  } catch (cause) {
    return { ok: false, reason: shortReason(cause) };
  }
}

/**
 * Gas limits, fixed rather than estimated.
 *
 * `eth_estimateUserOperationGas` cannot be used here. Estimation runs validation with a *stub*
 * signature, and the plugin recovers the signer from that signature to check it is a session key
 * of this account — a stub recovers to a random address, so validation reverts with `AA23` and
 * estimation always fails. Nothing about the operation is wrong; the method simply cannot ask this
 * question. So the limits are generous constants, and the paymaster pays for the headroom.
 */
const GAS = {
  callGasLimit: 500_000n,
  verificationGasLimit: 500_000n,
  preVerificationGas: 100_000n,
  paymasterVerificationGasLimit: 150_000n,
  paymasterPostOpGasLimit: 20_000n,
};

/**
 * How far above the chain's own estimate to bid.
 *
 * Not caution — necessity. `estimateFeesPerGas` returns a price Circle's bundler will accept into
 * its mempool and then never include: measured, an operation at the bare estimate (25 gwei against
 * a 21–25 gwei chain) sits forever, while the same operation at twice that is included in six
 * seconds. The failure is silent and total — the bundler returns a hash, `eth_getUserOperationByHash`
 * shows the operation waiting, and nothing ever says it will not be mined.
 *
 * Over-bidding costs us nothing, which is what makes this the right lever: the paymaster pays, and
 * `maxFeePerGas` is a ceiling rather than a price. Bidding thin costs a payment that never happens.
 */
const FEE_PREMIUM = 2n;

/** Bundlers require a meaningfully higher bid again to replace an operation already at this nonce. */
const REPLACEMENT_MULTIPLIER = 3n;

/**
 * Send, and outbid an operation stuck at the same nonce rather than wedging behind it.
 *
 * An agent's nonce only advances when an operation is *included*. One that the bundler accepted
 * but never included therefore blocks every later payment: an identical retry is rejected as
 * "already known", and a different one as "replacement underpriced". Left alone the agent stops
 * working permanently, for a reason nothing on the machine explains.
 */
async function sendWithFeeBump(bundler: Bundler, calls: readonly Call[]): Promise<Hex> {
  // From the chain, never a constant: Arc's base fee has been seen at 20, 25, 45 and 66 gwei, and
  // an operation offering less than the base fee is never included. The premium is on top of that.
  const estimate = await publicClient.estimateFeesPerGas();
  const fees = {
    maxFeePerGas: estimate.maxFeePerGas * FEE_PREMIUM,
    maxPriorityFeePerGas: estimate.maxPriorityFeePerGas * FEE_PREMIUM,
  };
  try {
    return await bundler.sendUserOperation({ calls, ...GAS, ...fees });
  } catch (cause) {
    if (!isStuckAtThisNonce(cause)) throw cause;
    return bundler.sendUserOperation({
      calls,
      ...GAS,
      maxFeePerGas: estimate.maxFeePerGas * REPLACEMENT_MULTIPLIER,
      maxPriorityFeePerGas: estimate.maxPriorityFeePerGas * REPLACEMENT_MULTIPLIER,
    });
  }
}

/**
 * Every message in a cause chain, outermost first.
 *
 * viem nests the useful sentence several layers down and spreads it across `shortMessage`,
 * `details` and `message`, so the interesting words are never in one place. Walking it once here
 * means the two callers below both read the whole thing rather than the top of it.
 *
 * Bounded at six because a cycle in a cause chain is not impossible, and an infinite loop while
 * formatting an error is a worse failure than the error.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function messagesIn(cause: unknown): readonly string[] {
  const found: string[] = [];
  let error: unknown = cause;
  for (let depth = 0; isRecord(error) && depth < 6; depth++) {
    for (const field of [error["shortMessage"], error["details"], error["message"]]) {
      if (typeof field === "string" && field !== "" && !found.includes(field)) found.push(field);
    }
    error = error["cause"];
  }
  return found;
}

/**
 * An operation the bundler already holds at this nonce.
 *
 * An agent's nonce only advances when an operation is *included*, so one accepted and never mined
 * blocks every later payment: an identical retry is "already known", a different one is
 * "replacement underpriced". Recognising either is what lets the caller outbid rather than wedge.
 */
const isStuckAtThisNonce = (cause: unknown): boolean =>
  /already known|replacement underpriced/i.test(messagesIn(cause).join(" "));

function shortReason(cause: unknown): string {
  const all = messagesIn(cause).join(" | ");
  // The mandate refusing is the one outcome a person can act on, and viem reports it as an
  // opaque AA code. Everything else is passed through as found.
  if (/AA2[0-9]|PermissionsCheckFailed/i.test(all)) return "refused by the allowance";
  return (all.split("\n")[0] ?? all).slice(0, 220);
}
