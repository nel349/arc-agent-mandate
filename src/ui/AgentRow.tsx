import Ionicons from "@expo/vector-icons/Ionicons";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Mandate } from "../arc/mandate.ts";
import { ArcRing } from "./ArcRing.tsx";
import { agentRowLabel, endsLine, fractionUsed, hasEnded, shortAddress } from "./mandate-format.ts";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/**
 * One agent in the list: who it is, what it has left, and until when.
 *
 * The whole row is the button, and it opens the agent's own screen. The row used to be a card
 * carrying every figure and a Revoke, repeated for each agent, which made the list a wall of
 * controls. The pattern the best apps share is a summary you tap into, with the off switch on the
 * item's own screen, so that is what this is.
 *
 * What is **left** is the figure on the right, because it is the one checked before deciding
 * whether to step in.
 */
function AgentRowView({
  mandate, name, onPress, first,
}: {
  readonly mandate: Mandate;
  readonly name: string | null;
  readonly onPress: (agent: `0x${string}`) => void;
  /** The first row in a group has no rule above it. */
  readonly first: boolean;
}) {
  const c = useTheme().color;
  const ended = hasEnded(mandate);

  return (
    <Pressable
      onPress={() => onPress(mandate.agent)}
      accessibilityRole="button"
      accessibilityLabel={agentRowLabel(mandate, name)}
      accessibilityHint="Opens this allowance"
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopWidth: tokens.border.hairline, borderTopColor: c.hairline },
        pressed && { backgroundColor: c.glass },
      ]}
    >
      <ArcRing spent={fractionUsed(mandate)} ended={ended} label="" size={tokens.size.ring.row} />

      <View style={styles.who}>
        {name !== null ? (
          <Text style={[styles.name, { color: c.paper }]} numberOfLines={1}>{name}</Text>
        ) : (
          <Text style={[styles.address, { color: c.paper }]} numberOfLines={1}>
            {shortAddress(mandate.agent)}
          </Text>
        )}
        <Text style={[styles.ends, { color: ended ? c.warn : c.dim }]} numberOfLines={1}>
          {endsLine(mandate)}
        </Text>
      </View>

      <View style={styles.figure}>
        <Text style={[styles.amount, { color: ended ? c.dim : c.paper }]}>
          {mandate.remaining.format(2)}
        </Text>
        <Text style={[styles.unit, { color: c.dim }]}>USDC left</Text>
      </View>

      <Ionicons name="chevron-forward" size={tokens.size.chevron} color={c.dim} />
    </Pressable>
  );
}

/** Compared by value: the list is rebuilt from fresh chain reads every ten seconds. */
export const AgentRow = memo(AgentRowView, (a, b) =>
  a.name === b.name &&
  a.first === b.first &&
  a.onPress === b.onPress &&
  a.mandate.agent === b.mandate.agent &&
  a.mandate.limit.toNativeUnits() === b.mandate.limit.toNativeUnits() &&
  a.mandate.spent.toNativeUnits() === b.mandate.spent.toNativeUnits() &&
  a.mandate.expiresAt === b.mandate.expiresAt,
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
  who: { flex: 1, gap: 2 },
  name: tokens.type.headline,
  address: { ...tokens.type.data, fontWeight: "600" },
  ends: tokens.type.footnote,
  figure: { alignItems: "flex-end" },
  amount: { ...tokens.type.headline, fontVariant: [...tokens.font.tabular] },
  unit: tokens.type.caption,
});
