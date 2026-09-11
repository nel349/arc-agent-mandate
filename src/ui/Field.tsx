import { useCallback, useState, type ReactNode } from "react";
import { StyleSheet, Text, TextInput, type KeyboardTypeOptions } from "react-native";
import { Labelled } from "./Labelled.tsx";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/**
 * A labelled input that reports on what it has been given.
 *
 * The label stays visible while typing — a placeholder alone disappears on focus, taking the one
 * piece of context a person needs exactly when they are acting on it, and leaving a screen reader
 * nothing to announce.
 *
 * **`problem` exists because silence was the old behaviour.** A mistyped address used to do
 * nothing but dim the Grant button, leaving the person to guess which of three controls was at
 * fault. A field that can be wrong has to be able to say so, next to itself, while it is still
 * the thing being looked at. It stays quiet until there is something to judge, so a form does not
 * open covered in complaints about fields nobody has reached yet.
 */
export function Field({
  label, value, onChangeText, placeholder, hint, keyboardType, problem, confirmed = false, action,
  data = false, onDone, maxLength,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (next: string) => void;
  readonly placeholder?: string;
  /** Revealed by the `?`. Say what a good value looks like, not what went wrong. */
  readonly hint?: string;
  readonly keyboardType?: KeyboardTypeOptions;
  /** What is wrong with the current value, or `null` when nothing is. Shown only once typing starts. */
  readonly problem?: string | null;
  /** Accepted, and worth confirming — an address that checks out reads the same as one that does not. */
  readonly confirmed?: boolean;
  /** A shortcut to filling this in, shown beside the label. Scanning a code, for instance. */
  readonly action?: ReactNode;
  /**
   * The value is compared character by character, like an address, so it is set in mono and small
   * enough to fit one line. An amount or a count is read as a number, and gets the body size.
   */
  readonly data?: boolean;
  /** Called when editing ends, for a value that is kept as soon as the person is done with it. */
  readonly onDone?: () => void;
  readonly maxLength?: number;
}) {
  const c = useTheme().color;

  // Emptiness alone cannot tell "not reached yet" from "just cleared", and the two want opposite
  // treatment: silence on the first, an explanation on the second. Without this, clearing a field
  // dimmed the button and said nothing — the very behaviour `problem` exists to end.
  const [touched, setTouched] = useState(false);
  const change = useCallback((next: string) => { setTouched(true); onChangeText(next); }, [onChangeText]);

  const showProblem = (value.length > 0 || touched) && problem !== null && problem !== undefined;
  // A refusal earns a coloured edge; an acceptance does not. Ringing the whole box on every valid
  // value makes a filled-in form shout, and `signal` is the palette's word for *live* — a meter
  // filling, a pulse — not for "this parsed". The ✓ beside the label carries it instead.
  const edge = showProblem ? c.warn : c.hairline;

  return (
    <Labelled
      label={label}
      hint={hint}
      trailing={
        <>
          {confirmed && !showProblem && <Text style={[styles.mark, { color: c.good }]}>✓</Text>}
          {action}
        </>
      }
    >
      <TextInput
        style={[
          styles.input,
          data ? styles.dataText : styles.numberText,
          { backgroundColor: c.groundLow, borderColor: edge, color: c.paper },
        ]}
        value={value}
        onChangeText={change}
        placeholder={placeholder}
        placeholderTextColor={c.dim}
        keyboardType={keyboardType}
        onEndEditing={onDone}
        maxLength={maxLength}
        // Words for a name, nothing for an address or a number: capitalising "0x" would break it.
        autoCapitalize={data || keyboardType !== undefined ? "none" : "words"}
        autoCorrect={false}
        accessibilityLabel={label}
      />

      {showProblem && <Text style={[styles.problem, { color: c.warn }]}>{problem}</Text>}
    </Labelled>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: tokens.border.hairline,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.base,
    minHeight: tokens.size.tapTarget,
  },
  // `lineHeight` is dropped from both: on a single-line input iOS adds it above the text rather
  // than around it, which pushes the value visibly low in its box.
  dataText: { fontFamily: tokens.type.data.fontFamily, fontSize: tokens.type.data.fontSize },
  numberText: { fontSize: tokens.type.body.fontSize, fontVariant: [...tokens.font.tabular] },
  problem: tokens.type.footnote,
  mark: tokens.type.headline,
});
