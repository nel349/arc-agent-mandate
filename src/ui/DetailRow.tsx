import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/**
 * A label and its value on one line, as a row in an iOS inset list.
 *
 * Extracted at the third copy: the agent's screen, the receipt and the grant review each had their
 * own, and three copies of a row is how one of them ends up with a different height or rule.
 */
export function DetailRow({
  label, value, first = false, data = false,
}: {
  readonly label: string;
  readonly value: string;
  /** The first row in a group has no rule above it. */
  readonly first?: boolean;
  /** The value is an address or a hash, set in mono like every other one in the app. */
  readonly data?: boolean;
}) {
  const c = useTheme().color;
  return (
    <View
      style={[styles.row, !first && { borderTopWidth: tokens.border.hairline, borderTopColor: c.hairline }]}
      accessible
      accessibilityLabel={`${label}: ${value}`}
    >
      <Text style={[styles.label, { color: c.muted }]}>{label}</Text>
      <Text style={[data ? styles.data : styles.value, { color: c.paper }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.base,
    paddingVertical: tokens.space.md,
    minHeight: tokens.size.tapTarget,
  },
  label: tokens.type.body,
  value: { ...tokens.type.body, flexShrink: 1, textAlign: "right", fontVariant: [...tokens.font.tabular] },
  data: { ...tokens.type.data, flexShrink: 1, textAlign: "right" },
});
