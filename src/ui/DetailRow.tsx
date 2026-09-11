import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/**
 * A label and its value on one line, as a row in an iOS inset list.
 *
 * Extracted at the third copy: the agent's screen, the receipt and the grant review each had their
 * own, and three copies of a row is how one of them ends up with a different height or rule.
 *
 * With `onPress` the row is a link: a hash or an address that opens somewhere to be checked, marked
 * with the same external-link glyph as the buttons that open ArcScan, so it reads as tappable before
 * anyone tries it.
 */
export function DetailRow({
  label, value, first = false, data = false, onPress, hint,
}: {
  readonly label: string;
  readonly value: string;
  /** The first row in a group has no rule above it. */
  readonly first?: boolean;
  /** The value is an address or a hash, set in mono like every other one in the app. */
  readonly data?: boolean;
  /** Makes the whole row a link to somewhere outside the app. */
  readonly onPress?: () => void;
  /** Where the link goes, for VoiceOver. */
  readonly hint?: string;
}) {
  const c = useTheme().color;
  const rule = !first && { borderTopWidth: tokens.border.hairline, borderTopColor: c.hairline };
  const content = (
    <>
      <Text style={[styles.label, { color: c.muted }]}>{label}</Text>
      <View style={styles.valueLine}>
        <Text style={[data ? styles.data : styles.value, { color: c.paper }]}>{value}</Text>
        {onPress !== undefined && (
          <Ionicons name="open-outline" size={tokens.size.buttonIcon} color={c.muted} />
        )}
      </View>
    </>
  );

  if (onPress === undefined) {
    return (
      <View style={[styles.row, rule]} accessible accessibilityLabel={`${label}: ${value}`}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`${label}: ${value}`}
      {...(hint === undefined ? {} : { accessibilityHint: hint })}
      style={({ pressed }) => [styles.row, rule, pressed && { opacity: tokens.opacity.pressed }]}
    >
      {content}
    </Pressable>
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
  valueLine: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs, flexShrink: 1 },
  value: { ...tokens.type.body, flexShrink: 1, textAlign: "right", fontVariant: [...tokens.font.tabular] },
  data: { ...tokens.type.data, flexShrink: 1, textAlign: "right" },
});
