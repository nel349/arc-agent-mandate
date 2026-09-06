import { publicClient } from "./chain.mjs";
import { bundlerConfigured, missingBundlerConfig } from "./bundler.mjs";

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
 * itself — a spend still needs a session-key signature the mandate permits. See `bundler.mjs`.
 */

import { createBundlerClient } from "viem/account-abstraction";
import { toSessionKeyAccount } from "./session-account.mjs";
import { circleTransport } from "./bundler.mjs";

export async function submitSpend({ agent, account, to, value }) {
  if (!bundlerConfigured()) {
    return {
      ok: false,
      reason:
        `the agent has no bundler configured (missing ${missingBundlerConfig().join(", ")}). ` +
        "Arc has no public bundler, so a payment cannot be submitted without one.",
    };
  }

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

    const userOpHash = await sendWithFeeBump(bundler, { to, value });
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
async function sendWithFeeBump(bundler, { to, value }) {
  // From the chain, never a constant: Arc's base fee has been seen at 20, 25, 45 and 66 gwei, and
  // an operation offering less than the base fee is never included. The premium is on top of that.
  const estimate = await publicClient.estimateFeesPerGas();
  const fees = {
    maxFeePerGas: estimate.maxFeePerGas * FEE_PREMIUM,
    maxPriorityFeePerGas: estimate.maxPriorityFeePerGas * FEE_PREMIUM,
  };
  const calls = [{ to, value, data: "0x" }];

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

function isStuckAtThisNonce(cause) {
  for (let error = cause, depth = 0; error && depth < 6; error = error.cause, depth++) {
    const text = `${error.shortMessage ?? ""} ${error.details ?? ""} ${error.message ?? ""}`;
    if (/already known|replacement underpriced/i.test(text)) return true;
  }
  return false;
}

function shortReason(cause) {
  const parts = [];
  for (let e = cause, depth = 0; e && depth < 6; e = e.cause, depth++) {
    for (const field of [e.shortMessage, e.details, e.message]) {
      if (typeof field === "string" && field && !parts.includes(field)) parts.push(field);
    }
  }
  const all = parts.join(" | ");
  if (/AA2[0-9]|PermissionsCheckFailed/i.test(all)) return "refused by the allowance";
  return all.split("\n")[0].slice(0, 220);
}
