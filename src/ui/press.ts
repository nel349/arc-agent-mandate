import { Platform, type PressableAndroidRippleConfig } from "react-native";

/**
 * How a control answers a touch, in each platform's own language.
 *
 * iOS dims what you are pressing: the control dips under the finger and comes back. Android draws a
 * **ripple** from the point of contact, and has since Material's first version — a dimmed Android
 * control reads as disabled rather than pressed, which is what every tappable row in this app was
 * doing there.
 *
 * So the two are not made to match. Each platform is given the answer its own users already know,
 * and neither gets both: a ripple *and* a dim is two replies to one touch.
 */

/**
 * The ripple for a control that has edges — a button, a row, a card.
 *
 * `foreground` draws it over the content rather than under, which is what makes it visible on a
 * surface that paints its own background; a bordered row with a background would otherwise ripple
 * underneath its own fill and show nothing.
 *
 * That is not a detail. `foreground: false` sends the ripple to the view's *underlay*, which RN
 * draws beneath it, and a control that never asked for it gets no feedback at all — which is what
 * the navigation gear did for as long as it has existed. It was the one caller asking for
 * `borderless`, and `borderless` is what turned the foreground off.
 *
 * `borderless` is for a glyph with genuinely no shape: the ripple spreads past it as a circle
 * instead of being clipped to a box nobody drew. It costs the foreground to do that, so it is worth
 * it only where there is really nothing to clip to. Give the control a size and this is the wrong
 * trade.
 *
 * `radius` says how far the ripple reaches. Left out, Android derives it from the view, which is
 * right for a row and wrong for a control whose touch area was chosen rather than grown from its
 * content: the circle then answers the glyph's size instead of the target's.
 */
export function ripple(
  color: string, borderless = false, radius?: number,
): PressableAndroidRippleConfig | undefined {
  if (Platform.OS !== "android") return undefined;
  return { color, borderless, foreground: !borderless, ...(radius === undefined ? {} : { radius }) };
}

/**
 * Whether a press should show iOS's treatment — a dip in opacity on a button, a lit background on a
 * row. False on Android, where the ripple is the whole answer and either would be a second one.
 */
export const DIMS_ON_PRESS = Platform.OS !== "android";
