import { createPublicClient, http, type Address } from "viem";
import { arcTestnet } from "./chain.ts";

/**
 * Reading Arc directly, with no Circle and no React Native in the import graph.
 *
 * Separate from `account.ts` deliberately: that module reaches the passkey shim and therefore
 * `react-native`, which cannot be loaded outside a device. Anything that only *reads* the chain —
 * balances, deployment checks, mandate state — belongs here so it stays testable in plain Node.
 */
export const arcPublicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(arcTestnet.rpcUrls.default.http[0]),
});

/** Whether the account contract exists yet. False before the first user operation is expected. */
export async function isDeployed(address: Address): Promise<boolean> {
  const code = await arcPublicClient.getCode({ address });
  return code !== undefined && code !== "0x";
}
