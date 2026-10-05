/**
 * The connector itself, on Monad testnet, used the way an agent uses it: started with
 * ARC_MANDATE_NETWORK=monadTestnet, asked for its pairing code, granted an allowance carrying that code
 * by a Circle wallet, then asked what it may spend and told to pay, inside the limit and past it.
 *
 * The owner's side is the core package's own pieces: the grant's encoding, the transport to Circle and
 * the gas corrections, with Circle's library only for the owner's account. The wallet is the one
 * scripts/prove-monad.ts made and funded, kept in ~/.arc-mandate/prove-monad.json.
 *
 *   bun scripts/prove-connector-monad.ts
 */
import { getModularWalletAddress, getUserOperationGasPrice, toCircleModularWalletClient, toCircleSmartAccount } from "@circle-fin/modular-wallets-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CIRCLE_SHARED_TESTNET, circleTransport, grantCallData, identityCalls, MONAD_TESTNET, sendCorrectingGas } from "@kuiralabs/mandate-core";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, defineChain, formatEther, getAddress, http, parseAbi, parseEther, type Hex } from "viem";
import { createBundlerClient } from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";

const say = (line: string): void => console.log(line);
const LIMIT = parseEther("0.005");

const monad = defineChain({
  id: MONAD_TESTNET.chainId, name: MONAD_TESTNET.name, nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [MONAD_TESTNET.rpc] } },
});
const chain = createPublicClient({ chain: monad, transport: http() });
const transport = circleTransport(MONAD_TESTNET, CIRCLE_SHARED_TESTNET);
const circle = createPublicClient({ chain: monad, transport });

// the owner and the payee the first proof made, and the wallet it funded
const keysFile = join(homedir(), ".arc-mandate", "prove-monad.json");
if (!existsSync(keysFile)) throw new Error(`run scripts/prove-monad.ts first: it makes and funds the wallet in ${keysFile}`);
const kept = JSON.parse(readFileSync(keysFile, "utf8")) as Record<string, Hex>;
const owner = privateKeyToAccount(kept.owner as Hex);
const payee = privateKeyToAccount(kept.payee as Hex).address;
const registered = await getModularWalletAddress({ client: toCircleModularWalletClient({ client: circle }), owner });
const wallet = await toCircleSmartAccount({ client: circle, owner, address: registered.address });
say(`wallet ${wallet.address} holds ${formatEther(await chain.getBalance({ address: wallet.address }))} MON`);

// 1. the connector, started for Monad, with a key and memory of its own kept between runs
const home = process.env.PROVE_CONNECTOR_HOME ?? join(homedir(), ".arc-mandate", "prove-connector-monad");
mkdirSync(home, { recursive: true, mode: 0o700 });
const env: Record<string, string> = {};
for (const [name, value] of Object.entries(process.env)) if (value !== undefined) env[name] = value;
const connector = new Client({ name: "prove-connector-monad", version: "0" });
await connector.connect(new StdioClientTransport({
  command: "node",
  args: [
    "--conditions=mandate-source", "--experimental-transform-types", "--disable-warning=ExperimentalWarning",
    join(dirname(fileURLToPath(import.meta.url)), "..", "mcp", "server.ts"),
  ],
  env: {
    ...env,
    ARC_MANDATE_NETWORK: "monadTestnet",
    ARC_MANDATE_KEY_PATH: join(home, "agent.key"),
    ARC_MANDATE_ACCOUNT_PATH: join(home, "accounts.json"),
  },
  stderr: "ignore",
}));
const ask = async (name: string, args: Record<string, string> = {}): Promise<string> => {
  const result = await connector.callTool({ name, arguments: args });
  return (result.content as { readonly text?: string }[]).map((part) => part.text ?? "").join("\n");
};

try {
  const shown = await ask("get_pairing_address");
  const link = /ethereum:(0x[0-9a-fA-F]{40})@(\d+)\?pairing=([0-9a-f]{32})/.exec(shown);
  if (!link?.[1] || !link[3]) throw new Error(`the connector showed no pairing link: ${shown.slice(0, 300)}`);
  const agent = getAddress(link[1]);
  say(`the connector's agent ${agent}, on chain ${link[2]}, shows pairing code ${link[3]}`);

  // 2. the owner grants it, carrying the code, payable to one address only
  const keys = await chain.readContract({
    address: MONAD_TESTNET.contracts.sessionKeyPlugin, abi: parseAbi(["function sessionKeysOf(address) view returns (address[])"]),
    functionName: "sessionKeysOf", args: [wallet.address],
  });
  if (keys.some((key) => key.toLowerCase() === agent.toLowerCase())) {
    say("grant: the agent already holds one from an earlier run");
  } else {
    const owners = createBundlerClient({ account: wallet, client: circle, transport, paymaster: true });
    const price = await getUserOperationGasPrice(owners);
    const fees = { maxFeePerGas: BigInt(price.medium.maxFeePerGas) * 2n, maxPriorityFeePerGas: BigInt(price.medium.maxPriorityFeePerGas) * 2n };
    const callData = grantCallData(MONAD_TESTNET, { agent, limit: LIMIT, payees: [payee], calls: [identityCalls(MONAD_TESTNET)], pairing: link[3] }, true);
    const { sent } = await sendCorrectingGas(MONAD_TESTNET.gas.grant, (gas) => owners.sendUserOperation({ account: wallet, callData, ...gas, ...fees }));
    const granted = await owners.waitForUserOperationReceipt({ hash: sent });
    say(`grant: ${granted.success ? "landed" : "FAILED"} in ${granted.receipt.transactionHash}, gas by ${granted.paymaster}`);
  }

  // 3. the agent, through the connector: what may it spend, and paying inside the limit and past it
  say(`\n--- check_allowance\n${await ask("check_allowance")}`);
  say(`\n--- pay 0.002 MON\n${await ask("pay", { to: payee, amount: "0.002", reason: "proving the connector on Monad" })}`);
  say(`\n--- pay 0.004 MON, past what is left\n${await ask("pay", { to: payee, amount: "0.004", reason: "past the limit" })}`);
  say(`\n--- check_allowance\n${await ask("check_allowance")}`);
  say(`\npayee holds ${formatEther(await chain.getBalance({ address: payee }))} MON`);
} finally {
  await connector.close();
}
