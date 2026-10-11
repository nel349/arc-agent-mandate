import Svg, { Path } from "react-native-svg";
import { FLAT_PATH, REST_PATH, TRACE_BOX, TRACE_DASH, TRACE_MS, TRACE_PATH, traceOffset } from "./motion.ts";
import type { Pulse } from "./pulse.ts";
import { useTheme } from "./theme-context.tsx";
import { useLoop } from "./useLoop.ts";
import { useReducedMotion } from "./useReducedMotion.ts";

const HEIGHT = 36;
const STROKE = 2;
const LIT_STROKE = 2.5;
/**
 * How visible the line is where the light is not, and at rest: enough to see the beats coming and
 * that a line is there, not enough to compete with the light. Drawn in the theme's dim text colour,
 * which every palette keeps readable on its own ground; a ring colour was invisible in three of them.
 */
const UNLIT = 0.4;
const AT_REST = 0.55;

/**
 * The heartbeat line.
 *
 * It says how an agent is and nothing else. **Spending**: a lit part runs along a line with beats in
 * it. **Resting**: the line is nearly flat and still. **Stopped**: it is flat, in the stop colour.
 * So it moves only while there is something happening, and a still screen is a true one.
 *
 * With less motion asked for, a spending agent's line is lit from end to end and does not move; the
 * words beside it carry the rest.
 *
 * Stretched to the width it is given, so it draws the same shape in a card and across a screen.
 */
export function PulseLine({ pulse, label }: {
  readonly pulse: Pulse;
  /** What the line is saying, for anyone who cannot see it. Empty when words beside it already do. */
  readonly label: string;
}) {
  const c = useTheme().color;
  const reduced = useReducedMotion();
  const spending = pulse === "spending";
  const progress = useLoop(TRACE_MS, spending && !reduced);

  return (
    <Svg
      width="100%" height={HEIGHT}
      viewBox={`0 0 ${TRACE_BOX.width} ${TRACE_BOX.height}`}
      preserveAspectRatio="none"
      accessible={label.length > 0}
      {...(label.length > 0 ? { accessibilityLabel: label } : {})}
    >
      {pulse === "stopped" ? (
        <Path d={FLAT_PATH} fill="none" stroke={c.stop} strokeWidth={STROKE} />
      ) : pulse === "resting" ? (
        <Path d={REST_PATH} fill="none" stroke={c.dim} strokeOpacity={AT_REST} strokeWidth={STROKE} strokeLinejoin="round" />
      ) : (
        <>
          <Path
            d={TRACE_PATH} fill="none" strokeLinejoin="round"
            stroke={reduced ? c.untested : c.dim} strokeOpacity={reduced ? 1 : UNLIT} strokeWidth={STROKE}
          />
          {reduced ? null : (
            <Path
              d={TRACE_PATH} fill="none" strokeLinejoin="round" strokeLinecap="round"
              stroke={c.untested} strokeWidth={LIT_STROKE}
              strokeDasharray={[...TRACE_DASH]}
              strokeDashoffset={traceOffset(progress)}
            />
          )}
        </>
      )}
    </Svg>
  );
}
