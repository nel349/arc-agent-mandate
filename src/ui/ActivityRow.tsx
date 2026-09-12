import Ionicons from "@expo/vector-icons/Ionicons";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Activity, ActivityKind } from "../arc/activity.ts";
import { activityAmount, type ActivityRowText } from "./activity-format.ts";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/** A shape per kind of row, so a grant and a payment differ before either is read. */
const GLYPHS: Readonly<Record<ActivityKind, keyof typeof Ionicons.glyphMap>> = {
  draw: "bag-handle-outline",
  /** Sent to somebody, rather than moved into the agent's own escrow. */
  paid: "paper-plane-outline",
  registered: "finger-print-outline",
  granted: "add-circle-outline",
  revoked: "close-circle-outline",
};

/**
 * One thing an agent did: a glyph for the kind, two lines saying who and when, and the amount.
 *
 * Presentational: the words come in already written, from `activityRowText`, so the list, an
 * agent's screen and the home screen can each say it the way their context needs.
 */
function ActivityRowView({
  item, text, onPress, first,
}: {
  readonly item: Activity;
  readonly text: ActivityRowText;
  readonly onPress: (item: Activity) => void;
  readonly first: boolean;
}) {
  const c = useTheme().color;
  const amount = activityAmount(item);
  const { title, detail } = text;

  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}.${amount === null ? "" : ` ${amount} USDC.`}`}
      accessibilityHint="Opens the receipt"
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopWidth: tokens.border.hairline, borderTopColor: c.hairline },
        pressed && { backgroundColor: c.glass },
      ]}
    >
      <View style={[styles.glyph, { borderColor: c.hairline }]}>
        <Ionicons name={GLYPHS[item.kind]} size={tokens.size.buttonIcon} color={c.muted} />
      </View>
      <View style={styles.text}>
        <Text style={[text.titleIsAddress ? styles.address : styles.title, { color: c.paper }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.detail, { color: c.dim }]} numberOfLines={1}>{detail}</Text>
      </View>
      {amount !== null && <Text style={[styles.amount, { color: c.paper }]}>{amount}</Text>}
      <Ionicons name="chevron-forward" size={tokens.size.chevron} color={c.dim} />
    </Pressable>
  );
}

/**
 * Compared by value, as `MandateCard` is, and for the same reason.
 *
 * The words arrive as a fresh object from `activityRowText` on every render of the list, so a memo
 * comparing by reference never matched and every row re-rendered on each ten-second poll — a feed of
 * five hundred rows, redrawn for figures that had not changed. These are everything a row draws.
 */
export const ActivityRow = memo(ActivityRowView, (a, b) =>
  a.first === b.first &&
  a.onPress === b.onPress &&
  a.item.tx === b.item.tx &&
  a.item.logIndex === b.item.logIndex &&
  a.item.kind === b.item.kind &&
  a.item.amount?.toNativeUnits() === b.item.amount?.toNativeUnits() &&
  a.text.title === b.text.title &&
  a.text.detail === b.text.detail &&
  a.text.titleIsAddress === b.text.titleIsAddress,
);

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.md,
    paddingHorizontal: tokens.space.base,
    minHeight: tokens.size.tapTarget,
  },
  glyph: {
    width: tokens.size.ring.row,
    height: tokens.size.ring.row,
    borderRadius: tokens.radius.pill,
    borderWidth: tokens.border.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { flex: 1, gap: tokens.space.hair },
  title: tokens.type.headline,
  /** Matches the agent list, where an unnamed agent is also its address in mono. */
  address: { ...tokens.type.data, fontWeight: "600" },
  detail: tokens.type.footnote,
  amount: { ...tokens.type.headline, fontVariant: [...tokens.font.tabular] },
});
