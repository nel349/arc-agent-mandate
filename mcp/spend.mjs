import { parseAbi } from "viem";
import { encodeSpend, publicClient } from "./chain.mjs";
import { bundlerConfigured, bundlerRpc, missingBundlerConfig, ENTRY_POINT } from "./bundler.mjs";

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

const entryPointAbi = parseAbi([
  "function getNonce(address sender, uint192 key) view returns (uint256)",
  "function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)",
]);

const pack = (hi, lo) => "0x" + ((BigInt(hi) << 128n) | BigInt(lo)).toString(16).padStart(64, "0");
const hex = (value) => "0x" + BigInt(value).toString(16);

/** Room for the account's validation plus the plugin's permission checks. */
const VERIFICATION_GAS = 500_000n;
const CALL_GAS = 500_000n;
const PRE_VERIFICATION_GAS = 100_000n;
const PAYMASTER_VERIFICATION_GAS = 100_000n;
const PAYMASTER_POST_OP_GAS = 3_000n;

export async function submitSpend({ agent, account, to, value }) {
  if (!bundlerConfigured()) {
    return {
      ok: false,
      reason:
        `the agent has no bundler configured (missing ${missingBundlerConfig().join(", ")}). ` +
        "Arc has no public bundler, so a payment cannot be submitted without one.",
    };
  }

  const callData = encodeSpend({ to, value, agentAddress: agent.address });

  // The plugin requires the session key to own the nonce key, so an agent's operations stay
  // sequential and one bundle cannot invalidate its own later entries.
  const nonce = await publicClient.readContract({
    address: ENTRY_POINT, abi: entryPointAbi, functionName: "getNonce",
    args: [account, BigInt(agent.address)],
  });

  // From the chain, never a constant: Arc's base fee has been seen at 20 and at 45 gwei, and an
  // operation offering less than the base fee is simply never included.
  const fees = await publicClient.estimateFeesPerGas();

  const draft = {
    sender: account,
    nonce: hex(nonce),
    callData,
    callGasLimit: hex(CALL_GAS),
    verificationGasLimit: hex(VERIFICATION_GAS),
    preVerificationGas: hex(PRE_VERIFICATION_GAS),
    maxFeePerGas: hex(fees.maxFeePerGas),
    maxPriorityFeePerGas: hex(fees.maxPriorityFeePerGas),
    paymasterVerificationGasLimit: hex(PAYMASTER_VERIFICATION_GAS),
    paymasterPostOpGasLimit: hex(PAYMASTER_POST_OP_GAS),
  };

  try {
    // The paymaster signs over the operation, so its data has to be settled before the hash the
    // session key signs is computed. Sign first and the sponsorship would invalidate the signature.
    const sponsorship = await bundlerRpc("pm_getPaymasterData", [
      { ...draft, signature: "0x" }, ENTRY_POINT, hex(await publicClient.getChainId()), {},
    ]);
    const paymasterAndData = sponsorship?.paymaster
      ? concatPaymaster(sponsorship, draft)
      : "0x";

    const hash = await publicClient.readContract({
      address: ENTRY_POINT, abi: entryPointAbi, functionName: "getUserOpHash",
      args: [{
        sender: account, nonce, initCode: "0x", callData,
        accountGasLimits: pack(VERIFICATION_GAS, CALL_GAS),
        preVerificationGas: PRE_VERIFICATION_GAS,
        gasFees: pack(fees.maxPriorityFeePerGas, fees.maxFeePerGas),
        paymasterAndData, signature: "0x",
      }],
    });

    const signature = await agent.signMessage({ message: { raw: hash } });
    const sent = await bundlerRpc("eth_sendUserOperation", [
      { ...draft, ...(sponsorship?.paymaster ? sponsorship : {}), signature }, ENTRY_POINT,
    ]);
    const receipt = await waitForReceipt(sent);
    if (!receipt?.success) return { ok: false, reason: "refused during validation" };
    return { ok: true, hash: receipt.receipt?.transactionHash ?? sent, userOpHash: sent };
  } catch (cause) {
    return { ok: false, reason: shortReason(cause) };
  }
}

/**
 * `paymasterAndData`, as the EntryPoint hashes it in v0.7: the paymaster address, then its two gas
 * limits as 16 bytes each, then its data. The bundler takes these as separate fields on the
 * operation; only the hash wants them packed, which is an easy place to disagree with yourself.
 */
function concatPaymaster(sponsorship, draft) {
  const limit = (value) => BigInt(value ?? 0).toString(16).padStart(32, "0");
  const body = (value) => (value ?? "0x").replace(/^0x/, "");
  return (
    "0x" +
    body(sponsorship.paymaster) +
    limit(sponsorship.paymasterVerificationGasLimit ?? draft.paymasterVerificationGasLimit) +
    limit(sponsorship.paymasterPostOpGasLimit ?? draft.paymasterPostOpGasLimit) +
    body(sponsorship.paymasterData)
  );
}

/** The bundler includes operations on its own schedule, so the receipt is polled for. */
async function waitForReceipt(userOpHash, attempts = 40, everyMs = 1500) {
  for (let i = 0; i < attempts; i++) {
    const receipt = await bundlerRpc("eth_getUserOperationReceipt", [userOpHash]);
    if (receipt) return receipt;
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
  throw new Error("the bundler did not report a receipt in time");
}

function shortReason(cause) {
  const message = String(cause?.shortMessage ?? cause?.message ?? cause);
  if (/AA2[0-9]|PermissionsCheckFailed/i.test(message)) return "refused by the allowance";
  return message.split("\n")[0].slice(0, 200);
}
