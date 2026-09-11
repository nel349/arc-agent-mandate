import { StyleSheet, Text, TextInput, View } from "react-native";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/**
 * The amount, typed, as the whole of the screen.
 *
 * Kuira's amount step does this and it is the right call for money: the figure is what the person
 * is deciding, so it is set far larger than anything around it, in a light weight so it reads as
 * something still being chosen. The keyboard opens with it, since typing is the only thing to do.
 */
export function AmountHero({
  value, onChangeText, unit, problem,
}: {
  readonly value: string;
  readonly onChangeText: (next: string) => void;
  readonly unit: string;
  /** Said under the figure once there is a figure to judge. */
  readonly problem: string | null;
}) {
  const c = useTheme().color;
  const showProblem = value.length > 0 && problem !== null;

  return (
    <View style={styles.hero}>
      <View style={styles.figure}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder="0"
          placeholderTextColor={c.dim}
          keyboardType="decimal-pad"
          autoFocus
          maxLength={MAX_DIGITS}
          accessibilityLabel={`Limit in ${unit}`}
          style={[styles.input, { color: showProblem ? c.warn : c.paper }]}
        />
        <Text style={[styles.unit, { color: c.muted }]}>{unit}</Text>
      </View>
      {showProblem && <Text style={[styles.problem, { color: c.warn }]}>{problem}</Text>}
    </View>
  );
}

/** Long enough for any real allowance with its decimals, short enough to stay on one line. */
const MAX_DIGITS = 10;

const styles = StyleSheet.create({
  hero: { alignItems: "center", gap: tokens.space.sm },
  figure: { flexDirection: "row", alignItems: "baseline", justifyContent: "center", gap: tokens.space.sm },
  input: {
    ...tokens.type.amountEntry,
    fontVariant: [...tokens.font.tabular],
    textAlign: "center",
    minWidth: tokens.size.tapTarget,
    padding: 0,
  },
  unit: tokens.type.headline,
  problem: { ...tokens.type.footnote, textAlign: "center" },
});
