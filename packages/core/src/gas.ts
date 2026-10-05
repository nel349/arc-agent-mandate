/**
 * Gas for an operation sent through Circle's bundler, and how to correct it when the bundler says no.
 *
 * An agent's operation cannot be estimated: estimation validates with a stub signature, which recovers
 * to a stranger, so the plugin refuses it. So limits start from a network's own figures and are
 * corrected from what the bundler names when it refuses them. Arc's bundler takes generous limits;
 * Monad's does not, because Monad bills the whole limit: it wants preVerificationGas in the millions,
 * and refuses a verification limit of which under 40% is used.
 */

export interface GasLimits {
  readonly callGasLimit: bigint;
  readonly verificationGasLimit: bigint;
  readonly preVerificationGas: bigint;
  readonly paymasterVerificationGasLimit: bigint;
  readonly paymasterPostOpGasLimit: bigint;
}

/** A refusal the bundler names a better figure in, as its words read on Monad testnet, 3 Oct. */
const TOO_LITTLE_PRE_VERIFICATION = /preVerificationGas is \d+ but must be at least (\d+)/;
const TOO_MUCH_VERIFICATION = /Verification gas limit efficiency too low\. Required: ([0-9.]+), Actual: ([0-9.]+)/;

/** above the least preVerificationGas the bundler names, since the next operation may cost a little more */
const PRE_VERIFICATION_ROOM = { times: 11n, over: 10n } as const;
/** the share of a verification limit to leave used, comfortably above the bundler's least */
const VERIFICATION_SHARE_USED = { times: 10n, over: 6n } as const;
/** how finely the reported share is read */
const SHARE_PRECISION = 1_000_000;

/**
 * The limits to send again with, when the bundler refused these and named why; nothing when the refusal
 * is not about gas, which no change to the limits would fix.
 */
export function correctedGas(refusal: unknown, limits: GasLimits): GasLimits | undefined {
  const text = refusal instanceof Error ? refusal.message : String(refusal);
  const least = TOO_LITTLE_PRE_VERIFICATION.exec(text);
  if (least?.[1]) {
    return { ...limits, preVerificationGas: (BigInt(least[1]) * PRE_VERIFICATION_ROOM.times) / PRE_VERIFICATION_ROOM.over };
  }
  const share = TOO_MUCH_VERIFICATION.exec(text);
  if (share?.[2]) {
    // the gas validation used, from the share of this limit it reports, then a limit it uses six tenths of
    const used = (limits.verificationGasLimit * BigInt(Math.round(Number(share[2]) * SHARE_PRECISION))) / BigInt(SHARE_PRECISION);
    return { ...limits, verificationGasLimit: (used * VERIFICATION_SHARE_USED.times) / VERIFICATION_SHARE_USED.over };
  }
  return undefined;
}

/** how many times to send again with what the bundler named, before its refusal is the answer */
export const MOST_GAS_CORRECTIONS = 3;

/**
 * Send, and while the bundler refuses the gas and names better figures, send again with them. Gives back
 * what was sent and the limits it was finally sent with, which the next operation can start from.
 */
export async function sendCorrectingGas<T>(
  start: GasLimits,
  send: (limits: GasLimits) => Promise<T>,
): Promise<{ readonly sent: T; readonly limits: GasLimits }> {
  let limits = start;
  for (let corrections = 0; ; corrections++) {
    try {
      return { sent: await send(limits), limits };
    } catch (refusal) {
      const better = corrections < MOST_GAS_CORRECTIONS ? correctedGas(refusal, limits) : undefined;
      if (better === undefined) throw refusal;
      limits = better;
    }
  }
}
