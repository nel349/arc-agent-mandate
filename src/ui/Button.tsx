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
  title, onPress, busy = false, disabled = false, tier = "glass",
}: {
  readonly title: string;
  readonly onPress: () => void;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly tier?: "solid" | "glass";
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
        styles.base,
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
  base: {
    borderRadius: tokens.radius.lg,
    paddingVertical: tokens.space.base,
    paddingHorizontal: tokens.space.lg,
    alignItems: "center",
    justifyContent: "center",
    minHeight: tokens.size.tapTarget,
  },
  off: { opacity: tokens.opacity.disabled },
  label: {
    fontFamily: tokens.font.mono,
    fontSize: tokens.font.small,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
});
