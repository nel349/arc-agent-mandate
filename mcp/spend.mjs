import { createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_RPC, encodeSpend, publicClient } from "./chain.mjs";

/**
 * Getting the agent's payment onto the chain.
 *
 * **Settled 2026-09-04, by measurement rather than preference.**
 *
 * The agent submits `handleOps` itself, from its own key, over a plain RPC. It fronts the
 * transaction gas and the account reimburses it as beneficiary.
 *
 * Cost per payment tracks the chain: roughly 1.1M gas, so about **0.028 USDC at Arc testnet's
 * present ~25 gwei**, or ~36 payments per dollar. An earlier figure of 0.0014 USDC came from a
 * hardcoded 1 gwei fee that the chain never charged, and is wrong by the same factor of twenty.
 *
 * The alternative was Circle's bundler, whose paymaster *will* sponsor an agent's spend — checked
 * directly: `pm_getPaymasterData` signs for an `executeWithSessionKey` operation. It was rejected
 * on developer experience rather than capability. Reaching it needs the app's `CIRCLE_CLIENT_KEY`
 * plus an `X-AppInfo` header matching the registered passkey domain, and an agent should not need
 * the wallet vendor's credential to spend an allowance it was already granted. Arc's own RPC does
 * not bundle — `eth_sendUserOperation` is not supported — so there was no third door.
 *
 * Whichever key submits, the agent's authority is identical: the account validates against the
 * mandate before anything moves. Submission is only about who pays to ask.
 */
const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

const entryPointAbi = parseAbi([
  "function getNonce(address sender, uint192 key) view returns (uint256)",
  "function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)",
  "function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops, address beneficiary)",
]);

const pack = (hi, lo) => "0x" + ((BigInt(hi) << 128n) | BigInt(lo)).toString(16).padStart(64, "0");

export async function submitSpend({ agent, account, to, value }) {
  const callData = encodeSpend({ to, value, agentAddress: agent.address });

  // The plugin requires the session key to own the nonce key, so an agent's operations stay
  // sequential and one bundle cannot invalidate its own later entries.
  const nonce = await publicClient.readContract({
    address: ENTRY_POINT, abi: entryPointAbi, functionName: "getNonce",
    args: [account, BigInt(agent.address)],
  });

  /**
   * Fees come from the chain, not from a constant.
   *
   * These were pinned at 1 gwei, which is roughly twenty times below what Arc testnet actually
   * charges — its base fee sits around 20 gwei. An operation offering less than the base fee is
   * simply not included, so every payment would have failed on the real chain. It passed in
   * testing because a forked anvil does not hold an operation to the live base fee, which is the
   * precise shape of bug a fork cannot show you.
   *
   * `estimateFeesPerGas` already applies a headroom multiplier over the current base fee, so a
   * block that gets busier between estimating and submitting does not strand the operation.
   */
  const { maxFeePerGas, maxPriorityFeePerGas } = await publicClient.estimateFeesPerGas();

  const userOp = {
    sender: account, nonce, initCode: "0x", callData,
    accountGasLimits: pack(500_000n, 500_000n),
    preVerificationGas: 100_000n,
    // v0.7 packs the priority fee first, then the max fee.
    gasFees: pack(maxPriorityFeePerGas, maxFeePerGas),
    paymasterAndData: "0x", signature: "0x",
  };
  const hash = await publicClient.readContract({
    address: ENTRY_POINT, abi: entryPointAbi, functionName: "getUserOpHash", args: [userOp],
  });
  userOp.signature = await agent.signMessage({ message: { raw: hash } });

  // The agent submits its own operation by default. It fronts the transaction gas and the account
  // reimburses it as beneficiary. See mcp/README.md on why this beats a bundler.
  const submitter = createWalletClient({
    account: process.env.ARC_SUBMITTER_KEY
      ? privateKeyToAccount(process.env.ARC_SUBMITTER_KEY)
      : agent,
    transport: http(ARC_RPC),
  });

  let txHash;
  try {
    txHash = await submitter.writeContract({
      address: ENTRY_POINT, abi: entryPointAbi, functionName: "handleOps",
      // Beneficiary is the submitter, so the account's prefund comes back to whoever paid.
      args: [[userOp], submitter.account.address], chain: null, gas: 3_000_000n,
    });
  } catch (cause) {
    // A mandate refusal fails validation, so the EntryPoint rejects the whole operation rather
    // than letting it land and revert.
    return { ok: false, reason: shortReason(cause) };
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  // An explicit gas limit means no simulation, so a refusal can also arrive as a reverted
  // receipt rather than a thrown error. Both mean the same thing: nothing moved.
  if (receipt.status !== "success") {
    return { ok: false, reason: "refused during validation" };
  }
  return { ok: true, hash: txHash };
}

function shortReason(cause) {
  const message = String(cause?.shortMessage ?? cause?.message ?? cause);
  if (/AA2[0-9]|PermissionsCheckFailed/i.test(message)) return "refused by the allowance";
  return message.split("\n")[0].slice(0, 160);
}
