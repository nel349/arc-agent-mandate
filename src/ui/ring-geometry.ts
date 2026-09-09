/**
 * The mark's arithmetic, with no React in it.
 *
 * Kept apart from the component for the reason the audit made plain: every hook and component in
 * this directory is unreachable by the unit suite, so anything that lives inside a `.tsx` file is
 * effectively untested. The rule the mark embodies — how much is gone, and when that becomes a
 * warning — is worth more than the drawing, so it lives where a test can reach it.
 *
 * It is the same rule the web draws in `arc-maze/src/web/brand.ts`, deliberately: the two are
 * separate repositories and cannot share a module, so they share a documented rule instead, and
 * `BRAND.md` is where that correspondence is written down. If one moves, the other is wrong.
 */

/**
 * Where the ring stops being information and starts being a warning.
 *
 * Nine tenths, so a glance tells you an allowance is nearly gone while there is still enough left
 * to act on. Named rather than inlined because the same number is drawn on the web, and a threshold
 * that exists twice as a literal is a threshold that will eventually exist twice as two literals.
 */
export const RING_WARNS_AT = 0.9;

export interface RingGeometry {
  /** The input, clamped into nought-to-one. */
  readonly fraction: number;
  readonly circumference: number;
  /** How much of the circumference to draw. */
  readonly drawn: number;
  /** Nothing is spent, so there is no arc — not a zero-length one, which iOS renders as a dot. */
  readonly empty: boolean;
  /** At or past the threshold. */
  readonly warning: boolean;
}

/**
 * `fraction` is clamped rather than trusted.
 *
 * A spend can exceed its limit when a limit is lowered after the fact — the app supports that
 * deliberately, as the way to rein an agent in without revoking it — and a ring drawn past its own
 * start looks exactly like one that has not started. A non-finite value means the figures have not
 * arrived yet and reads as nothing spent, which is the safe direction: it never claims an allowance
 * is emptier than it is.
 */
export function ringGeometry(fraction: number, radius: number): RingGeometry {
  const clamped = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  const circumference = 2 * Math.PI * radius;
  return {
    fraction: clamped,
    circumference,
    drawn: circumference * clamped,
    empty: clamped <= 0,
    warning: clamped >= RING_WARNS_AT,
  };
}
