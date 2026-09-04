import { spawn, execFileSync } from "node:child_process";
import { createPublicClient, createWalletClient, encodeFunctionData, formatEther, http, keccak256, parseAbi, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * A real Arc, locally.
 *
 * These tests drive the same path the demo does -- a signed ERC-4337 user operation through the
 * real EntryPoint, into the real Circle account, validated by our plugin -- because that is the
 * path a user's money actually takes. The Solidity tests stop at `userOpValidationFunction`; they
 * cannot tell you whether money moved, whether a refusal cost anything, or whether revocation
 * takes effect. This can.
 */
const ARC_RPC = "https://rpc.testnet.arc.network";
const FORK_BLOCK = 60219238;
export const PORT = Number(process.env.ANVIL_PORT ?? 8546);
export const RPC = `http://127.0.0.1:${PORT}`;

export const MSCA = "0xa8546Ff7D7Fcd3BBd08C0ef31E74C73DF6BcC447";
export const MULTISIG = "0x0000000C984AFf541D6cE86Bb697e68ec57873C8";
export const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
export const USDC_ERC20_VIEW = "0x3600000000000000000000000000000000000000";

const seed = (role) => keccak256(toHex(`kuiralabs.arc-agent-mandate.integration.${role}`));
export const AGENT_PK = seed("agent");
export const OUTSIDER_PK = seed("outsider");
export const agent = privateKeyToAccount(AGENT_PK);
export const outsider = privateKeyToAccount(OUTSIDER_PK);
export const PAYEE = privateKeyToAccount(seed("payee")).address;
export const STRANGER = privateKeyToAccount(seed("stranger")).address;
const submitter = privateKeyToAccount(seed("submitter"));

export const entryPointAbi = parseAbi([
  "function getNonce(address sender, uint192 key) view returns (uint256)",
  "function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)",
  "function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops, address beneficiary)",
]);
export const pluginAbi = parseAbi([
  "function executeWithSessionKey((address target,uint256 value,bytes data)[] calls, address sessionKey) returns (bytes[])",
  "function sessionKeysOf(address account) view returns (address[])",
  "function isSessionKeyOf(address account, address sessionKey) view returns (bool)",
  "function findPredecessor(address account, address sessionKey) view returns (bytes32)",
  "function removeSessionKey(address sessionKey, bytes32 predecessor)",
  "function updateKeyPermissions(address sessionKey, bytes[] updates)",
  "function getNativeTokenSpendLimitInfo(address account, address sessionKey) view returns ((bool hasLimit,uint256 limit,uint256 limitUsed,uint48 refreshInterval,uint48 lastUsedTime))",
]);
export const updatesAbi = parseAbi([
  "function updateAccessListAddressEntry(address contractAddress, bool isOnList, bool checkSelectors)",
  "function setNativeTokenSpendLimit(uint256 spendLimit, uint48 refreshInterval)",
  "function setGasSpendLimit(uint256 spendLimit, uint48 refreshInterval)",
]);

export const publicClient = createPublicClient({ transport: http(RPC) });
const wallet = createWalletClient({ account: submitter, transport: http(RPC) });

let anvil;
export let PLUGIN;

const rpc = (method, params) =>
  fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((r) => r.json());

export const balance = (address) => publicClient.getBalance({ address });
export const usdc = async (address) => formatEther(await balance(address));

/** Anvil's own snapshot, so each test starts from the same granted mandate without re-forking. */
export const snapshot = async () => (await rpc("evm_snapshot", [])).result;
export const revert = (id) => rpc("evm_revert", [id]);

export async function start({ mandate = 10n * 10n ** 18n, walletBalance = 500n * 10n ** 18n } = {}) {
  anvil = spawn("anvil", ["--fork-url", ARC_RPC, "--fork-block-number", String(FORK_BLOCK),
                          "--port", String(PORT), "--silent"], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    try { await publicClient.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  await rpc("anvil_setBalance", [submitter.address, "0x" + (10n ** 20n).toString(16)]);
  await rpc("anvil_setBalance", [MSCA, "0x" + walletBalance.toString(16)]);
  await rpc("anvil_impersonateAccount", [ENTRY_POINT]);
  await rpc("anvil_setBalance", [ENTRY_POINT, "0x" + (10n ** 18n).toString(16)]);

  const out = execFileSync("forge", [
    "script", "script/SetupDemo.s.sol", "--rpc-url", RPC, "--broadcast", "--unlocked",
    "--sender", ENTRY_POINT,
  ], {
    cwd: new URL("../contracts", import.meta.url).pathname,
    env: { ...process.env, AGENT_ADDRESS: agent.address, SELLER_ADDRESS: PAYEE,
           MANDATE_WEI: String(mandate), FOUNDRY_DISABLE_NIGHTLY_WARNING: "1" },
    encoding: "utf8",
  });
  PLUGIN = out.match(/plugin\s+:\s+(0x[0-9a-fA-F]{40})/)[1];
  return PLUGIN;
}

export async function stop() {
  anvil?.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 200));
}

/** Owner-level actions. On a phone these are a Face ID prompt; here the fork impersonates the
 *  EntryPoint, which is the only caller the account accepts for mandate management. */
export async function asOwner(data) {
  const res = await rpc("eth_sendTransaction", [{ from: ENTRY_POINT, to: MSCA, data, gas: "0x2dc6c0" }]);
  if (res.error) throw new Error(res.error.message);
  return publicClient.waitForTransactionReceipt({ hash: res.result });
}

const pack = (hi, lo) => "0x" + ((BigInt(hi) << 128n) | BigInt(lo)).toString(16).padStart(64, "0");

/** One purchase, signed by a session key, through the real EntryPoint. Throws REFUSED when the
 *  mandate rejects it -- which is a validation failure, so nothing is charged and nothing moves. */
export async function spend({ calls, key = AGENT_PK }) {
  const signer = privateKeyToAccount(key);
  const callData = encodeFunctionData({
    abi: pluginAbi, functionName: "executeWithSessionKey", args: [calls, signer.address],
  });
  const nonce = await publicClient.readContract({
    address: ENTRY_POINT, abi: entryPointAbi, functionName: "getNonce",
    args: [MSCA, BigInt(signer.address)],
  });
  const userOp = {
    sender: MSCA, nonce, initCode: "0x", callData,
    accountGasLimits: pack(500_000n, 500_000n), preVerificationGas: 100_000n,
    gasFees: pack(1_000_000_000n, 1_000_000_000n), paymasterAndData: "0x", signature: "0x",
  };
  const hash = await publicClient.readContract({
    address: ENTRY_POINT, abi: entryPointAbi, functionName: "getUserOpHash", args: [userOp],
  });
  userOp.signature = await signer.signMessage({ message: { raw: hash } });

  let txHash;
  try {
    txHash = await wallet.writeContract({
      address: ENTRY_POINT, abi: entryPointAbi, functionName: "handleOps",
      args: [[userOp], submitter.address], chain: null, gas: 3_000_000n,
    });
  } catch {
    throw new Error("REFUSED");
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error("REFUSED");
  return receipt;
}

export const pay = (to, value) => spend({ calls: [{ target: to, value, data: "0x" }] });

export const permissions = (updates) =>
  asOwner(encodeFunctionData({
    abi: pluginAbi, functionName: "updateKeyPermissions", args: [agent.address, updates],
  }));

export async function revokeAgent() {
  const predecessor = await publicClient.readContract({
    address: PLUGIN, abi: pluginAbi, functionName: "findPredecessor", args: [MSCA, agent.address],
  });
  return asOwner(encodeFunctionData({
    abi: pluginAbi, functionName: "removeSessionKey", args: [agent.address, predecessor],
  }));
}

export const sessionKeys = () =>
  publicClient.readContract({
    address: PLUGIN, abi: pluginAbi, functionName: "sessionKeysOf", args: [MSCA],
  });

export const mandateInfo = () =>
  publicClient.readContract({
    address: PLUGIN, abi: pluginAbi, functionName: "getNativeTokenSpendLimitInfo",
    args: [MSCA, agent.address],
  });
