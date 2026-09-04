/**
 * Exercises the read path against the real Arc testnet — no Circle, no device.
 * Proves chain.ts, usdc.ts and the public client work end to end.
 */
import { createPublicClient, http } from "viem";
import { arcTestnet, ARC_CONTRACTS } from "../src/arc/chain.ts";
import { Usdc } from "../src/arc/usdc.ts";

const client = createPublicClient({ chain: arcTestnet, transport: http() });

console.log("chain      :", arcTestnet.name, `(id ${await client.getChainId()})`);
console.log("block      :", await client.getBlockNumber());

// Every contract this app builds on, confirmed present.
for (const [name, address] of [
  ["USDC (ERC-20 view)", ARC_CONTRACTS.usdc],
  ["Memo", ARC_CONTRACTS.memo],
  ["Multicall3From", ARC_CONTRACTS.multicall3From],
  ["ERC-8004 identity", ARC_CONTRACTS.erc8004.identity],
]) {
  const code = await client.getCode({ address });
  console.log(`  ${name.padEnd(20)} ${((code?.length ?? 2) - 2) / 2} bytes`);
}

// The dual-decimal view, against a real balance rather than a fixture.
const address = ARC_CONTRACTS.multicall3From;
const native = Usdc.fromNativeUnits(await client.getBalance({ address }));
const erc20 = await client.readContract({
  address: ARC_CONTRACTS.usdc,
  abi: [{ type: "function", name: "balanceOf", stateMutability: "view",
          inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
  functionName: "balanceOf",
  args: [address],
});
console.log("\nsame balance, two views:");
console.log("  native (18dp) :", native.toNativeUnits(), `→ ${native}`);
console.log("  balanceOf (6dp):", erc20, `→ ${Usdc.fromErc20Units(erc20)}`);
console.log("  agree?         :", native.toErc20Units() === erc20 ? "yes" : "NO — truncation");
