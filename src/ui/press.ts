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
 * `borderless` is for a glyph with no shape of its own, like the gear in the navigation bar: the
 * ripple spreads past the icon as a circle instead of being clipped to a box that is not drawn.
 */
export function ripple(color: string, borderless = false): PressableAndroidRippleConfig | undefined {
  return Platform.OS === "android" ? { color, borderless, foreground: !borderless } : undefined;
}

/**
 * Whether a press should show iOS's treatment — a dip in opacity on a button, a lit background on a
 * row. False on Android, where the ripple is the whole answer and either would be a second one.
 */
export const DIMS_ON_PRESS = Platform.OS !== "android";
