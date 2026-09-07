import { readFileSync } from "node:fs";
import { encodeFunctionData, keccak256, toHex } from "viem";

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ENV_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf8")
    .split("\n").filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const URL_BASE = env["CIRCLE_CLIENT_URL"] ?? env["EXPO_PUBLIC_CIRCLE_CLIENT_URL"];
const KEY = env["CIRCLE_CLIENT_KEY"] ?? env["EXPO_PUBLIC_CIRCLE_CLIENT_KEY"];
if (URL_BASE === undefined) {
  console.error(`No CIRCLE_CLIENT_URL in ${ENV_PATH}, so there is no endpoint to probe.`);
  process.exit(1);
}
const url = `${URL_BASE.replace(/\/$/, "")}/arcTestnet`;
// Circle validates the domain-bound client key against the `uri` in X-AppInfo -- the same header
// the RN shim rewrites. Without it every call is "Invalid credentials", naming neither.
const APP_INFO = `platform=web;version=1.0.0;uri=${env["EXPO_PUBLIC_CIRCLE_PASSKEY_DOMAIN"]}`;

const MSCA = "0xa8546Ff7D7Fcd3BBd08C0ef31E74C73DF6BcC447";
const MULTISIG = "0x0000000C984AFf541D6cE86Bb697e68ec57873C8";
const PLUGIN = "0x669Dd1eDb85ABD00f74186d88124614EE81E6670"; // predicted CREATE2 address
const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

const installPluginAbi = [{
  name: "installPlugin", type: "function", stateMutability: "nonpayable",
  inputs: [
    { name: "plugin", type: "address" },
    { name: "manifestHash", type: "bytes32" },
    { name: "pluginInstallData", type: "bytes" },
    { name: "dependencies", type: "tuple[]", components: [
      { name: "plugin", type: "address" }, { name: "functionId", type: "uint8" }] },
  ], outputs: [],
}];

const callData = encodeFunctionData({
  abi: installPluginAbi, functionName: "installPlugin",
  args: [PLUGIN, keccak256(toHex("placeholder-manifest")), "0x",
         [{ plugin: MULTISIG, functionId: 0 }]],
});

/** What came back, undigested: the body is whatever the endpoint said, JSON or not. */
interface Reply {
  readonly status: number;
  readonly body: unknown;
}

let id = 0;
async function rpc(method: string, params: readonly unknown[]): Promise<Reply> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "Authorization": `Bearer ${KEY}`, "X-AppInfo": APP_INFO },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  const text = await r.text();
  try { return { status: r.status, body: JSON.parse(text) }; }
  catch { return { status: r.status, body: text.slice(0, 300) }; }
}

console.log("endpoint:", url);
const supported = await rpc("pm_getPaymasterStubData", [
  {
    sender: MSCA, nonce: "0x0", callData,
    callGasLimit: "0x30d40", verificationGasLimit: "0x30d40", preVerificationGas: "0xc350",
    maxFeePerGas: "0x3b9aca00", maxPriorityFeePerGas: "0x3b9aca00", signature: "0x",
  },
  ENTRY_POINT, "0x4cef52", {},
]);
console.log("\npm_getPaymasterStubData ->", JSON.stringify(supported.body).slice(0, 600));

// NOTE: an earlier version of this comment claimed policy is applied here, and that a paymaster
// signature therefore answers whether installPlugin is sponsored. That was wrong — see the
// discrimination check at the bottom, which gets the same signature for a dead address sending
// garbage. Neither call decides anything.
const final = await rpc("pm_getPaymasterData", [
  {
    sender: MSCA, nonce: "0x0", callData,
    callGasLimit: "0x30d40", verificationGasLimit: "0x30d40", preVerificationGas: "0xc350",
    maxFeePerGas: "0x3b9aca00", maxPriorityFeePerGas: "0x3b9aca00",
    paymasterVerificationGasLimit: "0x186a0", paymasterPostOpGasLimit: "0xbb8", signature: "0x",
  },
  ENTRY_POINT, "0x4cef52", {},
]);
console.log("\npm_getPaymasterData ->", JSON.stringify(final.body).slice(0, 700));

// Control: the same account doing a plain native send, which W1 already proved is sponsored.
const controlCallData = encodeFunctionData({
  abi: [{ name: "execute", type: "function", stateMutability: "payable",
          inputs: [{ name: "target", type: "address" }, { name: "value", type: "uint256" },
                   { name: "data", type: "bytes" }], outputs: [] }],
  functionName: "execute",
  args: ["0x0000000C984AFf541D6cE86Bb697e68ec57873C8", 10000000000000000n, "0x"],
});
const control = await rpc("pm_getPaymasterData", [
  {
    sender: MSCA, nonce: "0x0", callData: controlCallData,
    callGasLimit: "0x30d40", verificationGasLimit: "0x30d40", preVerificationGas: "0xc350",
    maxFeePerGas: "0x3b9aca00", maxPriorityFeePerGas: "0x3b9aca00",
    paymasterVerificationGasLimit: "0x186a0", paymasterPostOpGasLimit: "0xbb8", signature: "0x",
  },
  ENTRY_POINT, "0x4cef52", {},
]);
console.log("\ncontrol (plain execute) ->", JSON.stringify(control.body).slice(0, 400));

/** Whether an answer carries a paymaster signature, without trusting its shape. */
const paymasterIn = (body: unknown): boolean => {
  if (typeof body !== "object" || body === null) return false;
  const result = (body as { result?: unknown }).result;
  if (typeof result !== "object" || result === null) return false;
  return Boolean((result as { paymaster?: unknown }).paymaster);
};

/**
 * Does any of the above mean anything?
 *
 * A paymaster that signs everything tells you nothing by signing yours. Before reading a
 * `paymaster` field as approval, check what it does with input it should obviously refuse.
 */
const sponsored = async (label: string, sender: string, data: string): Promise<boolean> => {
  const r = await rpc("pm_getPaymasterData", [
    {
      sender, nonce: "0x0", callData: data,
      callGasLimit: "0x30d40", verificationGasLimit: "0x30d40", preVerificationGas: "0xc350",
      maxFeePerGas: "0x3b9aca00", maxPriorityFeePerGas: "0x3b9aca00",
      paymasterVerificationGasLimit: "0x186a0", paymasterPostOpGasLimit: "0xbb8", signature: "0x",
    },
    ENTRY_POINT, "0x4cef52", {},
  ]);
  const verdict = paymasterIn(r.body) ? "signed" : "refused";
  console.log(`  ${label.padEnd(34)} ${verdict}`);
  return verdict === "signed";
};

console.log("\ndiscrimination check — input the paymaster ought to refuse:");
const nonsense = [
  await sponsored("garbage calldata, dead address", "0x000000000000000000000000000000000000dEaD", "0xdeadbeef"),
  await sponsored("empty calldata, random address", "0x1111111111111111111111111111111111111111", "0x"),
];

console.log(
  nonsense.every(Boolean)
    ? "\nCONCLUSION: the paymaster signs anything at this stage, so nothing above is evidence\n" +
      "that installPlugin is sponsored. Only submitting a real userOp settles it."
    : "\nCONCLUSION: the paymaster does discriminate here, so the installPlugin result is meaningful.",
);
