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
  /** How much of the circumference is gone. Named for when the gone part was the arc that was drawn. */
  readonly drawn: number;
  /** How much of the circumference is left, which is the arc that is drawn. */
  readonly left: number;
  /** Where the part that is left begins, in degrees clockwise from twelve o'clock: where the gone part ends. */
  readonly leftFrom: number;
  /** Nothing is spent, so the ring is whole. */
  readonly empty: boolean;
  /** Nothing is left, so there is no arc: not a zero-length one, which draws as a bead with a round end. */
  readonly spentOut: boolean;
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
    left: circumference * (1 - clamped),
    leftFrom: 360 * clamped,
    empty: clamped <= 0,
    spentOut: clamped >= 1,
    warning: clamped >= RING_WARNS_AT,
  };
}

export interface RoundedArc {
  /** The dash to draw, before its round ends are added. */
  readonly dash: number;
  /** Where the dash begins, in degrees clockwise from twelve o'clock. */
  readonly from: number;
}

/**
 * The smallest dash a renderer will still cap: with round ends it draws as a bead the width of the
 * stroke, which is the least that can be shown of "something is left".
 */
const BEAD = 0.01;

/**
 * The arc of what is left, drawn with round ends, so that the ends are inside the arc and not added
 * to it.
 *
 * A round end adds half the stroke's width beyond each end of a dash. Drawn at its full length, a
 * ring half spent showed about 54% left, one 1% spent showed no gap at all, and the living part
 * poked past twelve o'clock. So the dash is shortened by one stroke and moved along by half of one:
 * what is seen, ends included, is exactly the part that is left.
 *
 * When less than a stroke's width is left there is no room for that, and it is drawn as a bead in
 * the middle of what remains: a little more than is true, and the least that can be seen.
 */
export function roundedArc(ring: RingGeometry, stroke: number): RoundedArc {
  const perUnit = 360 / ring.circumference;
  if (ring.left <= stroke) return { dash: BEAD, from: ring.leftFrom + (ring.left / 2) * perUnit };
  return { dash: ring.left - stroke, from: ring.leftFrom + (stroke / 2) * perUnit };
}
