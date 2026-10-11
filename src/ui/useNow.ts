import { useEffect, useState } from "react";

/**
 * The time, read again every so often while `ticking`.
 *
 * For something that is true only for a while, like an agent that paid a moment ago: with nothing
 * else changing on the screen, nothing would draw it again when the while is up, and it would say
 * "now" for as long as the screen stayed open. It does not tick when there is nothing to expire.
 */
export function useNow(everyMs: number, ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs, ticking]);

  return ticking ? now : Date.now();
}
