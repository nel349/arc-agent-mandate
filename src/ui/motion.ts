/**
 * What moves, how long for, and how.
 *
 * Pulse moves for four reasons and no others: a payment lands, an agent is spending, something is
 * stopped, and a line arrives. Each has one duration, here, so two screens showing the same event
 * cannot disagree about how it feels. Nothing moves for decoration, and nothing at all for someone
 * who has asked their device for less motion (`useReducedMotion`).
 *
 * No React in it, so the curve and the trace's arithmetic can be tested.
 */

/** A beat: the halo that leaves the ring when a payment lands. */
export const BEAT_MS = 900;
/** A figure counting to its new value, and the ring moving to it. Shorter than a beat, so the number has settled before the halo is gone. */
export const COUNT_MS = 600;
/** The trace crossing the line once, while an agent is spending. */
export const TRACE_MS = 2800;
/** A new line arriving in a list. */
export const ARRIVE_MS = 500;
/** How long a new line stays lit after it arrives. */
export const LIT_MS = 1600;
/** One step of the welcome screen's example. Longer than a beat, so each payment finishes before the next. */
export const DEMO_STEP_MS = 1700;

/** Fast, then settling: how a number arrives at a value it is not going to leave. */
export const easeOut = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

/** Between two values, part of the way. */
export const between = (from: number, to: number, t: number): number => from + (to - from) * t;

/**
 * The heartbeat line: a flat run, a small rise, a tall spike and its fall, twice across the width.
 *
 * Drawn in a fixed box and stretched to whatever width it is given, as the ring is. The points are
 * data so the length can be worked out from them: the moving part is a dash, and a dash needs to know
 * how long the line is or it comes round early and two of them are on screen at once.
 */
export const TRACE_BOX = { width: 318, height: 44 } as const;
const BASELINE = 24;
const BEAT_SHAPE: readonly (readonly [number, number])[] = [
  [0, 0], [8, -4], [14, 0], [32, 0], [38, -18], [46, 16], [53, -6], [58, 0],
];
const BEAT_STARTS = [70, 190] as const;

const tracePoints: readonly (readonly [number, number])[] = [
  [0, BASELINE],
  ...BEAT_STARTS.flatMap((start) => BEAT_SHAPE.map(([dx, dy]) => [start + dx, BASELINE + dy] as const)),
  [TRACE_BOX.width, BASELINE],
];

const pathOf = (points: readonly (readonly [number, number])[]): string =>
  points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x} ${y}`).join(" ");

const lengthOf = (points: readonly (readonly [number, number])[]): number =>
  points.slice(1).reduce((total, [x, y], index) => {
    const [px, py] = points[index] ?? [x, y];
    return total + Math.hypot(x - px, y - py);
  }, 0);

/** The line with its beats, the line of an agent at rest, and the line of one that is stopped. */
export const TRACE_PATH = pathOf(tracePoints);
export const REST_PATH = pathOf([[0, BASELINE], [150, BASELINE], [158, BASELINE - 3], [164, BASELINE], [TRACE_BOX.width, BASELINE]]);
export const FLAT_PATH = pathOf([[0, BASELINE], [TRACE_BOX.width, BASELINE]]);
export const TRACE_LENGTH = lengthOf(tracePoints);

/** How much of the line is lit at once. */
export const TRACE_LIT = 80;

/**
 * The dash that lights part of the line, and where it sits at `progress` through one crossing.
 *
 * The gap is the whole line plus the lit part, so there is never a second lit part on screen. At
 * nought the lit part is just off the left end, and at one it has just left the right.
 */
export const TRACE_DASH: readonly [number, number] = [TRACE_LIT, TRACE_LENGTH + TRACE_LIT];
export const traceOffset = (progress: number): number => TRACE_LIT - progress * (TRACE_LENGTH + TRACE_LIT);
