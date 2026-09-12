import { arcRpcUrl } from "../src/arc/endpoint.ts";
// The app's own check, which walks the cause chain and knows both the HTTP status and the JSON-RPC
// code. A second copy here missed the code-without-status case, so a retry sometimes did not fire.
import { isRateLimited } from "../src/arc/client.ts";

/**
 * Reading the live chain from a test, on an endpoint that is shared and sometimes says no.
 *
 * Arc's public RPC rate-limits, and the whole suite leans on it: three files read it directly, and
 * every forked-chain file builds its fork's genesis from it. On a busy afternoon that is a gate that
 * fails for somebody else's reason — measured, not imagined: eighteen refusals in one run on 09-11,
 * which failed four tests that had nothing wrong with them.
 *
 * Two answers, and neither is to pass quietly:
 *
 * - **A refusal is waited out, not accepted.** `readingLive` asks again, a little later each time.
 * - **Giving up still fails.** A guard that silently does not run is worse than no guard, which is
 *   the rule `arc-rails.test.ts` already states; this keeps it, and says which endpoint refused.
 *
 * And the endpoint itself is configurable, so a private one removes the problem rather than
 * softening it: `ARC_TESTNET_RPC_URL` is what the contract tests already read.
 */

/**
 * The endpoint every live read and every forked chain uses, resolved where the app resolves its own
 * so the two cannot drift. Off-device only: see `arcRpcUrl`.
 */
export const ARC_RPC = arcRpcUrl();

/** Half a second, then a second, then two: long enough for a per-second limit to roll over. */
const WAITS_MS = [500, 1_000, 2_000, 4_000] as const;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One live read, retried while the endpoint is refusing, and failing loudly when it will not relent.
 *
 * `what` names the read, so a failure says which question went unanswered rather than only where.
 */
export async function readingLive<T>(what: string, read: () => Promise<T>): Promise<T> {
  let refusals = 0;
  for (const pause of WAITS_MS) {
    try {
      return await read();
    } catch (cause) {
      if (!isRateLimited(cause)) throw cause;
      refusals += 1;
      await wait(pause);
    }
  }
  try {
    return await read();
  } catch (cause) {
    if (!isRateLimited(cause)) throw cause;
    throw new Error(
      `${ARC_RPC} refused ${what} ${refusals + 1} times for being too frequent, so this check did not ` +
      "run. Failing rather than passing quietly. Set ARC_TESTNET_RPC_URL to an endpoint of your own, " +
      "or run the suite again in a few minutes.",
      { cause },
    );
  }
}
