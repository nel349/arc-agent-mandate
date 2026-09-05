import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/**
 * A small round control: an icon or a single glyph on glass.
 *
 * Exists because the same thing was built twice and neither was right. The header gear was an
 * inline style object, and the field `?` was a `Text` with a hand-set `lineHeight` pretending to
 * be centring — which is why it sat off-centre. A glyph baseline is not the middle of a circle,
 * and no amount of tuning `lineHeight` makes it one at every text size.
 *
 * Centring is done by the layout instead: a fixed square box with the content centred in both
 * axes. It is correct at any size, and it stays correct when someone turns their system text up.
 */
export function IconButton({
  onPress, children, glyph, label, hint, active = false, size = 34, style,
}: {
  readonly onPress: () => void;
  /** An icon element. Use this or `glyph`, not both. */
  readonly children?: ReactNode;
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
      {glyph === undefined ? (
        children
      ) : (
        <Text style={[styles.glyph, { color: active ? c.signal : c.dim }]}>{glyph}</Text>
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
    fontSize: tokens.font.small,
    fontWeight: "700",
    // No lineHeight: the box centres it. Setting one here would reintroduce the bug this
    // component exists to fix.
  },
});
