import { useEffect, useRef, useState } from "react";
import { COUNT_MS, between, easeOut } from "./motion.ts";

/**
 * A number that travels to its new value instead of jumping there.
 *
 * For a figure counting down and the ring moving with it. `still` jumps, which is what somebody who
 * asked for less motion gets, and what the first value always gets: a balance that counts up from
 * nought on arrival is a number being wrong for half a second.
 *
 * Driven by frames and plain state, not by `Animated`: the value is drawn as text and as an arc's
 * length, and neither is something a native animation can set.
 */
export function useEased(target: number, still: boolean, ms: number = COUNT_MS): number {
  const [shown, setShown] = useState(target);
  // Where the last frame left it, so a new target met part-way starts from there and not from the old end.
  const at = useRef(target);

  useEffect(() => {
    // Jumps when asked to be still, when there is nowhere to travel, and when either end is not a
    // number: easing from a figure that never arrived draws half a second of NaN.
    if (still || !Number.isFinite(target) || !Number.isFinite(at.current) || at.current === target) {
      at.current = target;
      setShown(target);
      return;
    }
    const from = at.current;
    const started = Date.now();
    let frame = requestAnimationFrame(function step() {
      const t = (Date.now() - started) / ms;
      at.current = t >= 1 ? target : between(from, target, easeOut(t));
      setShown(at.current);
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, still, ms]);

  return shown;
}
