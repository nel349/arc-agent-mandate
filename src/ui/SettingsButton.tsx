import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet } from "react-native";
import { ROUTES } from "./routes.ts";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/** Sized from the shared control scale, so it matches the `?` controls in content. */
const HEADER_ICON = Math.round(tokens.size.control.header * tokens.size.glyphScale);

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
 * `hitSlop` restores the touch target the glyph is too small to fill on its own.
 */
export function SettingsButton() {
  const c = useTheme().color;
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(ROUTES.settings)}
      style={styles.button}
      hitSlop={Math.round((tokens.size.tapTarget - HEADER_ICON) / 2)}
      accessibilityRole="button"
      accessibilityLabel="Settings"
    >
      <Ionicons name="settings-outline" size={HEADER_ICON} color={c.paper} style={styles.icon} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /**
   * Width, deliberately, and no height.
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
   */
  button: { width: tokens.size.tapTarget, alignItems: "center" },
  /** Android only, and a no-op on iOS: keeps the icon font from adding padding of its own. */
  icon: { includeFontPadding: false },
});
