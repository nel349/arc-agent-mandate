import { Pressable, StyleSheet, Text } from "react-native";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/**
 * Who this allowance is for, carried onto every later step, with a way back to change it. Kuira's
 * amount step carries its recipient the same way, so the person never types a number without
 * seeing who it is for.
 */
export function AgentChip({ who, onEdit }: { readonly who: string; readonly onEdit: () => void }) {
  const c = useTheme().color;
  return (
    <Pressable
      onPress={onEdit}
      accessibilityRole="button"
      accessibilityLabel={`For ${who}. Change the agent`}
      style={({ pressed }) => [styles.chip, { backgroundColor: c.glass }, pressed && styles.pressed]}
    >
      <Text style={[styles.who, { color: c.muted }]} numberOfLines={1}>For {who}</Text>
      <Text style={[styles.edit, { color: c.paper }]}>Edit</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space.sm,
    minHeight: tokens.size.tapTarget,
    paddingHorizontal: tokens.space.base,
    borderRadius: tokens.radius.md,
  },
  who: { ...tokens.type.subheadline, flexShrink: 1 },
  edit: { ...tokens.type.subheadline, fontWeight: "600" },
  pressed: { opacity: tokens.opacity.pressed },
});
