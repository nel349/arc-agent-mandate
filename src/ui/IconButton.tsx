import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, type ViewStyle } from "react-native";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/**
 * A small round control: an icon or a single glyph on glass.
 *
 * Exists because the same thing was built twice and neither was right: an inline style object for
 * the header gear, and a `Text` with a hand-set `lineHeight` for the field `?`.
 *
 * Centring takes two things, and using either alone is what kept these off-centre. **The flex box
 * does the centring** — a fixed square with content centred on both axes, correct at any size.
 * And **`lineHeight` collapses the text line box onto the glyph**, because a font's line box
 * carries ascender and descender space the glyph does not fill, so centring the box leaves the
 * glyph visibly high. The second is not centring; it removes the phantom space the first would
 * otherwise centre around.
 */
export function IconButton({
  onPress, icon, glyph, label, hint, active = false, size = 34, style,
}: {
  readonly onPress: () => void;
  /**
   * An Ionicons name. Rendered here rather than passed in as a child, because an icon font's line
   * box is taller than its glyph and the glyph does not sit in the middle of it — so a caller
   * handing over an `<Ionicons>` gets something visibly off-centre no matter how well the
   * container centres. Owning it means the metrics are fixed in one place.
   */
  readonly icon?: keyof typeof Ionicons.glyphMap;
  /** A single character, when an icon would be heavier than the thing it labels. */
  readonly glyph?: string;
  readonly label: string;
  readonly hint?: string;
  /** Lit, for a disclosure that is currently open. */
  readonly active?: boolean;
  readonly size?: number;
  readonly style?: ViewStyle;
}) {
  const c = useTheme().color;
  const edge = active ? c.signal : c.hairline;

  return (
    <Pressable
      onPress={onPress}
      // The visible control is smaller than a comfortable target on purpose — a 44pt gear would
      // dominate a header. `hitSlop` takes the touch area past 44 without the button looking it.
      hitSlop={Math.max(0, Math.round((tokens.size.tapTarget - size) / 2))}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ expanded: active }}
      style={[
        styles.box,
        {
          width: size,
          height: size,
          backgroundColor: c.glass,
          borderColor: edge,
          borderTopColor: active ? c.signal : c.specular,
        },
        style,
      ]}
    >
      {icon !== undefined && (
        <Ionicons
          name={icon}
          size={Math.round(size * 0.52)}
          color={active ? c.signal : c.paper}
          // Collapse the font's line box onto the glyph so the flex centring above has something
          // square to centre. Without it the glyph rides high by the font's descender.
          style={{ lineHeight: Math.round(size * 0.52) }}
        />
      )}
      {glyph !== undefined && (
        <Text
          style={[
            styles.glyph,
            {
              color: active ? c.signal : c.dim,
              // Both scale with the button, so the glyph is correct at any size rather than only
              // at the one it was eyeballed against.
              fontSize: Math.round(size * 0.55),
              lineHeight: Math.round(size * 0.55),
            },
          ]}
        >
          {glyph}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: 99,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  glyph: {
    fontFamily: tokens.font.mono,
    fontWeight: "700",
    textAlign: "center",
    // `lineHeight` is set per instance from `size`. It is not the centring — the flex box does
    // that — it collapses the text line box so there is no descender space to centre around.
    includeFontPadding: false,
  },
});
