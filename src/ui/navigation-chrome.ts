import type { Theme } from "./themes.ts";

/**
 * How the app's stacks draw their chrome, in one place.
 *
 * Three stacks — the root one and a stack per tab — had each written out the same six options, and
 * the two tab stacks had also each written the same four again for their large title. Chrome is
 * exactly the thing that drifts: one copy gets a fix, the others keep the bug, and the app reads as
 * two apps. The tab bar is the platform's own (`app/(tabs)/_layout.tsx`); this is what sits above it.
 */

/** Transparent, so a screen's own lit ground runs to the top edge under the bar. */
const TRANSPARENT = "transparent";

/**
 * The palette on the bar: its tint, both title sizes, and the ground a screen is laid on.
 *
 * Taken from the theme rather than fixed, so choosing a palette moves every bar in the app at once.
 */
export function stackChrome(color: Theme["color"]) {
  return {
    headerTintColor: color.paper,
    headerTitleStyle: { color: color.paper },
    headerLargeTitleStyle: { color: color.paper },
    headerShadowVisible: false,
    headerLargeTitleShadowVisible: false,
    contentStyle: { backgroundColor: color.groundMid },
  };
}

/**
 * A tab's own first screen: the large title Apple asks of a top-level screen, over the screen's own
 * gradient rather than a bar with a fill of its own.
 *
 * Both backgrounds have to be cleared. Leaving either one set draws a darker band across the top of
 * the gradient, which is the bug this was extracted with rather than after.
 */
export const TOP_LEVEL_SCREEN = {
  headerLargeTitleEnabled: true,
  headerTransparent: true,
  headerStyle: { backgroundColor: TRANSPARENT },
  headerLargeStyle: { backgroundColor: TRANSPARENT },
};
