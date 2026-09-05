import { createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_RPC, encodeSpend, publicClient } from "./chain.mjs";

/**
 * Getting the agent's payment onto the chain.
 *
 * The agent signs a user operation; something has to submit it and pay the gas. Which is
 * available depends on where this is running, and the difference is worth stating plainly rather
 * than hiding behind a config flag:
 *
 * - **Sponsored (`ARC_BUNDLER_URL`).** The account's paymaster covers gas, so the agent needs no
 *   funds at all. This is the shape a real deployment wants, and it requires a bundler endpoint
 *   that will accept an operation signed by a session key rather than the account's passkey.
 *   That is not yet confirmed against Circle's bundler — see the note in the README.
 * - **Direct (`ARC_SUBMITTER_KEY`).** Whoever holds the submitter key calls `handleOps` and pays
 *   the gas. Used by the local demo, where anvil supplies a funded account.
 *
 * Either way the agent's authority is identical: the account validates against the mandate before
 * anything moves. Submission is only about who pays to ask.
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

  const userOp = {
    sender: account, nonce, initCode: "0x", callData,
    accountGasLimits: pack(500_000n, 500_000n),
    preVerificationGas: 100_000n,
    gasFees: pack(1_000_000_000n, 1_000_000_000n),
    paymasterAndData: "0x", signature: "0x",
  };
  const hash = await publicClient.readContract({
    address: ENTRY_POINT, abi: entryPointAbi, functionName: "getUserOpHash", args: [userOp],
  });
  userOp.signature = await agent.signMessage({ message: { raw: hash } });

  const submitterKey = process.env.ARC_SUBMITTER_KEY;
  if (!submitterKey) {
    return {
      ok: false,
      reason:
        "no way to submit — set ARC_SUBMITTER_KEY to an account that can pay gas, or " +
        "ARC_BUNDLER_URL for a sponsored bundler",
    };
  }

  const submitter = createWalletClient({
    account: privateKeyToAccount(submitterKey), transport: http(ARC_RPC),
  });

  let txHash;
  try {
    txHash = await submitter.writeContract({
      address: ENTRY_POINT, abi: entryPointAbi, functionName: "handleOps",
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
