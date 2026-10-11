import { useRef } from "react";

/**
 * How many times a figure has gone up while this was on screen.
 *
 * What an agent has spent only ever rises, and each rise is a payment, so this is the count a
 * `Beat` is given. It starts at nought whatever the figure is: what was spent before the screen
 * opened is not a payment landing now. A figure that falls, which a new allowance for the same
 * agent causes, is taken as the new place to count from and is not a beat.
 *
 * Kept by each ring for itself, since each ring beats for itself. When an agent last paid is a
 * different question, asked of every screen at once, and is answered in `usePulse`.
 */
export function useRises(value: bigint): number {
  const seen = useRef({ value, count: 0 });
  if (value > seen.current.value) seen.current = { value, count: seen.current.count + 1 };
  else if (value < seen.current.value) seen.current = { value, count: seen.current.count };
  return seen.current.count;
}
