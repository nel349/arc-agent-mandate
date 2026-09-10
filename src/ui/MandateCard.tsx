import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Mandate } from "../arc/mandate.ts";
import { agentHoldingNote, expiryLabel, fractionUsed, lastUsedLabel, shortAddress, spentPercentLabel } from "./mandate-format.ts";
import { useTheme } from "./theme-context.tsx";
import { ArcRing } from "./ArcRing.tsx";
import { Button } from "./Button.tsx";
import { Surface } from "./Surface.tsx";
import { tokens } from "./tokens.ts";

/**
 * One allowance.
 *
 * What is **left** leads, because that is the figure someone checks before deciding whether to
 * step in.
 *
 * The meter is the ring rather than the row of block characters it replaced. Both drew the same
 * number, and the blocks drew it well — but the ring is the mark this app and the maze share, and
 * a card carrying the brand's own shape beats a card carrying a readout that could belong to
 * anything. Reading it costs no more: the arc is the part that is gone, and the colour changes
 * when it is nearly all gone.
 */
function MandateCardView({
  mandate, onRevoke, busy,
}: {
  readonly mandate: Mandate;
  readonly onRevoke: (agent: `0x${string}`) => void;
  readonly busy: boolean;
}) {
  const c = useTheme().color;
  const holding = agentHoldingNote(mandate.agentFloat);

  return (
    <Surface>
      <View style={styles.row}>
        <Text style={[styles.meta, { color: c.muted }]}>{shortAddress(mandate.agent)}</Text>
        <Text style={[styles.meta, { color: c.muted }]}>{expiryLabel(mandate)}</Text>
      </View>

      {/*
        The ring and the figures read as one object: the mark states how much is *gone*, the number
        beside it states what is *left*. They count opposite ways on purpose — what remains is the
        figure somebody checks before letting an agent loose, and how much is spent is the shape
        that carries across a room — so the percentage stays, spelling out which way the arc runs.
      */}
      <View style={styles.headline}>
        <ArcRing
          spent={fractionUsed(mandate)}
          label={`${mandate.spent.format(2)} of ${mandate.limit.format(2)} spent`}
        />
        <View style={styles.figures}>
          <Text style={[styles.amount, { color: c.paper }]}>
            {mandate.remaining.format(2)}
            <Text style={[styles.of, { color: c.dim }]}>  of {mandate.limit.format(2)}</Text>
          </Text>
          <Text style={[styles.percent, { color: c.muted }]}>{spentPercentLabel(mandate)}</Text>
        </View>
      </View>

      {/*
        A bar needs saying what it measures, and this one especially: the figure above is what is
        **left**, while the bar fills with what has been **spent**, so the number counts down as
        the bar fills up. Unlabelled and at zero it reads as an empty box rather than a meter —
        which is exactly how it was read.

        The float is here for a different reason: granting sends the agent this money, and until
        it appeared on the card the only trace of the transfer was a wallet balance that had
        quietly gone down.
      */}
      <View style={styles.row}>
        <Text style={[styles.meta, { color: c.dim }]}>
          {/* What was spent, and when — the only two things the chain can say about an agent's
              activity. It cannot say whether one is running: reading leaves no trace, so an agent
              that is paired and working looks exactly like one never installed until it spends. */}
          {mandate.spent.isZero() ? "nothing spent yet" : `${mandate.spent.format(2)} spent`}
          {/* Empty when the chain cannot say when, which it cannot for a mandate with no refresh
              interval. Dropping the separator with it, so the line does not end in a dangling dot. */}
          {lastUsedLabel(mandate) === "" ? "" : ` · ${lastUsedLabel(mandate)}`}
        </Text>
        {/*
          Almost never shown, and that is the point.

          Nothing is transferred to an agent: it hands its operations to a bundler and the
          paymaster covers them, so an allowance is authority and never a pot of money. A holding
          is an anomaly — left from when grants sent a submission float, or sent by hand — and
          belongs on screen rather than being discovered as a wallet that shrank.

          `agentHoldingNote` decides when there is anything to say. Dust below the cost of
          returning it is not raised: it once rendered as "agent holds 0.00", an alarm about
          nothing, with no action available even if it had been real.
        */}
        {holding !== null && <Text style={[styles.meta, { color: c.warn }]}>{holding}</Text>}
      </View>

      {/* Right-aligned and sized to itself. Taking an allowance back is the one thing you can do
          to a card, but it is not what the screen is for, and a column of full-width Revokes
          reads as a list of demands rather than a list of allowances. */}
      <View style={styles.actions}>
        <Button title="Revoke" onPress={() => onRevoke(mandate.agent)} busy={busy} compact />
      </View>
    </Surface>
  );
}

/**
 * Compared by value, not by reference.
 *
 * The screen re-reads the chain every ten seconds and builds fresh `Mandate` objects each time, so
 * a default memo would never match and every card would re-render on every poll — for figures that
 * mostly have not changed. These are everything the card draws.
 */
export const MandateCard = memo(MandateCardView, (a, b) =>
  a.busy === b.busy &&
  a.onRevoke === b.onRevoke &&
  a.mandate.agent === b.mandate.agent &&
  a.mandate.limit.toNativeUnits() === b.mandate.limit.toNativeUnits() &&
  a.mandate.spent.toNativeUnits() === b.mandate.spent.toNativeUnits() &&
  a.mandate.expiresAt === b.mandate.expiresAt &&
  // The float drains as the agent submits, so a comparator blind to it would freeze that figure
  // at whatever it was on first render.
  a.mandate.agentFloat.toNativeUnits() === b.mandate.agentFloat.toNativeUnits() &&
  a.mandate.lastUsedAt === b.mandate.lastUsedAt,
);

const styles = StyleSheet.create({
  actions: { alignItems: "flex-end" },
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
  headline: {
    flexDirection: "row",
    // Centre, not baseline. The old row lined up two runs of *text* and so had to use baseline;
    // this one pairs a drawing with a block of text, and a circle has no baseline to sit on.
    alignItems: "center",
    gap: tokens.space.base,
    marginTop: tokens.space.xs,
  },
  /** Takes the remaining width so a long figure wraps inside the card rather than pushing the ring. */
  figures: { flex: 1 },
  percent: {
    fontFamily: tokens.font.mono,
    fontSize: tokens.font.small,
    // Digits change as the allowance is used; tabular figures keep the row from twitching.
    fontVariant: [...tokens.font.tabular],
  },
});
