import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Mandate } from "../arc/mandate.ts";
import { expiryLabel, fractionUsed, shortAddress } from "./mandate-format.ts";
import { useTheme } from "./theme-context.tsx";
import { Button } from "./Button.tsx";
import { tokens } from "./tokens.ts";

/** Segments in the meter. Twenty reads as a bar and still resolves single steps at 5%. */
const SEGMENTS = 20;

/**
 * One allowance.
 *
 * What is **left** leads, because that is the figure someone checks before deciding whether to
 * step in. The meter is drawn in block characters rather than as a filled view: it is honest about
 * being a readout, it aligns with the monospace around it, and it stays legible at a glance from
 * across a desk.
 */
function MandateCardView({
  mandate, onRevoke, busy,
}: {
  readonly mandate: Mandate;
  readonly onRevoke: (agent: `0x${string}`) => void;
  readonly busy: boolean;
}) {
  const c = useTheme().color;
  const filled = Math.round(fractionUsed(mandate) * SEGMENTS);

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={[styles.meta, { color: c.muted }]}>{shortAddress(mandate.agent)}</Text>
        <Text style={[styles.meta, { color: c.muted }]}>{expiryLabel(mandate)}</Text>
      </View>

      <Text style={[styles.amount, { color: c.paper }]}>
        {mandate.remaining.format(2)}
        <Text style={[styles.of, { color: c.dim }]}>  of {mandate.limit.format(2)}</Text>
      </Text>

      {/* Two runs of blocks rather than twenty views: one string, one layout pass, and it cannot
          drift out of alignment with the figures above it. */}
      <Text style={styles.meter} accessibilityLabel={`${mandate.spent.format(2)} of ${mandate.limit.format(2)} spent`}>
        <Text style={{ color: c.signal }}>{"█".repeat(filled)}</Text>
        <Text style={{ color: c.track }}>{"█".repeat(SEGMENTS - filled)}</Text>
      </Text>

      <Button title="Revoke" onPress={() => onRevoke(mandate.agent)} busy={busy} />
    </View>
  );
}

/**
 * Compared by value, not by reference.
 *
 * The screen re-reads the chain every ten seconds and builds fresh `Mandate` objects each time, so
 * a default memo would never match and every card would re-render on every poll — for figures that
 * mostly have not changed. These four are everything the card draws.
 */
export const MandateCard = memo(MandateCardView, (a, b) =>
  a.busy === b.busy &&
  a.onRevoke === b.onRevoke &&
  a.mandate.agent === b.mandate.agent &&
  a.mandate.limit.toNativeUnits() === b.mandate.limit.toNativeUnits() &&
  a.mandate.spent.toNativeUnits() === b.mandate.spent.toNativeUnits() &&
  a.mandate.expiresAt === b.mandate.expiresAt,
);

const styles = StyleSheet.create({
  card: { gap: tokens.space.xs },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  meta: {
    fontFamily: tokens.font.mono,
    fontSize: tokens.font.small,
    letterSpacing: tokens.font.labelTracking,
  },
  amount: {
    fontFamily: tokens.font.mono,
    fontSize: tokens.font.title,
    fontWeight: "700",
    letterSpacing: tokens.font.titleTracking,
    fontVariant: [...tokens.font.tabular],
  },
  of: { fontSize: tokens.font.small, fontWeight: "400", letterSpacing: 0 },
  meter: {
    fontFamily: tokens.font.mono,
    fontSize: tokens.font.body,
    letterSpacing: tokens.font.displayTracking,
    marginTop: tokens.space.xs,
  },
});
