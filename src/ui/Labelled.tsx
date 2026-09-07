import { useCallback, useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { IconButton } from "./IconButton.tsx";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/**
 * A label, an optional explanation behind a `?`, and whatever control the caller puts under it.
 *
 * Extracted because `Field` and `ChoiceRow` both need exactly this and had started to grow two
 * copies of it. The disclosure state belongs here rather than in either one: a hint is a property
 * of the label, not of whether the control beneath it happens to be a text box or a row of pills.
 *
 * The **hint sits behind a `?`** rather than under the field. Written out under every control it
 * doubled each one's height and turned a three-control form into a page of prose. Someone who
 * already knows what an allowance is should not have to scroll past the explanation; someone who
 * does not should be one tap from it.
 */
export function Labelled({
  label, hint, trailing, children,
}: {
  readonly label: string;
  /** Revealed by the `?`. Say what a good value looks like, not what went wrong. */
  readonly hint?: string | undefined;
  /** Sits between the label and the `?` — a validity mark, a count, a unit. */
  readonly trailing?: ReactNode;
  readonly children: ReactNode;
}) {
  const c = useTheme().color;
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((shown) => !shown), []);

  return (
    <View style={styles.group}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: c.muted }]}>{label}</Text>

        <View style={styles.trailing}>
          {trailing}
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
      </View>

      {children}

      {open && hint !== undefined && <Text style={[styles.hint, { color: c.dim }]}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: tokens.space.xs },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  trailing: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  label: tokens.type.label,
  hint: { fontFamily: tokens.font.mono, fontSize: tokens.font.small, lineHeight: tokens.font.smallLineHeight },
});
