import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Platform, Pressable, StyleSheet } from "react-native";
import { ripple } from "./press.ts";
import { ROUTES } from "./routes.ts";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/** Sized from the shared control scale, so it matches the `?` controls in content. */
const HEADER_ICON = Math.round(tokens.size.control.header * tokens.size.glyphScale);

/** The two platforms lay a header item out differently enough that they are built differently. */
const ANDROID = Platform.OS === "android";

/**
 * How far the touch area reaches past the glyph on iOS, where the view is only as tall as its icon.
 */
const IOS_HIT_SLOP = Math.round((tokens.size.tapTarget - HEADER_ICON) / 2);

/**
 * The gear in the navigation bar.
 *
 * A view, because the native option is not available here. `unstable_headerRightItems` is the right
 * answer — it hands iOS a real `UIBarButtonItem` and the system owns shape, padding, tint and
 * alignment. React Navigation 7.18 accepts it, but `react-native-screens` 4.16, which Expo SDK 54
 * pins, implements neither the JS nor the native side and drops the prop silently. Passing it removed
 * the button altogether. Revisit when screens supports it.
 *
 * So: a glyph and a width, with no background of our own. iOS 26 already draws a capsule around
 * header items, and a second one of ours inside it reads as a box within a box. `IconButton` is not
 * reused for exactly that reason — it brings its own ring and its own centring, both of which the
 * system is already providing.
 *
 * **Android is given a real box instead**, because none of the above is true there. No capsule is
 * drawn, so nothing owns the button's size but this file, and two things followed from having none.
 * A ripple answers the view's own bounds and not its `hitSlop`, so a glyph-sized view with slop
 * around it responded across 44pt and could only ever light up across 24. And asking for a
 * shapeless ripple turned off the foreground it needed to be drawn at all, which is why there was
 * no feedback rather than small feedback. A box fixes both: it is what the ripple is clipped to,
 * and it is what makes the shapeless kind unnecessary.
 */
export function SettingsButton() {
  const c = useTheme().color;
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(ROUTES.settings)}
      // Bounded, like every other ripple in the app, and drawn over the glyph rather than under it.
      // Borderless is what a shapeless glyph needs, and it costs the foreground to get -- so the
      // ripple went to the underlay and was never seen. The button has a shape on Android now, and
      // a radius of half the target makes the circle that shape.
      android_ripple={ripple(c.specular, false, tokens.size.tapTarget / 2)}
      style={styles.button}
      // Only where the box is smaller than the target. On Android the box *is* the target, and slop
      // on top of it would put responding area outside the part that answers.
      hitSlop={ANDROID ? undefined : IOS_HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel="Settings"
    >
      <Ionicons name="settings-outline" size={HEADER_ICON} color={c.paper} style={styles.icon} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /**
   * On iOS: width, deliberately, and no height.
   *
   * The two axes are owned by different layers, which is why setting both puts the glyph off centre.
   * iOS 26 draws its own glass capsule behind a header item at a fixed 44pt and centres it vertically
   * in the bar. React Navigation lays our view out **top-aligned** in its own container, whose top
   * sits 4pt below where the capsule starts, so giving the view a height centres the glyph inside our
   * box rather than inside the capsule the eye sees. Left alone, the system centres it for us.
   *
   * Horizontally the system does not help: the capsule keeps its 44pt minimum while a 24pt glyph sits
   * at the leading edge of it, 6pt shy of centre. A width, and nothing else, closes that.
   *
   * Both figures were measured off the simulator, not reasoned about.
   *
   * On Android there is no capsule and no top-aligned container to work around, so the button is
   * simply the square it should be, with the glyph centred in it.
   */
  button: {
    width: tokens.size.tapTarget,
    alignItems: "center",
    ...Platform.select({ android: { height: tokens.size.tapTarget, justifyContent: "center" } }),
  },
  icon: {
    /** Android only, and a no-op on iOS: keeps the icon font from adding padding of its own. */
    includeFontPadding: false,
    // Collapse the font's line box onto the glyph, so the centring above has something square to
    // centre; an icon font's line box carries descender space the glyph does not fill, and the gear
    // rides high inside it. iOS is left alone: there the system centres the line box in its capsule,
    // and that is already right.
    ...(ANDROID ? { lineHeight: HEADER_ICON } : {}),
  },
});
