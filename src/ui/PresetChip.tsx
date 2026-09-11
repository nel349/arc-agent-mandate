import { Pressable, StyleSheet, Text } from "react-native";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/**
 * One of a row of preset amounts under an amount being typed. Full height and sharing the width
 * equally, as Kuira's are, so each is a thumb-sized target rather than a pill to aim at.
 */
export function PresetChip({
  label, onPress, selected,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly selected: boolean;
}) {
  const c = useTheme().color;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: c.glass, borderColor: selected ? c.paper : c.hairline },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.label, { color: selected ? c.paper : c.muted }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flex: 1,
    height: tokens.size.control.preset,
    borderRadius: tokens.radius.md,
    borderWidth: tokens.border.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { ...tokens.type.headline, fontVariant: [...tokens.font.tabular] },
  pressed: { opacity: tokens.opacity.pressed },
});
