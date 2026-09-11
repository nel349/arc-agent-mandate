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
 *
 * **The row's layout sits on an inner view, not on the `Pressable`.** `Link asChild` hands the
 * pressable its props through a merge that did not keep an array style intact, so the row lost
 * `flexDirection` and the chevron dropped under the text on every row in Settings. An inner view
 * is out of the merge's reach.
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
      <Pressable accessibilityRole="link" accessibilityLabel={name} accessibilityHint={hint}>
        <View style={styles.row}>
          <View style={styles.labels}>
            <Text style={[styles.name, { color: c.paper }]}>{name}</Text>
            <Text style={[styles.note, { color: c.dim }]}>{note}</Text>
          </View>
          <Ionicons name="chevron-forward" size={tokens.size.chevron} color={c.dim} />
        </View>
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
    paddingVertical: tokens.space.xs,
  },
  labels: { flex: 1, gap: 2 },
  name: tokens.type.body,
  note: tokens.type.footnote,
});
