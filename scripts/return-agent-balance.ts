#!/usr/bin/env node
/**
 * Send an agent's balance back to the account that granted it.
 *
 *   node scripts/return-agent-balance.ts <account address>
 *
 * Agents are not supposed to hold anything: they hand their operations to a bundler and the
 * paymaster covers them, so an allowance is authority and never a balance. Earlier grants sent a
 * submission float, and that money is stranded — the granting account has no claim on it, because
 * it belongs to the agent's own key. Only this key can give it back, which is exactly what this
 * does.
 *
 * It leaves nothing behind: the transfer is sized to the balance minus the gas of the transfer
 * itself, so the agent ends at zero rather than at another, smaller pile of dust.
 */
import { createPublicClient, createWalletClient, defineChain, formatEther, http, isAddress, type Address } from "viem";
import { loadOrCreateAgent } from "../mcp/identity.ts";

const arc = defineChain({
  id: 5042002,
  name: "Arc testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network"] } },
});

const argument = process.argv[2];
if (argument === undefined || !isAddress(argument)) {
  console.error("Usage: node scripts/return-agent-balance.ts <account address>\n\n" +
    "The account to return to — the wallet that granted this agent its allowance.");
  process.exit(1);
}
const to: Address = argument;

const { account: agent, path } = loadOrCreateAgent();
const publicClient = createPublicClient({ chain: arc, transport: http() });
const balance = await publicClient.getBalance({ address: agent.address });

console.log("agent   :", agent.address, `(${path})`);
console.log("holds   :", formatEther(balance), "USDC");
if (balance === 0n) {
  console.log("\nNothing to return — which is how it should look.");
  process.exit(0);
}

// Priced from the chain: Arc's base fee has been seen at 20 and at 45 gwei.
const fees = await publicClient.estimateFeesPerGas();

/**
 * Estimated, not assumed to be 21,000.
 *
 * The destination is usually a smart account, and a plain transfer to a contract runs its
 * `receive` function — which costs more than the 21,000 an account-to-account transfer does. A
 * hardcoded 21,000 reverts, and a reverted transfer still burns the gas it was given, so the
 * agent ends up with slightly *less* and still holding the rest.
 */
const gas = (await publicClient.estimateGas({
  account: agent, to, value: balance / 2n,
})) * 12n / 10n; // headroom, since the final value differs from the one estimated against
const cost = gas * fees.maxFeePerGas;
if (balance <= cost) {
  console.error(`\nThe balance (${formatEther(balance)}) will not cover the ${formatEther(cost)} ` +
    "it costs to send it. Leaving it where it is.");
  process.exit(1);
}

const value = balance - cost;
console.log("returns :", formatEther(value), "USDC to", to);
console.log("gas     :", formatEther(cost), "USDC");

const wallet = createWalletClient({ account: agent, chain: arc, transport: http() });
const hash = await wallet.sendTransaction({
  to, value, gas, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
});
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log("\ntx      :", hash, `(${receipt.status})`);
console.log("agent   :", formatEther(await publicClient.getBalance({ address: agent.address })), "USDC left");
