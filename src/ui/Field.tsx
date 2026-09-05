import { StyleSheet, Text, TextInput, View, type KeyboardTypeOptions } from "react-native";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/**
 * A labelled input.
 *
 * The label stays visible while typing. A placeholder alone disappears the moment the field is
 * focused, so a person loses the one piece of context they need exactly when they are acting on
 * it — and a screen reader has nothing to announce.
 */
export function Field({
  label, value, onChangeText, placeholder, hint, keyboardType,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (next: string) => void;
  readonly placeholder?: string;
  /** Say what a good value looks like, not what went wrong. */
  readonly hint?: string;
  readonly keyboardType?: KeyboardTypeOptions;
}) {
  const c = useTheme().color;
  return (
    <View style={styles.group}>
      <Text style={[styles.label, { color: c.muted }]}>{label}</Text>
      <TextInput
        style={[styles.input, { backgroundColor: c.groundLow, borderColor: c.hairline, color: c.paper }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.dim}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={label}
        accessibilityHint={hint}
      />
      {hint !== undefined && <Text style={[styles.hint, { color: c.dim }]}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: tokens.space.xs },
  label: {
    fontFamily: tokens.font.mono,
    fontSize: tokens.font.label,
    letterSpacing: tokens.font.labelTracking,
    textTransform: "uppercase",
  },
  input: {
    borderWidth: 1,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.base,
    minHeight: 46,
    fontFamily: tokens.font.mono,
    fontSize: tokens.font.body,
  },
  hint: { fontFamily: tokens.font.mono, fontSize: tokens.font.small },
});
