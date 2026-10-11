/**
 * A figure on its way from one value to another, with no React in it.
 *
 * Two things went wrong when the travelling value was simply a floating-point number turned back
 * into an amount. On a coin with eighteen decimals it had digits nobody granted: an allowance going
 * from 0.01 to 0.008 passed through 0.009458, which is six places in a ring drawn for three, and
 * across its stroke. And even standing still a figure could be redrawn a cent low, because 590.33
 * does not survive the trip through a float.
 *
 * So the travelling value moves in steps, and the step is the coarsest one both ends are whole
 * multiples of, down from the hundredth a figure is always printed to: hundredths between 25.00
 * and 23.75 and between 5 and 4, thousandths between 0.01 and 0.008. It never shows a digit finer
 * than the two figures it is travelling between.
 */

/** Beyond any amount a chain can hold; stops the search when both ends are nought. */
const COARSEST = 10n ** 40n;

/**
 * The largest power of ten that divides both, and no larger than `coarsest`.
 *
 * `coarsest` is the smallest step the figure is ever printed in, a hundredth of the coin. Without
 * it a round figure had nothing to count through: 5 to 4 was one step, and jumped.
 */
export function stepBetween(from: bigint, to: bigint, coarsest: bigint = COARSEST): bigint {
  let step = 1n;
  while (step * 10n <= coarsest && from % (step * 10n) === 0n && to % (step * 10n) === 0n) step *= 10n;
  return step;
}

/**
 * Where the figure is, given how far the eased number has got, in the coin's smallest units.
 *
 * `shown` is a float and is only trusted for how far along it is: the answer is rounded to the step
 * and kept between the two ends, so easing that overshoots, or a float a hair outside, cannot draw
 * a figure that was never on the way.
 */
export function onTheWay(from: bigint, to: bigint, shown: number, coarsest: bigint = COARSEST): bigint {
  if (!Number.isFinite(shown)) return to;
  const step = stepBetween(from, to, coarsest);
  const stepped = BigInt(Math.round(shown / Number(step))) * step;
  const [low, high] = from < to ? [from, to] : [to, from];
  return stepped < low ? low : stepped > high ? high : stepped;
}

/**
 * The largest type a figure can be set in and still sit inside a ring.
 *
 * A browser cannot be asked to shrink text to fit, so it is worked out: the display face's digits
 * are about two thirds of the type size wide when they are all one width, which was measured (four
 * of them at 40 are 108 across). "22.56" filled a 176 ring almost edge to edge at 40, and "100.00"
 * or a small coin's "0.007875" went through its stroke.
 */
const DIGIT_WIDTH = 0.68;

export function figureSizeFor(characters: number, room: number, largest: number, smallest: number): number {
  if (characters <= 0) return largest;
  return Math.max(smallest, Math.min(largest, Math.floor(room / (characters * DIGIT_WIDTH))));
}
