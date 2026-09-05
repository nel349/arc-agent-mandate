import { memo } from "react";
import { StyleSheet, Text, TextInput, View, type KeyboardTypeOptions } from "react-native";
import { tokens } from "./tokens.ts";

/**
 * A labelled input.
 *
 * The label stays visible while typing. A placeholder alone disappears the moment the field is
 * focused, so the person loses the one piece of context they need exactly when they are acting on
 * it — and a screen reader has nothing to announce. The placeholder is an example here, not the
 * label doing double duty.
 */
export const Field = memo(function Field({
  label, value, onChangeText, placeholder, hint, keyboardType, mono = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (next: string) => void;
  readonly placeholder?: string;
  /** Shown under the field. Say what a good value looks like, not what went wrong. */
  readonly hint?: string;
  readonly keyboardType?: KeyboardTypeOptions;
  readonly mono?: boolean;
}) {
  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={mono ? styles.inputMono : styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={tokens.color.textMuted}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={label}
        accessibilityHint={hint}
      />
      {hint !== undefined && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
});

const input = {
  backgroundColor: tokens.color.background,
  borderWidth: 1,
  borderColor: tokens.color.glassBorder,
  borderRadius: tokens.radius.md,
  paddingHorizontal: tokens.space.base,
  // 44pt is the smallest comfortable touch target; a text field shorter than that is a miss.
  minHeight: 46,
  color: tokens.color.text,
  fontSize: tokens.font.body,
} as const;

const styles = StyleSheet.create({
  group: { gap: tokens.space.xs },
  label: {
    color: tokens.color.textMuted,
    fontSize: tokens.font.label,
    textTransform: "uppercase",
    letterSpacing: tokens.font.labelTracking,
  },
  input,
  inputMono: { ...input, fontFamily: tokens.font.mono, fontSize: tokens.font.small },
  hint: { color: tokens.color.textMuted, fontSize: tokens.font.small },
});
