import Ionicons from "@expo/vector-icons/Ionicons";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/**
 * Two tiers, and only two.
 *
 * **Solid** is the one thing a screen wants you to do. **Glass** is everything else. A screen with
 * two solid buttons has told you nothing about which matters.
 */
export function Button({
  title, onPress, busy = false, disabled = false, tier = "glass", compact = false, icon, tone = "plain",
}: {
  readonly title: string;
  readonly onPress: () => void;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly tier?: "solid" | "glass";
  /**
   * Sized to its own text rather than to the width available.
   *
   * A full-width button is a claim that this is what the screen is for. That is true of Grant, and
   * false of a small action belonging to one row.
   */
  readonly compact?: boolean;
  /** A glyph before the title, when the action has a shape people already know, like a QR code. */
  readonly icon?: keyof typeof Ionicons.glyphMap;
  /**
   * `warn` for the action that takes something away. Glass only: the colour goes on the words, so
   * the button stays quiet until it is read, and the refusal colour never fills a whole bar.
   */
  readonly tone?: "plain" | "warn";
}) {
  const c = useTheme().color;
  const off = busy || disabled;
  const solid = tier === "solid";
  const ink = solid ? c.actionText : tone === "warn" ? c.warn : c.paper;

  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      accessibilityLabel={title}
      style={({ pressed }) => [
        compact ? styles.compact : styles.base,
        solid
          ? { backgroundColor: c.actionFill }
          : { backgroundColor: c.glass, borderWidth: 1, borderColor: c.hairline, borderTopColor: c.specular },
        off && styles.off,
        pressed && !off && styles.pressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={ink} />
      ) : (
        <View style={styles.inner}>
          {icon !== undefined && <Ionicons name={icon} size={tokens.size.buttonIcon} color={ink} />}
          <Text style={[styles.label, { color: ink }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  compact: {
    borderRadius: tokens.radius.pill,
    paddingHorizontal: tokens.space.base,
    alignItems: "center",
    justifyContent: "center",
    minHeight: tokens.size.control.pill,
    // Where it sits is the caller's layout, not the button's. `alignSelf` here would quietly beat
    // the parent's own alignment, which is exactly the bug it caused.
  },
  base: {
    borderRadius: tokens.radius.lg,
    paddingVertical: tokens.space.base,
    paddingHorizontal: tokens.space.lg,
    alignItems: "center",
    justifyContent: "center",
    minHeight: tokens.size.tapTarget,
  },
  inner: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  off: { opacity: tokens.opacity.disabled },
  /** Pressed reads as the surface dipping, not as a colour change that could be mistaken for a state. */
  pressed: { opacity: tokens.opacity.pressed },
  // Sentence case in the system font, as iOS sets its own buttons. Uppercase mono made every
  // button look like a heading, and a heading like a button.
  label: tokens.type.button,
});
