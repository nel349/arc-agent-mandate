import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text } from "react-native";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/** The last row of a short list, opening the whole of it: "See all activity". */
export function MoreRow({ title, onPress }: { readonly title: string; readonly onPress: () => void }) {
  const c = useTheme().color;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.row,
        { borderTopColor: c.hairline },
        pressed && { backgroundColor: c.glass },
      ]}
    >
      <Text style={[styles.title, { color: c.paper }]}>{title}</Text>
      <Ionicons name="chevron-forward" size={tokens.size.chevron} color={c.dim} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.base,
    paddingVertical: tokens.space.md,
    minHeight: tokens.size.tapTarget,
    borderTopWidth: tokens.border.hairline,
  },
  title: tokens.type.body,
});
