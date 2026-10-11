import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/**
 * How much of a failure a note shows before it is cut.
 *
 * Enough to recognise which one it was; the console has the rest, and the harness log all of it.
 * One figure, because three screens had each kept their own copy of it.
 */
export const ERROR_LINES = 3;

/**
 * A sentence about what is happening, set apart from the controls.
 *
 * Three of these had grown into the allowances screen as loose `Text` nodes with a private style
 * each — a wallet error, a mandate error, and a not-deployed notice — which is how three things
 * that mean "read this" ended up looking like three unrelated bits of text.
 *
 * `warn` is for something that went wrong or is blocking, and takes the attention colour and its
 * glyph. The default is for a statement of fact, and stays quiet, so a summary of what you are about
 * to authorise does not read as an alarm.
 *
 * A glyph and a sentence, with no box. It was boxed for a moment, with the radius and hairline of a
 * text field, and a note under a field could not be told from one; several in a card were boxes in
 * a box. Before that it had a rule down its leading edge.
 */
export function Note({
  children, tone = "plain", lines,
}: {
  readonly children: string;
  readonly tone?: "plain" | "warn";
  /**
   * Cap the height of text whose length is not ours to control.
   *
   * A chain or bundler error can arrive as a paragraph of hex, and one of those unbounded pushes
   * the whole form off screen. A sentence we wrote ourselves needs no cap and must not get one —
   * truncating the summary of what is about to be authorised would be worse than any layout.
   */
  readonly lines?: number;
}) {
  const c = useTheme().color;
  const warn = tone === "warn";

  return (
    <View style={styles.block}>
      <Ionicons
        name={warn ? "alert-circle-outline" : "information-circle-outline"}
        size={tokens.size.chevron}
        color={warn ? c.warn : c.dim}
        style={styles.glyph}
      />
      <Text style={[styles.text, { color: warn ? c.warn : c.dim }]} numberOfLines={lines}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { flexDirection: "row", alignItems: "flex-start", gap: tokens.space.xs },
  // Dropped by the difference between the line's height and the glyph's, so it sits on the first line.
  glyph: { marginTop: (tokens.type.footnote.lineHeight - tokens.size.chevron) / 2 },
  text: { ...tokens.type.footnote, flex: 1 },
});
