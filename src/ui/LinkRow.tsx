import Ionicons from "@expo/vector-icons/Ionicons";
import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/**
 * A row that goes somewhere: a name, a line saying what is there, and a chevron.
 *
 * Extracted at the second one. The first copy was fine; a second would have been two places to
 * remember when the row's border, height or chevron changes, and rows are exactly the thing that
 * quietly drifts apart.
 */
export function LinkRow({
  href, name, note, hint,
}: {
  readonly href: string;
  readonly name: string;
  /** One line under the name, so the row explains itself without being opened. */
  readonly note: string;
  /** For a screen reader, where the chevron alone says nothing about the destination. */
  readonly hint: string;
}) {
  const c = useTheme().color;

  return (
    <Link href={href} asChild>
      <Pressable
        style={[styles.row, { borderColor: c.hairline }]}
        accessibilityRole="link"
        accessibilityLabel={name}
        accessibilityHint={hint}
      >
        <View style={styles.labels}>
          <Text style={[styles.name, { color: c.paper }]}>{name}</Text>
          <Text style={[styles.note, { color: c.dim }]}>{note}</Text>
        </View>
        <Ionicons name="chevron-forward" size={tokens.size.chevron} color={c.dim} />
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space.md,
    minHeight: tokens.size.tapTarget,
  },
  labels: { flex: 1, gap: tokens.space.xs },
  name: { fontFamily: tokens.font.mono, fontSize: tokens.font.body },
  note: { fontFamily: tokens.font.mono, fontSize: tokens.font.small },
});
