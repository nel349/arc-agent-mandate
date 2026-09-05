import { useCallback, useState } from "react";
import { StyleSheet, Text, TextInput, View, type KeyboardTypeOptions } from "react-native";
import { IconButton } from "./IconButton.tsx";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/**
 * A labelled input, with its explanation available rather than always present.
 *
 * The label stays visible while typing — a placeholder alone disappears on focus, taking the one
 * piece of context a person needs exactly when they are acting on it, and leaving a screen reader
 * nothing to announce.
 *
 * The **hint sits behind a `?`**. Written out under every field it doubled each one's height and
 * turned a three-field form into a page of prose. Someone filling in a form they already
 * understand should not have to scroll past the explanation; someone who does not should be one
 * tap from it.
 */
export function Field({
  label, value, onChangeText, placeholder, hint, keyboardType,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (next: string) => void;
  readonly placeholder?: string;
  /** Revealed by the `?`. Say what a good value looks like, not what went wrong. */
  readonly hint?: string;
  readonly keyboardType?: KeyboardTypeOptions;
}) {
  const c = useTheme().color;
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((shown) => !shown), []);

  return (
    <View style={styles.group}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: c.muted }]}>{label}</Text>

        {hint !== undefined && (
          <IconButton
            glyph="?"
            size={tokens.size.control.hint}
            active={open}
            onPress={toggle}
            label={`About ${label}`}
            hint={hint}
          />
        )}
      </View>

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
      />

      {open && hint !== undefined && <Text style={[styles.hint, { color: c.dim }]}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: tokens.space.xs },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: tokens.type.label,
  input: {
    borderWidth: 1,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.base,
    minHeight: tokens.size.tapTarget,
    fontFamily: tokens.font.mono,
    fontSize: tokens.font.body,
  },
  hint: { fontFamily: tokens.font.mono, fontSize: tokens.font.small },
});
