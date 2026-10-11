/**
 * The example the welcome screen plays: one agent, one allowance, spent down and then refused.
 *
 * No React in it, for the usual reason: nothing in a `.tsx` file is reachable by the unit suite, and
 * the sums here are the kind that go quietly wrong. It is an example and the screen says so; nothing
 * in it is read from a chain, and no name in it is a real service.
 *
 * Amounts are in hundredths, so nothing is ever 2.3800000000000003.
 */

export interface DemoEvent {
  readonly what: string;
  /** In hundredths of the coin. */
  readonly amount: number;
  /** More than is left, so the chain turns it away and nothing is spent. */
  readonly refused?: true;
}

/** What the example agent is allowed, in hundredths. */
export const DEMO_LIMIT = 500;

/**
 * Small, small, small, then large enough to see the ring move, then one that cannot fit. The last
 * is the product's whole promise, so the example ends on it.
 */
export const DEMO_EVENTS: readonly DemoEvent[] = [
  { what: "Weather lookup", amount: 2 },
  { what: "Route search", amount: 5 },
  { what: "Graded answer", amount: 25 },
  { what: "Dataset, 1,200 rows", amount: 140 },
  { what: "Translation", amount: 90 },
  { what: "Model call", amount: 110 },
  { what: "Bulk export", amount: 400, refused: true },
];

/** Steps the refusal is left on screen before the example starts again. */
const HOLD_STEPS = 2;

/** One step with nothing spent yet, one for each event, then the hold. */
export const DEMO_STEPS = 1 + DEMO_EVENTS.length + HOLD_STEPS;

/** Where a screen that does not animate rests: part spent, an agent at work, nothing refused. */
export const DEMO_STILL_STEP = 5;

export type DemoState = "granted" | "spending" | "refused";

export interface DemoRow {
  /** Stable for one event, so a list can tell a new line from one that moved down. */
  readonly key: string;
  readonly what: string;
  readonly amount: number;
  readonly refused: boolean;
  /** The line that has just arrived. */
  readonly fresh: boolean;
}

export interface DemoFrame {
  /** In hundredths. */
  readonly left: number;
  /** Nought to one, as the ring takes it. */
  readonly spentFraction: number;
  readonly state: DemoState;
  /** Newest first. */
  readonly rows: readonly DemoRow[];
  /** Goes up by one for each payment that lands, and not for a refusal: nothing moved. */
  readonly beat: number;
  /** Goes up by one for each payment turned away. */
  readonly refusals: number;
}

export const nextDemoStep = (step: number): number => (step + 1) % DEMO_STEPS;

/** The example at one step. `rowsShown` is how many lines the screen has room for. */
export function demoFrame(step: number, rowsShown: number): DemoFrame {
  const happened = Math.max(0, Math.min(Math.trunc(step), DEMO_EVENTS.length));
  const holding = step > DEMO_EVENTS.length;

  let spent = 0;
  let beat = 0;
  let refusals = 0;
  for (const event of DEMO_EVENTS.slice(0, happened)) {
    if (event.refused) { refusals += 1; continue; }
    spent += event.amount;
    beat += 1;
  }

  const newest = happened === 0 ? undefined : DEMO_EVENTS[happened - 1];
  const rows: DemoRow[] = [];
  for (let index = happened - 1; index >= 0 && rows.length < rowsShown; index--) {
    const event = DEMO_EVENTS[index];
    if (event === undefined) continue;
    rows.push({
      key: `${index}`,
      what: event.what,
      amount: event.amount,
      refused: event.refused === true,
      fresh: index === happened - 1 && !holding,
    });
  }

  return {
    left: DEMO_LIMIT - spent,
    spentFraction: spent / DEMO_LIMIT,
    state: newest === undefined ? "granted" : newest.refused ? "refused" : "spending",
    rows,
    beat,
    refusals,
  };
}

/**
 * What the heartbeat line shows for each state of the example.
 *
 * A refusal is not the agent being stopped: what is left is still there and still its to spend. So
 * the line goes still, as for an agent that is not paying, and does not go flat.
 */
export const DEMO_PULSE = { granted: "resting", spending: "spending", refused: "resting" } as const;

/** Why the payment that is turned away is turned away, as the line for it says. */
export const REFUSED_BECAUSE = "more than is left";

export interface ExampleLayout {
  /** How many payment lines the card has room for. */
  readonly rows: number;
  /** A smaller ring. */
  readonly short: boolean;
  /** No room for anything but the card, one sentence and the buttons. */
  readonly tiny: boolean;
}

/**
 * What the welcome screen draws in a window of a given height.
 *
 * Two payments and the full ring where there is room. One payment and a smaller ring in a short
 * window, where two pushed the sentence under the card behind the buttons. In a tiny one, the
 * smallest phones with the browser's bars showing, the card keeps its ring and line and gives up
 * its payment lines, and the screen gives up its second sentence, so the headline is still read.
 *
 * Most phones' browsers are short by this measure, since the browser's own bars take a fifth of the
 * screen, so the short card is the usual one and not a fallback.
 */
export function exampleLayout(windowHeight: number, shortBelow: number, tinyBelow: number): ExampleLayout {
  const tiny = windowHeight < tinyBelow;
  const short = windowHeight < shortBelow;
  return { rows: tiny ? 0 : short ? 1 : 2, short, tiny };
}

/** Hundredths as a figure: 238 is "2.38". */
export const demoFigure = (hundredths: number): string => (hundredths / 100).toFixed(2);
