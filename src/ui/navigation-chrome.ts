import { Platform } from "react-native";
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
    // Android and the web draw a bar with a fill; iOS is given a transparent one per screen, below.
    // Without this the Android header is the system's default grey over the app's own dark ground,
    // and the web's is a white strip with the title faint on it, above a dark screen.
    ...(Platform.OS !== "ios" ? { headerStyle: { backgroundColor: color.groundMid } } : {}),
  };
}

/**
 * A tab's own first screen: the large title Apple asks of a top-level screen, over the screen's own
 * gradient rather than a bar with a fill of its own.
 *
 * Both backgrounds have to be cleared. Leaving either one set draws a darker band across the top of
 * the gradient, which is the bug this was extracted with rather than after.
 */
export const TOP_LEVEL_SCREEN = Platform.select({
  ios: {
    headerLargeTitleEnabled: true,
    headerTransparent: true,
    headerStyle: { backgroundColor: TRANSPARENT },
    headerLargeStyle: { backgroundColor: TRANSPARENT },
  },
  /**
   * Android has no large title, and a transparent bar there is not the same offer.
   *
   * On iOS a transparent header is drawn *over* a screen that iOS has already inset for it. Android
   * takes it literally: the bar floats and the content starts at the top of the window, so the
   * wallet card was drawn through the word "Allowances" and under the settings gear. An ordinary
   * bar, filled from the theme by `stackChrome`, is what that platform means by a header.
   */
  default: { headerTransparent: false },
});
