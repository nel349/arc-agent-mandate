import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/**
 * A sentence about what is happening, set apart from the controls.
 *
 * Three of these had grown into the allowances screen as loose `Text` nodes with a private style
 * each — a wallet error, a mandate error, and a not-deployed notice — which is how three things
 * that mean "read this" ended up looking like three unrelated bits of text.
 *
 * `warn` is for something that went wrong or is blocking. The default is for a statement of fact,
 * and gets a leading rule rather than a colour, so a summary of what you are about to authorise
 * does not read as an alarm.
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
    <View style={[styles.block, { borderLeftColor: warn ? c.warn : c.hairline }]}>
      <Text style={[styles.text, { color: warn ? c.warn : c.dim }]} numberOfLines={lines}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    borderLeftWidth: 2,
    paddingLeft: tokens.space.md,
    paddingVertical: tokens.space.xs,
  },
  // A sentence, so the system font. It was mono, which made the one line meant to be read in full
  // the hardest one on the screen to read.
  text: tokens.type.footnote,
});
