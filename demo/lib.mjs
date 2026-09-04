import { createPublicClient, createWalletClient, http, encodeFunctionData, keccak256, parseAbi, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const RPC = process.env.DEMO_RPC ?? "http://127.0.0.1:8545";
export const MSCA = "0xa8546Ff7D7Fcd3BBd08C0ef31E74C73DF6BcC447";
export const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

/// Demo keys, derived from a namespaced seed so the demo is reproducible without using a key
/// anyone else holds.
///
/// **Do not use anvil's default accounts on an Arc fork.** Their private keys are public, so on
/// Arc testnet every one of them already carries an EIP-7702 delegation (`0xef0100 || address`)
/// pointing at a sweeper contract. A fork inherits that delegation, so value sent to one is
/// forwarded away the instant it lands -- and the user operation still reports `success = true`,
/// because the transfer itself did not fail. That cost an hour: the money left the account, the
/// seller's balance never moved, and nothing in the receipt said why.
const seed = (role) => keccak256(toHex(`kuiralabs.arc-agent-mandate.demo.${role}`));
export const BUNDLER_PK = seed("bundler");
export const AGENT_PK = seed("agent");
export const SELLER_PK = seed("seller");
export const SELLER = privateKeyToAccount(SELLER_PK).address;

export const entryPointAbi = parseAbi([
  "function getNonce(address sender, uint192 key) view returns (uint256)",
  "function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)",
  "function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops, address beneficiary)",
]);

export const sessionKeyAbi = parseAbi([
  "function executeWithSessionKey((address target,uint256 value,bytes data)[] calls, address sessionKey) returns (bytes[])",
]);

export const publicClient = createPublicClient({ transport: http(RPC) });
export const agent = privateKeyToAccount(AGENT_PK);
export const bundler = createWalletClient({ account: privateKeyToAccount(BUNDLER_PK), transport: http(RPC) });

const pack = (hi, lo) =>
  ("0x" + (BigInt(hi) << 128n | BigInt(lo)).toString(16).padStart(64, "0"));

/// Builds, signs and submits one payment from the account, authorised by the agent's session key.
/// This is the whole agent-side flow: no passkey, no human, bounded by the mandate on-chain.
export async function payFromMandate({ to, value }) {
  const callData = encodeFunctionData({
    abi: sessionKeyAbi,
    functionName: "executeWithSessionKey",
    args: [[{ target: to, value, data: "0x" }], agent.address],
  });

  // The plugin requires the session key to own the nonce key, so its operations stay sequential.
  const nonceKey = BigInt(agent.address);
  const nonce = await publicClient.readContract({
    address: ENTRY_POINT, abi: entryPointAbi, functionName: "getNonce", args: [MSCA, nonceKey],
  });

  const userOp = {
    sender: MSCA, nonce, initCode: "0x", callData,
    accountGasLimits: pack(500_000n, 500_000n),
    preVerificationGas: 100_000n,
    gasFees: pack(1_000_000_000n, 1_000_000_000n),
    paymasterAndData: "0x", signature: "0x",
  };

  const userOpHash = await publicClient.readContract({
    address: ENTRY_POINT, abi: entryPointAbi, functionName: "getUserOpHash", args: [userOp],
  });
  userOp.signature = await agent.signMessage({ message: { raw: userOpHash } });

  // A mandate refusal fails *validation*, so the EntryPoint rejects the whole operation rather
  // than letting it land and revert. That is the difference worth showing: the payment never
  // happens, and it costs nothing.
  let hash;
  try {
    hash = await bundler.writeContract({
      address: ENTRY_POINT, abi: entryPointAbi, functionName: "handleOps",
      args: [[userOp], bundler.account.address], chain: null, gas: 3_000_000n,
    });
  } catch (cause) {
    const refused = /PermissionsCheckFailed|AA23|reverted/i.test(String(cause));
    throw new Error(refused ? "REFUSED_BY_MANDATE" : `submission failed: ${String(cause).slice(0, 120)}`);
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  // An explicit gas limit means viem does not simulate, so a refusal arrives as a reverted
  // receipt rather than a thrown error. Left unchecked, the agent hands the seller a transaction
  // hash for a payment that never happened, and the seller's "payment not observed" becomes the
  // story instead of the mandate's refusal.
  if (receipt.status !== "success") throw new Error("REFUSED_BY_MANDATE");
  return receipt;
}

/// Anvil does not prefund addresses it does not know about, so the bundler needs gas before it can
/// submit anything. Harmless on a local fork; impossible anywhere else, which is the point.
export async function fundOnFork(addresses, wei = 10n ** 20n) {
  for (const address of addresses) {
    await fetch(RPC, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_setBalance",
                             params: [address, "0x" + wei.toString(16)] }),
    });
  }
}
