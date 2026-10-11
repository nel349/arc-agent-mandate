import type { Mandate } from "../arc/mandate.ts";
import { later, noteSpending, pulseOf, pulseWords, stoppedBy, type Pulse, type SeenSpending } from "./pulse.ts";
import { useNow } from "./useNow.ts";

/** How often a spending agent is asked whether it still is. Short beside the minute and a half it lasts. */
const PULSE_CHECK_MS = 5_000;

/** When each agent's spending was last seen to rise, for every screen, for as long as the app is open. */
const seen = new Map<string, SeenSpending>();

/**
 * How an agent is, kept true as time passes, for a row and for its own screen alike.
 *
 * `lastSpent` is when its payments say it last spent. The figure it has spent rising is taken as a
 * payment too, because it is: the ring beats on that rise, and with the feed a read behind it used
 * to beat under the word "Resting". The rise is remembered for every screen at once, under the
 * network and the agent, so a page opened just after a row saw a payment agrees with the row.
 *
 * Read again on a clock while it is spending, because nothing else on the screen changes at the
 * moment it stops.
 */
export function usePulse(
  mandate: Mandate, lastSpent: number | null, chainId: number,
): { readonly pulse: Pulse; readonly words: string } {
  const rose = noteSpending(seen, `${chainId}:${mandate.agent.toLowerCase()}`, mandate.spent.toNativeUnits());
  const spentAt = later(lastSpent, rose);
  const now = useNow(PULSE_CHECK_MS, pulseOf(mandate, spentAt) === "spending");
  const pulse = pulseOf(mandate, spentAt, now);
  return { pulse, words: pulseWords(pulse, stoppedBy(mandate, now)) };
}
