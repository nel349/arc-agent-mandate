import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Mandate } from "../arc/mandate.ts";
import { expiryLabel, fractionUsed, shortAddress } from "./mandate-format.ts";
import { tokens } from "./tokens.ts";

/**
 * One allowance, as a person reads it.
 *
 * The number that matters is what is **left**, not what was granted — that is the figure someone
 * checks before deciding whether to intervene. Everything else is context.
 */
export const MandateCard = memo(function MandateCard({
  mandate, onRevoke, busy,
}: {
  readonly mandate: Mandate;
  readonly onRevoke: (agent: `0x${string}`) => void;
  readonly busy: boolean;
}) {
  const used = fractionUsed(mandate);
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.agent}>{shortAddress(mandate.agent)}</Text>
        <Text style={styles.expiry}>{expiryLabel(mandate)}</Text>
      </View>

      <Text style={styles.remaining}>{mandate.remaining.format(2)} left</Text>
      <Text style={styles.of}>of {mandate.limit.format(2)} granted</Text>

      <View style={styles.track}>
        {/* Width is the one value that cannot come from the stylesheet, because it is data. */}
        <View style={[styles.fill, { width: `${Math.round(used * 100)}%` }]} />
      </View>

      <Pressable
        style={busy ? styles.revokeOff : styles.revoke}
        onPress={() => onRevoke(mandate.agent)}
        disabled={busy}
      >
        <Text style={styles.revokeText}>Revoke</Text>
      </Pressable>
    </View>
  );
});

const revoke = {
  borderColor: tokens.color.danger,
  borderWidth: tokens.border.hairline,
  borderRadius: tokens.radius.pill,
  paddingVertical: tokens.space.xs,
  alignItems: "center",
  marginTop: tokens.space.xs,
} as const;

const styles = StyleSheet.create({
  card: {
    backgroundColor: tokens.color.glass,
    borderWidth: tokens.border.hairline,
    borderColor: tokens.color.glassBorder,
    borderRadius: tokens.radius.lg,
    padding: tokens.space.base,
    gap: tokens.space.xs,
  },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  agent: { color: tokens.color.textMuted, fontFamily: tokens.font.mono, fontSize: tokens.font.small },
  expiry: { color: tokens.color.textMuted, fontSize: tokens.font.small },
  remaining: { color: tokens.color.text, fontSize: tokens.font.display, fontWeight: "600" },
  of: { color: tokens.color.textMuted, fontSize: tokens.font.small },
  track: {
    height: tokens.space.xs,
    backgroundColor: tokens.color.glass,
    borderRadius: tokens.radius.md,
    overflow: "hidden",
    marginTop: tokens.space.xs,
  },
  fill: { height: "100%", backgroundColor: tokens.color.accentBright },
  revoke,
  revokeOff: { ...revoke, opacity: tokens.opacity.disabled },
  revokeText: { color: tokens.color.danger, fontWeight: "600", fontSize: tokens.font.body },
});
