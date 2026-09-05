import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/**
 * Two tiers, and only two.
 *
 * **Solid** is the one thing a screen wants you to do. **Glass** is everything else. A screen with
 * two solid buttons has told you nothing about which matters.
 */
export function Button({
  title, onPress, busy = false, disabled = false, tier = "glass", compact = false,
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
   * false of the Revoke sitting on each allowance in a list — stacked, they read as a column of
   * equally urgent demands rather than as one small action belonging to each row.
   */
  readonly compact?: boolean;
}) {
  const c = useTheme().color;
  const off = busy || disabled;
  const solid = tier === "solid";

  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      accessibilityLabel={title}
      style={[
        compact ? styles.compact : styles.base,
        solid
          ? { backgroundColor: c.actionFill }
          : { backgroundColor: c.glass, borderWidth: 1, borderColor: c.hairline, borderTopColor: c.specular },
        off && styles.off,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={solid ? c.actionText : c.paper} />
      ) : (
        <Text style={[styles.label, { color: solid ? c.actionText : c.paper }]}>{title}</Text>
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
  off: { opacity: tokens.opacity.disabled },
  label: tokens.type.label,
});
