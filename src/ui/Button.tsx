import { memo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { tokens } from "./tokens.ts";

/**
 * Two tiers, and only two.
 *
 * **Solid** is the one thing this screen wants you to do. **Glass** is everything else. Netflix's
 * mobile chrome makes the same split — one filled pill, the rest translucent — and it works
 * because a screen with two solid buttons has told you nothing about which matters.
 */
export const Button = memo(function Button({
  title, onPress, busy = false, disabled = false, tier = "glass",
}: {
  readonly title: string;
  readonly onPress: () => void;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly tier?: "solid" | "glass" | "quiet";
}) {
  const off = busy || disabled;
  const style = off ? styles[`${tier}Off`] : styles[tier];
  return (
    <Pressable style={style} onPress={onPress} disabled={off}>
      {busy ? (
        <ActivityIndicator color={tier === "solid" ? tokens.color.background : tokens.color.text} />
      ) : (
        <Text style={tier === "solid" ? styles.solidText : styles.glassText}>{title}</Text>
      )}
    </Pressable>
  );
});

const base = {
  borderRadius: tokens.radius.pill,
  paddingVertical: tokens.space.base,
  paddingHorizontal: tokens.space.lg,
  alignItems: "center",
  justifyContent: "center",
} as const;

const solid = { ...base, backgroundColor: tokens.color.accentBright };
const glass = {
  ...base,
  backgroundColor: tokens.color.glass,
  borderWidth: tokens.border.hairline,
  borderColor: tokens.color.glassBorder,
};
/** No fill and no edge — for an action that should be available without being offered. */
const quiet = { ...base, paddingVertical: tokens.space.xs };

const styles = StyleSheet.create({
  solid,
  glass,
  quiet,
  solidOff: { ...solid, opacity: tokens.opacity.disabled },
  glassOff: { ...glass, opacity: tokens.opacity.disabled },
  quietOff: { ...quiet, opacity: tokens.opacity.disabled },
  /** Dark text on the bright fill: the only place on these screens that inverts. */
  solidText: { color: tokens.color.background, fontWeight: "700", fontSize: tokens.font.body },
  glassText: { color: tokens.color.text, fontWeight: "600", fontSize: tokens.font.body },
});
