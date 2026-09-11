import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import {
  createPublicClient, createWalletClient, encodeFunctionData, formatEther, http, keccak256, parseAbi,
  parseAbiItem, parseEventLogs, toHex, type Address, type Hex,
} from "viem";
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

const seed = (role: string): Hex => keccak256(toHex(`kuiralabs.arc-agent-mandate.integration.${role}`));
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

let anvil: ChildProcess | null = null;

/**
 * The deployed plugin, which does not exist until the fork is up.
 *
 * Behind an accessor rather than an exported `let` so that reading it before `start()` is a
 * sentence about the harness rather than a revert from a call to the zero address, which is what
 * an undefined address looks like from the chain's side.
 */
let plugin: Address | null = null;
export function pluginAddress(): Address {
  if (plugin === null) throw new Error("start() has not run, so no plugin is deployed yet.");
  return plugin;
}

interface RpcReply {
  readonly result?: unknown;
  readonly error?: { readonly message: string };
}

const rpc = (method: string, params: readonly unknown[]): Promise<RpcReply> =>
  fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((r) => r.json() as Promise<RpcReply>);

export const balance = (address: Address): Promise<bigint> => publicClient.getBalance({ address });
export const usdc = async (address: Address): Promise<string> => formatEther(await balance(address));

/** Anvil's own snapshot, so each test starts from the same granted mandate without re-forking. */
export const snapshot = async (): Promise<string> => {
  const { result } = await rpc("evm_snapshot", []);
  if (typeof result !== "string") throw new Error(`anvil returned no snapshot id: ${String(result)}`);
  return result;
};
export const revert = (id: string): Promise<RpcReply> => rpc("evm_revert", [id]);

export interface Fork {
  /** The native spend limit the demo script grants, in wei. */
  readonly mandate?: bigint;
  readonly walletBalance?: bigint;
}

export async function start({ mandate = 10n * 10n ** 18n, walletBalance = 500n * 10n ** 18n }: Fork = {}): Promise<Address> {
  /**
   * Every one of these files runs a whole forked chain, and they all use this port.
   *
   * `node --test` runs files concurrently by default, so they were starting on top of each other:
   * one file's `stop()` killed the node another file was mid-test against, and the survivors
   * reported `ECONNREFUSED` from somewhere that looked nothing like the cause. Thirteen tests
   * cancelled, no failures, exit 1 — and green whenever the scheduling happened to be kind.
   *
   * The suite is serial now (`--test-concurrency=1`). This is the check that says so out loud if
   * that ever comes undone, because the symptom otherwise points anywhere but here.
   */
  const alreadyThere = await publicClient.getBlockNumber().then(() => true).catch(() => false);
  if (alreadyThere) {
    throw new Error(
      `Something is already serving ${RPC}. These tests each run their own forked chain on that ` +
      `port, so two at once fight over it and kill each other. Run them serially ` +
      `(--test-concurrency=1), or set ANVIL_PORT.`,
    );
  }

  const complaints: string[] = [];
  anvil = spawn("anvil", ["--fork-url", ARC_RPC, "--fork-block-number", String(FORK_BLOCK),
                          "--port", String(PORT), "--silent"],
                { stdio: ["ignore", "ignore", "pipe"] });
  // Kept rather than discarded: a node that refuses to start explains itself here and nowhere else,
  // and throwing that away is what made a port collision look like a network fault.
  anvil.stderr?.on("data", (chunk: Buffer) => { complaints.push(chunk.toString()); });

  let up = false;
  for (let i = 0; i < 60; i++) {
    try { await publicClient.getBlockNumber(); up = true; break; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  if (!up) {
    // Said here rather than left to surface as ECONNREFUSED from the first call that needed it.
    throw new Error(
      `anvil did not answer on ${RPC} within 30s.` +
      (complaints.length > 0 ? `\n${complaints.join("")}` : " It printed nothing."),
    );
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
  const deployed = out.match(/plugin\s+:\s+(0x[0-9a-fA-F]{40})/)?.[1];
  if (deployed === undefined) throw new Error(`the setup script printed no plugin address:\n${out}`);
  plugin = deployed as Address;
  return plugin;
}

export async function stop(): Promise<void> {
  anvil?.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 200));
}

/** Owner-level actions. On a phone these are a Face ID prompt; here the fork impersonates the
 *  EntryPoint, which is the only caller the account accepts for mandate management. */
export async function asOwner(data: Hex) {
  const res = await rpc("eth_sendTransaction", [{ from: ENTRY_POINT, to: MSCA, data, gas: "0x2dc6c0" }]);
  if (res.error) throw new Error(res.error.message);
  if (typeof res.result !== "string") throw new Error(`no transaction hash came back: ${String(res.result)}`);
  return publicClient.waitForTransactionReceipt({ hash: res.result as Hex });
}

const pack = (hi: bigint, lo: bigint): Hex =>
  `0x${((hi << 128n) | lo).toString(16).padStart(64, "0")}`;

/**
 * The EntryPoint's record of one operation, which says whether its calls ran.
 *
 * `handleOps` succeeds whenever validation passes, even when the operation's own calls then revert:
 * the EntryPoint catches that, charges for it, and reports it here. So a mined `handleOps` is not an
 * accepted spend, and reading it as one is how a refusal at execution looks like a success.
 */
const userOperationEvent = parseAbiItem(
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
);

/** One call in a batch, as `executeWithSessionKey` takes it. */
export interface Call {
  readonly target: Address;
  readonly value: bigint;
  readonly data: Hex;
}

export interface Spend {
  readonly calls: readonly Call[];
  /** Whose key signs. Defaults to the granted agent; a test passes another to be refused. */
  readonly key?: Hex;
}

/**
 * One operation, signed by a session key, through the real EntryPoint.
 *
 * Throws REFUSED when the mandate rejects it during validation, so nothing runs and nothing moves.
 * Throws REVERTED when validation accepted it and its calls then reverted: the mandate allowed it,
 * and something while it ran did not. Returns the receipt only when its calls ran.
 */
export async function spend({ calls, key = AGENT_PK }: Spend) {
  const signer = privateKeyToAccount(key);
  const callData = encodeFunctionData({
    abi: pluginAbi, functionName: "executeWithSessionKey", args: [calls, signer.address],
  });
  const nonce = await publicClient.readContract({
    address: ENTRY_POINT, abi: entryPointAbi, functionName: "getNonce",
    args: [MSCA, BigInt(signer.address)],
  });
  const unsigned = {
    sender: MSCA, nonce, initCode: "0x", callData,
    accountGasLimits: pack(500_000n, 500_000n), preVerificationGas: 100_000n,
    gasFees: pack(1_000_000_000n, 1_000_000_000n), paymasterAndData: "0x", signature: "0x",
  } as const;
  const hash = await publicClient.readContract({
    address: ENTRY_POINT, abi: entryPointAbi, functionName: "getUserOpHash", args: [unsigned],
  });
  // A new object rather than a mutated one: the hash is over the unsigned operation, and a field
  // that changes after it is hashed is the classic way to sign something other than what is sent.
  const userOp = { ...unsigned, signature: await signer.signMessage({ message: { raw: hash } }) };

  let txHash: Hex;
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
  const [operation] = parseEventLogs({ abi: [userOperationEvent], logs: receipt.logs });
  if (operation === undefined) throw new Error("handleOps landed without reporting the operation");
  if (!operation.args.success) throw new Error("REVERTED");
  return receipt;
}

export const pay = (to: Address, value: bigint) => spend({ calls: [{ target: to, value, data: "0x" }] });

export const permissions = (updates: readonly Hex[]) =>
  asOwner(encodeFunctionData({
    abi: pluginAbi, functionName: "updateKeyPermissions", args: [agent.address, updates],
  }));

/** Takes a key's allowance away, as the owner. The granted agent's unless another is named. */
export async function revokeAgent(key: Address = agent.address) {
  const predecessor = await publicClient.readContract({
    address: pluginAddress(), abi: pluginAbi, functionName: "findPredecessor", args: [MSCA, key],
  });
  return asOwner(encodeFunctionData({
    abi: pluginAbi, functionName: "removeSessionKey", args: [key, predecessor],
  }));
}

/** Gives an address native USDC to pay gas with, so it can act on the fork in its own right. */
export async function fund(address: Address, wei: bigint = 10n ** 18n): Promise<void> {
  const { error } = await rpc("anvil_setBalance", [address, "0x" + wei.toString(16)]);
  if (error) throw new Error(error.message);
}

/** Moves the chain forward by empty blocks, for anything that depends on how far apart blocks are. */
export async function mine(blocks: number): Promise<void> {
  const { error } = await rpc("anvil_mine", ["0x" + blocks.toString(16)]);
  if (error) throw new Error(error.message);
}

/** Enough gas for any one management call on the account; the call is simulated, so none is spent. */
const REFUSAL_CALL_GAS = 3_000_000n;

/**
 * What the account answers when the owner asks it to do something it refuses.
 *
 * `asOwner` sends and mines, so a refusal arrives as a reverted receipt with its reason gone. This
 * asks the same question as a call, which is where the node reports why, and returns that report
 * whole. Throws if the account would accept, because a test asking this expects a refusal.
 */
export async function ownerRefusal(data: Hex): Promise<string> {
  const reply = await rpc("eth_call", [{ from: ENTRY_POINT, to: MSCA, data, gas: toHex(REFUSAL_CALL_GAS) }, "latest"]);
  if (reply.error === undefined) throw new Error("the account accepted what the test expected it to refuse");
  return JSON.stringify(reply.error);
}

export const sessionKeys = () =>
  publicClient.readContract({
    address: pluginAddress(), abi: pluginAbi, functionName: "sessionKeysOf", args: [MSCA],
  });

export const mandateInfo = () =>
  publicClient.readContract({
    address: pluginAddress(), abi: pluginAbi, functionName: "getNativeTokenSpendLimitInfo",
    args: [MSCA, agent.address],
  });
