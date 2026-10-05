import { BaseError, http, RpcRequestError, type Transport } from "viem";

/**
 * Talking to a public node the way it wants to be talked to.
 *
 * Monad's public endpoint answers at most fifteen requests a second from one address and turns the
 * rest away with an error of its own, not HTTP's "too many requests", which viem would have waited
 * out by itself. An agent that checks an allowance, reads what its grant reaches and signs for an app
 * makes a handful of reads in a breath, so being turned away is ordinary rather than exceptional.
 *
 * A request turned away is waited on and asked again, waiting longer each time and never in step with
 * the others, so a burst refused together does not come back together. Anything else is passed on at
 * once: a refusal that is not about pace is the node's answer, and waiting would only hide it.
 */

/** How many times a request the node turned away is sent again before the refusal is passed on */
export const TIMES_ASKED_AGAIN = 8;
/** The longest first wait before asking again; the longest wait doubles each time */
export const FIRST_WAIT_MS = 250;
/**
 * The longest any one wait grows to. Doubling without a ceiling reaches half a minute by the eighth
 * try, which is an agent that looks hung; a node this busy for this long is not about to be polite.
 */
export const MOST_TO_WAIT_MS = 4_000;

/** What the node says when a request comes too fast: its own code, and its words */
const TURNED_AWAY_CODE = -32011;
const TURNED_AWAY_WORDS = /requests limited|rate limit/i;

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Whether an error is the node saying a request came too fast, however deep in the error it is. */
export function isTurnedAway(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false;
  return error.walk((cause) =>
    cause instanceof RpcRequestError && (cause.code === TURNED_AWAY_CODE || TURNED_AWAY_WORDS.test(cause.details))) !== null;
}

/** How patient to be, which only a test has reason to change. */
export interface Patience {
  readonly timesAskedAgain?: number;
  readonly firstWaitMs?: number;
  readonly mostToWaitMs?: number;
}

/** An HTTP transport that waits and asks again when the node turns a request away for coming too fast. */
export function politeHttp(url?: string, patience: Patience = {}): Transport {
  const timesAskedAgain = patience.timesAskedAgain ?? TIMES_ASKED_AGAIN;
  const firstWaitMs = patience.firstWaitMs ?? FIRST_WAIT_MS;
  const mostToWaitMs = patience.mostToWaitMs ?? MOST_TO_WAIT_MS;
  const inner = http(url);
  return (config) => {
    const made = inner(config);
    const request: typeof made.request = async (args, options) => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await made.request(args, options);
        } catch (error) {
          if (attempt >= timesAskedAgain || !isTurnedAway(error)) throw error;
          await wait(Math.random() * Math.min(firstWaitMs * 2 ** attempt, mostToWaitMs));
        }
      }
    };
    return { ...made, request };
  };
}
