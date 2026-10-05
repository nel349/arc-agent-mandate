/**
 * A mandate on Monad testnet, end to end, against the live chain and Circle's live bundler and
 * paymaster: the same plugin, the same grant shape and the same session-key account the app and the
 * connector use on Arc, pointed at Monad and metering MON on the native rail.
 *
 * A fresh Circle wallet is owned by a plain key here rather than a passkey, so it runs without a phone;
 * the account, the plugin and everything the chain enforces are the same as for a passkey owner.
 *
 *   POD_FUNDER_KEY=0x… bun scripts/prove-monad.ts
 *
 * The funder sends the new wallet a little MON to spend. Nothing else is paid by anybody but Circle.
 */
import { getModularWalletAddress, getUserOperationGasPrice, toCircleModularWalletClient, toCircleSmartAccount } from "@circle-fin/modular-wallets-core";
import {
  createPublicClient, createWalletClient, defineChain, encodeAbiParameters, encodeFunctionData, formatEther, http, keccak256,
  parseAbi, parseAbiParameters, parseEther, toHex, type Address, type Hex,
} from "viem";
import { createBundlerClient } from "viem/account-abstraction";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { circleTransport } from "../mcp/bundler.ts";
import { toSessionKeyAccount } from "@kuiralabs/mandate-core";

const monadTestnet = defineChain({
  id: 10143, name: "Monad testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
});

// The connector's own way to Circle, with the published testnet key it already carries, on Monad's path.
// Circle's browser transport needs a window; the connector's runs where an agent runs.
process.env.ARC_CIRCLE_CHAIN_PATH = "monadTestnet";

const SESSION_KEY_PLUGIN: Address = "0x669Dd1eDb85ABD00f74186d88124614EE81E6670";
const OWNER_PLUGIN: Address = "0x0000000C984AFf541D6cE86Bb697e68ec57873C8";
const USER_OP_VALIDATION_OWNER = 0;
const HIGHEST_REAL_LIMIT = 2n ** 256n - 2n;
const ALLOWLIST = 0;

const LIMIT = parseEther("0.01");
const PAYMENT = parseEther("0.004");
const FUNDING = parseEther("0.02");

const accountAbi = parseAbi([
  "function installPlugin(address plugin, bytes32 manifestHash, bytes pluginInstallData, (address plugin, uint8 functionId)[] dependencies)",
]);
const pluginAbi = parseAbi([
  "function sessionKeysOf(address account) view returns (address[])",
  "function getNativeTokenSpendLimitInfo(address account, address sessionKey) view returns ((bool hasLimit,uint256 limit,uint256 limitUsed,uint48 refreshInterval,uint48 lastUsedTime))",
]);
const updatesAbi = parseAbi([
  "function updateAccessListAddressEntry(address contractAddress, bool isOnList, bool checkSelectors)",
  "function setAccessListType(uint8 contractAccessControlType)",
  "function setNativeTokenSpendLimit(uint256 spendLimit, uint48 refreshInterval)",
  "function setGasSpendLimit(uint256 spendLimit, uint48 refreshInterval)",
]);
const manifestAbi = parseAbi(["function pluginManifest() view returns (bytes)"]);

/**
 * The grant deploys the wallet and installs the plugin in one operation, so it is heavier than a spend.
 * Fixed rather than estimated: the connector's plain transport to Circle does not estimate, and the
 * paymaster pays for the headroom.
 */
const GRANT_GAS = {
  callGasLimit: 1_500_000n, verificationGasLimit: 1_500_000n, preVerificationGas: 150_000n,
  paymasterVerificationGasLimit: 150_000n, paymasterPostOpGasLimit: 20_000n,
};

/** The agent's own operations cannot be estimated (the stub signature recovers a stranger), as on Arc. */
const AGENT_GAS = {
  callGasLimit: 500_000n, verificationGasLimit: 500_000n, preVerificationGas: 100_000n,
  paymasterVerificationGasLimit: 150_000n, paymasterPostOpGasLimit: 20_000n,
};

const funderKey = process.env.POD_FUNDER_KEY;
if (!funderKey || !/^0x[0-9a-fA-F]{64}$/.test(funderKey)) throw new Error("POD_FUNDER_KEY has to hold a funded Monad testnet key");

const transport = circleTransport();
const circle = createPublicClient({ chain: monadTestnet, transport });
const chain = createPublicClient({ chain: monadTestnet, transport: http() });

/** Kept between runs, so a run that stops partway resumes with the wallet it already funded. */
const KEYS_FILE = process.env.PROVE_KEYS_FILE ?? join(homedir(), ".arc-mandate", "prove-monad.json");
const kept: Record<string, Hex> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, "utf8")) : {};
for (const role of ["owner", "agent", "payee", "stranger"]) kept[role] ??= generatePrivateKey();
mkdirSync(dirname(KEYS_FILE), { recursive: true, mode: 0o700 });
writeFileSync(KEYS_FILE, JSON.stringify(kept), { mode: 0o600 });
const owner = privateKeyToAccount(kept.owner as Hex);
const agent = privateKeyToAccount(kept.agent as Hex);
const payee = privateKeyToAccount(kept.payee as Hex).address;
const stranger = privateKeyToAccount(kept.stranger as Hex).address;

// what is sent to Circle and what it answers, method by method, when PROVE_TRACE is set
if (process.env.PROVE_TRACE) {
  const send = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const answer = await send(input, init);
    if (String(input).includes("circle.com")) {
      const body = typeof init?.body === "string" ? init.body : "";
      console.log(`→ ${body.slice(0, 1500)}`);
      console.log(`← ${(await answer.clone().text()).slice(0, 400)}`);
    }
    return answer;
  }) as typeof fetch;
}

const say = (line: string): void => console.log(line);

async function fees(bundler: Parameters<typeof getUserOperationGasPrice>[0]) {
  const price = await getUserOperationGasPrice(bundler);
  // Circle's bundler takes a bare estimate into its pool and never includes it (mcp/spend.ts): bid twice
  return { maxFeePerGas: BigInt(price.medium.maxFeePerGas) * 2n, maxPriorityFeePerGas: BigInt(price.medium.maxPriorityFeePerGas) * 2n };
}

/** The two limits Circle's bundler on Monad names when it refuses an operation's gas. */
interface GasAsked {
  readonly preVerificationGas?: bigint;
  readonly verificationGasLimit?: bigint;
}

/**
 * What the bundler asked for instead, when it refused the gas. Monad bills the whole limit, so its
 * bundler wants preVerificationGas in the millions, and refuses a verification limit so generous that
 * under 40% of it is used: the used part is worked out from the share it reports, and asked for with
 * room to spare (used / 0.6).
 */
function gasAsked(cause: unknown, verificationGasLimit: bigint): GasAsked | undefined {
  const text = cause instanceof Error ? cause.message : String(cause);
  const least = /preVerificationGas is \d+ but must be at least (\d+)/.exec(text);
  if (least?.[1]) return { preVerificationGas: (BigInt(least[1]) * 11n) / 10n };
  const share = /Verification gas limit efficiency too low\. Required: [0-9.]+, Actual: ([0-9.]+)/.exec(text);
  if (share?.[1]) {
    const used = (verificationGasLimit * BigInt(Math.round(Number(share[1]) * 1_000_000))) / 1_000_000n;
    return { verificationGasLimit: (used * 10n) / 6n };
  }
  return undefined;
}

/** Send, and while the bundler names other gas, send again with what it named: at most a few times. */
async function sendTaking<T>(start: GasAsked & { readonly verificationGasLimit: bigint }, send: (gas: GasAsked) => Promise<T>): Promise<T> {
  let gas: GasAsked & { verificationGasLimit: bigint } = { ...start };
  for (let tries = 0; ; tries++) {
    try {
      return await send(gas);
    } catch (cause) {
      const asked = gasAsked(cause, gas.verificationGasLimit);
      if (asked === undefined || tries >= 3) throw cause;
      gas = { ...gas, ...asked };
      say(`  the bundler asks for other gas; sending with preVerificationGas ${gas.preVerificationGas ?? "as before"}, verificationGasLimit ${gas.verificationGasLimit}`);
    }
  }
}

async function manifestHash(): Promise<Hex> {
  // the hash installPlugin checks, read from the plugin itself rather than carried from Arc's build
  const manifest = await chain.call({ to: SESSION_KEY_PLUGIN, data: encodeFunctionData({ abi: manifestAbi, functionName: "pluginManifest" }) });
  if (!manifest.data) throw new Error("the plugin answered no manifest");
  return keccak256(manifest.data);
}

// 1. A Circle wallet on Monad, and some MON in it to spend
// Circle registers a wallet only through its browser transport; over the connector's, it is asked to
// directly, or its bundler answers that it cannot find the wallet
const registered = await getModularWalletAddress({ client: toCircleModularWalletClient({ client: circle }), owner });
const wallet = await toCircleSmartAccount({ client: circle, owner, address: registered.address });
say(`wallet ${wallet.address}, owner ${owner.address}, agent ${agent.address}`);
const funder = createWalletClient({ account: privateKeyToAccount(funderKey as Hex), chain: monadTestnet, transport: http() });
if ((await chain.getBalance({ address: wallet.address })) < FUNDING) {
  await chain.waitForTransactionReceipt({ hash: await funder.sendTransaction({ to: wallet.address, value: FUNDING }) });
}
say(`holds ${formatEther(await chain.getBalance({ address: wallet.address }))} MON`);

// 2. The grant: the plugin installed with the agent's key, a limit on MON, and one payee allowed
const owners = createBundlerClient({ account: wallet, client: circle, transport, paymaster: true });
const updates: Hex[] = [
  encodeFunctionData({ abi: updatesAbi, functionName: "setAccessListType", args: [ALLOWLIST] }),
  encodeFunctionData({ abi: updatesAbi, functionName: "updateAccessListAddressEntry", args: [payee, true, false] }),
  encodeFunctionData({ abi: updatesAbi, functionName: "setNativeTokenSpendLimit", args: [LIMIT, 0] }),
  encodeFunctionData({ abi: updatesAbi, functionName: "setGasSpendLimit", args: [HIGHEST_REAL_LIMIT, 0] }),
];
const alreadyGranted = (await chain.getCode({ address: wallet.address })) !== undefined
  && (await chain.readContract({ address: SESSION_KEY_PLUGIN, abi: pluginAbi, functionName: "sessionKeysOf", args: [wallet.address] }))
    .some((key) => key.toLowerCase() === agent.address.toLowerCase());
if (alreadyGranted) say("grant: already made on an earlier run");
else {
  const tag = keccak256(toHex("prove-monad"));
  const install = encodeFunctionData({
    abi: accountAbi, functionName: "installPlugin",
    args: [
      SESSION_KEY_PLUGIN, await manifestHash(),
      encodeAbiParameters(parseAbiParameters("address[], bytes32[], bytes[][]"), [[agent.address], [tag], [updates]]),
      [{ plugin: OWNER_PLUGIN, functionId: USER_OP_VALIDATION_OWNER }],
    ],
  });
  const granted = await owners.waitForUserOperationReceipt({
    hash: await sendTaking(GRANT_GAS, async (gas) => owners.sendUserOperation({
      account: wallet, callData: install, ...GRANT_GAS, ...gas, ...(await fees(owners)),
    })),
  });
  say(`grant: ${granted.success ? "landed" : "FAILED"} in ${granted.receipt.transactionHash}, gas paid by ${granted.paymaster ?? "nobody"}`);
}
const keys = await chain.readContract({ address: SESSION_KEY_PLUGIN, abi: pluginAbi, functionName: "sessionKeysOf", args: [wallet.address] });
say(`session keys of the wallet: ${keys.join(", ")}`);

// 3. The agent spends inside the limit, then is refused over it and to a payee the grant never named
const asAgent = await toSessionKeyAccount({ address: wallet.address, agent, client: circle });
const agents = createBundlerClient({ account: asAgent, client: circle, transport, paymaster: true });

/** what the bundler last accepted for the agent's gas, carried from one payment to the next */
let agentGas: GasAsked & { verificationGasLimit: bigint } = { verificationGasLimit: AGENT_GAS.verificationGasLimit };

async function spend(to: Address, value: bigint, what: string): Promise<void> {
  try {
    const receipt = await agents.waitForUserOperationReceipt({
      hash: await sendTaking(agentGas, async (gas) => {
        agentGas = { ...agentGas, ...gas };
        return agents.sendUserOperation({ account: asAgent, calls: [{ to, value }], ...AGENT_GAS, ...gas, ...(await fees(agents)) });
      }),
    });
    say(`${what}: ${receipt.success ? "paid" : "included and refused when it ran"} (${receipt.receipt.transactionHash}, gas by ${receipt.paymaster ?? "nobody"})`);
  } catch (cause) {
    const why = cause instanceof Error ? (cause.message.split("\n").find((line) => /AA\d\d|revert|reason/i.test(line)) ?? cause.message.split("\n")[0]) : String(cause);
    say(`${what}: refused before it ran (${why?.trim().slice(0, 160)})`);
  }
}

await spend(payee, PAYMENT, "first payment, inside the limit");
await spend(payee, PAYMENT, "second payment, inside the limit");
await spend(payee, PAYMENT, "third payment, over the limit");
await spend(stranger, parseEther("0.001"), "a payment to an address the grant never named");

const meter = await chain.readContract({ address: SESSION_KEY_PLUGIN, abi: pluginAbi, functionName: "getNativeTokenSpendLimitInfo", args: [wallet.address, agent.address] });
say(`limit ${formatEther(meter.limit)} MON, used ${formatEther(meter.limitUsed)} MON`);
say(`payee holds ${formatEther(await chain.getBalance({ address: payee }))} MON, stranger ${formatEther(await chain.getBalance({ address: stranger }))} MON`);
say(`wallet holds ${formatEther(await chain.getBalance({ address: wallet.address }))} MON, agent ${formatEther(await chain.getBalance({ address: agent.address }))} MON`);
