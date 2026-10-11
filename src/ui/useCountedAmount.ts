import { useRef } from "react";
import type { Amount as AmountType } from "../arc/amount.ts";
import { Amount } from "../arc/amount.ts";
import { onTheWay } from "./counting.ts";
import { useEased } from "./useEased.ts";
import { useReducedMotion } from "./useReducedMotion.ts";

/** A hundredth of a coin, in its smallest units: the coarsest step a figure is ever printed in. */
const HUNDREDTH = Amount.parse("0.01").toNativeUnits();

/**
 * An amount that counts to its new value instead of jumping to it.
 *
 * At rest it is the amount it was given, exactly. On the way it moves in steps no finer than the
 * two figures it is travelling between, so a coin with eighteen decimals does not flash six of them
 * in a space drawn for three; `counting.ts` has the arithmetic and why.
 *
 * It jumps when there was nothing to count from, a balance that had not been read yet, and when
 * `of` changes: a balance on another network is another number, not this one moving.
 */
export function useCountedAmount<A extends AmountType | null>(amount: A, of: string = ""): A {
  const reduced = useReducedMotion();
  const last = useRef(of);
  const moved = last.current !== of;
  last.current = of;

  const units = amount === null ? null : amount.toNativeUnits();
  // The value it is travelling from: the one it was last at rest on.
  const from = useRef(units);
  const target = units === null ? Number.NaN : Number(units);
  const shown = useEased(target, reduced || moved);

  if (amount === null || units === null) { from.current = null; return amount; }
  if (from.current === null || shown === target || !Number.isFinite(shown)) { from.current = units; return amount; }
  const at = onTheWay(from.current, units, shown, HUNDREDTH);
  return at === units ? amount : (Amount.fromNativeUnits(at) as A);
}
