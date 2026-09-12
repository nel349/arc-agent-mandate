import { createPublicClient, custom, http, HttpRequestError, type Address, type EIP1193RequestFn } from "viem";
import { arcTestnet } from "./chain.ts";
import { arcRpcUrl, asksForARange, PUBLIC_ARC_RPC } from "./endpoint.ts";

/**
 * Reading Arc directly, with no Circle and no React Native in the import graph.
 *
 * Separate from `account.ts` deliberately: that module reaches the passkey shim and therefore
 * `react-native`, which cannot be loaded outside a device. Anything that only *reads* the chain —
 * balances, deployment checks, mandate state — belongs here so it stays testable in plain Node.
 */
/**
 * One way in and out for every read, whichever endpoint is in use.
 *
 * The endpoint can change while the app is open — somebody pastes one into Settings — and a client
 * built around a fixed URL would keep reading the old one until the app restarted. So the transport
 * asks `arcRpcUrl()` per request, and the underlying HTTP transports are made once each and kept:
 * changing endpoint costs nothing, and changing back costs nothing either.
 */
const madeFor = new Map<string, EIP1193RequestFn>();

function requestTo(url: string): EIP1193RequestFn {
  const made = madeFor.get(url);
  if (made !== undefined) return made;
  const { request } = http(url)({ chain: arcTestnet });
  madeFor.set(url, request);
  return request;
}

/**
 * Endpoints that have refused a block range, so the next scan does not ask them again.
 *
 * A refusal costs a round trip, and a feed scans in many windows. Paying that once per endpoint is
 * the difference between a fallback and a tax. Not persisted: a plan can be upgraded, and a restart
 * is a fair moment to find out.
 */
const refusesRanges = new Set<string>();

/**
 * One way in and out for every read, sending each to an endpoint that can answer it.
 *
 * Most reads are a single point — a balance, an allowance, one contract call — and go to whichever
 * endpoint is in use, which is the fast one when this build or this phone was given one.
 *
 * Scans are different. `eth_getLogs` over ten thousand blocks is refused outright by a provider's
 * free plan, which commonly allows ten, and the refusal is not a rate limit to wait out: asking again
 * gets the same answer for ever. That took out the payments feed, the pairing search and the badges
 * at once, while every other read on the same endpoint was fine. So a refused range is retried on
 * Arc's own endpoint, which allows the window, and that endpoint is remembered as one to skip.
 *
 * An endpoint that *does* serve ranges keeps serving them — the point of having a private one is
 * lost if its scans are handed to the shared endpoint anyway.
 */
async function readArc(args: Parameters<EIP1193RequestFn>[0]): Promise<unknown> {
  const url = arcRpcUrl();
  const scan = asksForARange(args.method);
  if (!scan || url === PUBLIC_ARC_RPC) return requestTo(url)(args);
  if (refusesRanges.has(url)) return requestTo(PUBLIC_ARC_RPC)(args);

  try {
    return await requestTo(url)(args);
  } catch (cause) {
    if (!isRangeRefusal(cause)) throw cause;
    refusesRanges.add(url);
    console.warn(
      "[arc] this endpoint will not serve a block range that large, so history is being read through " +
      "Arc's own endpoint instead. Everything else still goes to yours.",
    );
    return requestTo(PUBLIC_ARC_RPC)(args);
  }
}

export const arcPublicClient = createPublicClient({
  chain: arcTestnet,
  transport: custom({ request: readArc }),
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
/** JSON-RPC's "invalid request", which is what a provider sends when a block range is too wide. */
const INVALID_REQUEST = -32600;

/**
 * Whether a failure is the endpoint refusing the *size* of a range, rather than the request itself.
 *
 * Told apart from every other failure because the response is different again: a rate limit is
 * waited out, an ordinary failure is reported, and this one is permanent for that endpoint and fine
 * on another. Measured against Alchemy's free plan, which answers `eth_getLogs` over more than ten
 * blocks with `-32600` and a sentence naming the range it would accept. Providers word it
 * differently — some cap results rather than blocks — so the code alone is not enough to match on,
 * and neither is any single phrase.
 */
export function isRangeRefusal(cause: unknown): boolean {
  let current: unknown = cause;
  for (let depth = 0; current instanceof Error && depth < 8; depth++) {
    const said = `${current.message} ${"details" in current ? String(current.details) : ""}`;
    if (/block range|range is too|too many blocks|more than \d+ results|query returned more than/i.test(said)) {
      return true;
    }
    if ("code" in current && current.code === INVALID_REQUEST && /getLogs|range/i.test(said)) return true;
    current = current.cause;
  }
  return false;
}

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
