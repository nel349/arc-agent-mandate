import { useEffect, useState } from "react";

/**
 * Nought to one, over and over, while `running`.
 *
 * For the trace on the heartbeat line. It stops asking for frames the moment it is not running, so
 * a line at rest costs nothing, and it starts each run from nought.
 */
export function useLoop(ms: number, running: boolean): number {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!running) { setProgress(0); return; }
    const started = Date.now();
    let frame = requestAnimationFrame(function step() {
      setProgress(((Date.now() - started) % ms) / ms);
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [ms, running]);

  return progress;
}
