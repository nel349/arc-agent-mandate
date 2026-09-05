import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Labelled } from "./Labelled.tsx";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

export interface Choice<T> {
  /** What the pill reads. Write the unit in, so the row needs no legend: `7 days`, not `7`. */
  readonly label: string;
  readonly value: T;
}

/**
 * A bounded value, chosen rather than typed.
 *
 * Both of the numbers this form asks for are bounded in practice, and a number pad was the wrong
 * instrument for either. "Expires after · days" was the clearer mistake: nobody holds an allowance
 * window as an integer, they hold it as *a day, a week, a month*, and typing `7` made the person
 * do the conversion the app should have done. Pills put the real vocabulary on the screen.
 *
 * Chosen over a native menu deliberately, though `zeego` is the usual answer for a dropdown. With
 * four options a menu costs two taps and hides the choices until the first one; a row costs one
 * tap and shows them at rest. A menu earns its keep when the list is long enough that showing it
 * would crowd the screen. Four pills do not crowd anything.
 *
 * **Custom** keeps the row honest. Presets that cannot be escaped are a smaller cage than a text
 * box, so the caller passes the field to reveal and it appears under the pills when chosen.
 */
export function ChoiceRow<T extends string>({
  label, hint, options, selected, onSelect, custom,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly options: readonly Choice<T>[];
  /**
   * The chosen preset. `custom.active` independently suppresses every preset highlight, so a
   * caller that keeps one value behind both the pills and the custom field — which is the shape
   * this is built for — can pass that value straight through and never needs `null`.
   */
  readonly selected: T | null;
  readonly onSelect: (value: T) => void;
  /** Grouped rather than passed as three loose props, because they are one feature. */
  readonly custom?: {
    readonly label?: string;
    readonly active: boolean;
    readonly onSelect: () => void;
    readonly children: ReactNode;
  };
}) {
  return (
    <Labelled label={label} hint={hint}>
      <View style={styles.row} accessibilityRole="radiogroup">
        {options.map((option) => (
          <Pill
            key={option.value}
            title={option.label}
            selected={custom?.active !== true && option.value === selected}
            onPress={() => onSelect(option.value)}
          />
        ))}
        {custom !== undefined && (
          <Pill
            title={custom.label ?? "Custom"}
            selected={custom.active}
            onPress={custom.onSelect}
          />
        )}
      </View>
      {custom?.active === true && custom.children}
    </Labelled>
  );
}

/**
 * Selection is drawn with `paper`, not `actionFill` or `signal`.
 *
 * `actionFill` belongs to the one thing the screen wants you to do, and a row of bright pills
 * beside the Grant button would leave neither looking primary. `signal` means *live* and nothing
 * else. A brightened edge and full-strength text says "chosen" without borrowing either.
 */
function Pill({
  title, selected, onPress,
}: {
  readonly title: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  const c = useTheme().color;

  return (
    <Pressable
      onPress={onPress}
      // The pill is shorter than a comfortable target so a row of them does not tower over the
      // fields around it. `hitSlop` takes the touch area back to 44pt without the pill looking it.
      hitSlop={Math.round((tokens.size.tapTarget - tokens.size.control.pill) / 2)}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={title}
      style={[
        styles.pill,
        selected
          ? { backgroundColor: c.glass, borderColor: c.paper, borderTopColor: c.specular }
          : { backgroundColor: "transparent", borderColor: c.hairline },
      ]}
    >
      <Text style={[styles.pillText, { color: selected ? c.paper : c.dim }]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: tokens.space.sm },
  pill: {
    height: tokens.size.control.pill,
    paddingHorizontal: tokens.space.base,
    borderRadius: tokens.radius.pill,
    borderWidth: tokens.border.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  pillText: {
    fontFamily: tokens.font.mono,
    fontSize: tokens.font.body,
  },
});
