import { createPublicClient, http, HttpRequestError, type Address } from "viem";
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

/** HTTP's "too many requests". */
const TOO_MANY_REQUESTS = 429;
/** JSON-RPC's "limit exceeded", which Arc's public endpoint sends with its 429. */
const LIMIT_EXCEEDED = -32005;

/**
 * Whether a failure is Arc's public endpoint saying "too many requests", however deeply wrapped.
 *
 * Worth telling apart from every other failure because the right response is the opposite of the
 * usual one. A read that failed for any other reason is worth trying again soon; a read refused
 * for asking too often is made worse by asking again soon. Measured 09-10: the payments feed's
 * first read went out as fifty requests in two seconds, the endpoint refused them, and the refusals
 * spread to the allowance reads, which share the same limit.
 */
export function isRateLimited(cause: unknown): boolean {
  let current: unknown = cause;
  // Bounded, as `failure.ts` bounds its own walk: a cause cycle must not hang a poll.
  for (let depth = 0; current instanceof Error && depth < 8; depth++) {
    if (current instanceof HttpRequestError && current.status === TOO_MANY_REQUESTS) return true;
    if ("code" in current && current.code === LIMIT_EXCEEDED) return true;
    current = current.cause;
  }
  return false;
}
