import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Mandate } from "../arc/mandate.ts";
import { agentHoldingNote, expiryLine, fractionUsed, lastUsedLabel, shortAddress, spentLine } from "./mandate-format.ts";
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
  // The chain only records a last-used time for mandates with a refresh interval, and "never used"
  // would repeat the "nothing spent" already on the line above.
  const lastUsed = mandate.lastUsedAt === null ? "" : lastUsedLabel(mandate);

  return (
    <Surface>
      {/* Each value under a word saying what it is. A hex string on its own is not recognisable as
          an agent, and a countdown on its own does not say what is counting down. */}
      <View style={styles.row}>
        <View>
          <Text style={[styles.cap, { color: c.dim }]}>Agent</Text>
          <Text style={[styles.address, { color: c.muted }]}>{shortAddress(mandate.agent)}</Text>
        </View>
        <View style={styles.end}>
          <Text style={[styles.cap, { color: c.dim }]}>Expires</Text>
          <Text style={[styles.meta, { color: c.muted }]}>{expiryLine(mandate)}</Text>
        </View>
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
            <Text style={[styles.of, { color: c.dim }]}>  USDC left</Text>
          </Text>
          <Text style={[styles.percent, { color: c.muted }]}>{spentLine(mandate)}</Text>
        </View>
      </View>

      {/*
        Only when there is something the lines above have not already said: a real "last used"
        time, or an agent holding money it should not. The spend itself is on the line above now,
        and repeating it here was the second of two places saying the same figure.
      */}
      {lastUsed !== "" || holding !== null ? (
        <View style={styles.row}>
          <Text style={[styles.meta, { color: c.dim }]}>{lastUsed}</Text>
          {holding !== null ? <Text style={[styles.meta, { color: c.warn }]}>{holding}</Text> : null}
        </View>
      ) : null}

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
  end: { alignItems: "flex-end" },
  /** The word over a value. */
  cap: tokens.type.caption,
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  meta: tokens.type.footnote,
  address: tokens.type.data,
  amount: { ...tokens.type.title, fontVariant: [...tokens.font.tabular] },
  of: { ...tokens.type.subheadline, fontWeight: "400", letterSpacing: 0 },
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
    ...tokens.type.footnote,
    // Digits change as the allowance is used; tabular figures keep the row from twitching.
    fontVariant: [...tokens.font.tabular],
  },
});
