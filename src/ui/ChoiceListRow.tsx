import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/**
 * One choice in a list, as a whole row: what it is, what it means, and a tick when chosen.
 *
 * For a choice worth a line of explanation each, such as how long an allowance runs, where the
 * explanation is the date it would end. Pills cannot carry that second line; rows can, and a row is
 * a far larger target than a pill.
 */
export function ChoiceListRow({
  title, detail, selected, onPress, first,
}: {
  readonly title: string;
  readonly detail: string;
  readonly selected: boolean;
  readonly onPress: () => void;
  /** The first row in a group has no rule above it. */
  readonly first: boolean;
}) {
  const c = useTheme().color;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}. ${detail}`}
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopWidth: tokens.border.hairline, borderTopColor: c.hairline },
        pressed && { backgroundColor: c.glass },
      ]}
    >
      <View style={styles.text}>
        <Text style={[styles.title, { color: c.paper }]}>{title}</Text>
        <Text style={[styles.detail, { color: c.dim }]}>{detail}</Text>
      </View>
      {selected
        ? <Ionicons name="checkmark" size={tokens.size.buttonIcon} color={c.paper} />
        : <Ionicons name="chevron-forward" size={tokens.size.chevron} color={c.dim} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.base,
    paddingVertical: tokens.space.md,
    minHeight: tokens.size.control.preset,
  },
  text: { flex: 1, gap: 2 },
  title: tokens.type.headline,
  detail: tokens.type.footnote,
});
