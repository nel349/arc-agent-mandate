/**
 * Does the ACCOUNT implement IPlugin.userOpValidationFunction, or does it only CALL it?
 *
 * A selector appearing in runtime bytecode proves nothing — BaseMSCA calls
 * userOpValidationFunction on plugins, which embeds the selector as a call site. The only
 * honest test is to invoke it and read what comes back: a dispatched function reverts on its
 * own terms, an undispatched one falls through to the account's fallback, which routes to
 * plugin execution and fails as an unrecognised function.
 */
import { createPublicClient, http, encodeFunctionData } from "viem";
import { arcTestnet } from "viem/chains";
const c = createPublicClient({ chain: arcTestnet, transport: http() });
const ACCOUNT = "0xa8546ff7d7fcd3bbd08c0ef31e74c73df6bcc447";

const emptyUserOp = {
  sender: ACCOUNT, nonce: 0n, initCode: "0x", callData: "0x",
  callGasLimit: 0n, verificationGasLimit: 0n, preVerificationGas: 0n,
  maxFeePerGas: 0n, maxPriorityFeePerGas: 0n, paymasterAndData: "0x", signature: "0x",
};
const abi = [{
  type: "function", name: "userOpValidationFunction", stateMutability: "nonpayable",
  inputs: [
    { name: "functionId", type: "uint8" },
    { name: "userOp", type: "tuple", components: [
      { name: "sender", type: "address" }, { name: "nonce", type: "uint256" },
      { name: "initCode", type: "bytes" }, { name: "callData", type: "bytes" },
      { name: "callGasLimit", type: "uint256" }, { name: "verificationGasLimit", type: "uint256" },
      { name: "preVerificationGas", type: "uint256" }, { name: "maxFeePerGas", type: "uint256" },
      { name: "maxPriorityFeePerGas", type: "uint256" }, { name: "paymasterAndData", type: "bytes" },
      { name: "signature", type: "bytes" }]},
    { name: "userOpHash", type: "bytes32" },
  ],
  outputs: [{ type: "uint256" }],
}];

for (const functionId of [0, 1, 2]) {
  try {
    const r = await c.call({ to: ACCOUNT, data: encodeFunctionData({
      abi, functionName: "userOpValidationFunction",
      args: [functionId, emptyUserOp, "0x" + "00".repeat(32)] }) });
    console.log(`  functionId ${functionId}: RETURNED ${r.data}`);
  } catch (e) {
    const msg = (e.shortMessage ?? e.message ?? "").split("\n")[0];
    const reason = e.cause?.reason ?? e.details ?? "";
    console.log(`  functionId ${functionId}: ${msg}${reason ? "  | " + reason : ""}`);
  }
}
