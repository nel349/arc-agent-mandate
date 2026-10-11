import { useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { NetworkProfile } from "@kuiralabs/mandate-core";
import type { Mandate } from "../arc/mandate.ts";
import { ArcRing } from "./ArcRing.tsx";
import { Beat, HALO_REACH } from "./Beat.tsx";
import { figure, unitOf } from "./coin.ts";
import { figureSizeFor } from "./counting.ts";
import { allowanceSentence, fractionUsed, hasEnded, spentLine } from "./mandate-format.ts";
import { PulseLine } from "./PulseLine.tsx";
import { Surface } from "./Surface.tsx";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";
import { useCountedAmount } from "./useCountedAmount.ts";
import { useEased } from "./useEased.ts";
import { usePulse } from "./usePulse.ts";
import { useReducedMotion } from "./useReducedMotion.ts";
import { useRises } from "./useRises.ts";

const DOT = 8;
const RING = tokens.size.ring.hero;
/** The width inside the ring's stroke, less a little air each side, which is what a figure has to fit. */
const ROOM = RING * (1 - 2 * tokens.size.ring.strokeRatio) - tokens.space.md;
/** The smallest a figure is set before it is left to be cut short instead. */
const SMALLEST_FIGURE = 16;

/**
 * How one agent is, on its own screen: what is left, and whether it is spending.
 *
 * The ring and the line under it are the two things somebody keeps this screen open to watch, so
 * they are the largest things on it, drawn as the welcome screen's example draws them: what is left
 * inside the ring, the line beneath. A payment moves the ring, sends a halo out of it and counts
 * the figures down; the line runs while the agent is paying, is still while it rests, and is flat
 * once the allowance can do no more. The words beside the dot say the same, for a glance and for
 * anyone the line does not reach.
 *
 * It was a small ring beside a line of figures, which changed without a sign every ten seconds.
 */
export function AgentGauge({ mandate, network, lastSpent }: {
  readonly mandate: Mandate;
  readonly network: NetworkProfile;
  /** When money last moved for this agent, in seconds, or `null` when none has been seen. */
  readonly lastSpent: number | null;
}) {
  const c = useTheme().color;
  const reduced = useReducedMotion();
  const ended = hasEnded(mandate);

  const { pulse, words } = usePulse(mandate, lastSpent, network.chainId);
  const ink = pulse === "spending" ? c.untested : pulse === "stopped" ? c.stop : c.dim;

  const spent = useEased(fractionUsed(mandate), reduced);
  const payments = useRises(mandate.spent.toNativeUnits());
  const remaining = useCountedAmount(mandate.remaining);
  const spentCounted = useCountedAmount(mandate.spent);
  // On the way, what is spent is the limit less what is left, so the two figures always add up to
  // the limit. Counted apart they were each a hair behind, and read 23.95 and 26.04 of 50.00. Where
  // there is no such sum each counts its own figure: an allowance spent past a limit lowered since,
  // and the moment after a limit changes, when what is left is still counting down from the old one.
  const sums = mandate.spent.compare(mandate.limit) <= 0 && remaining.compare(mandate.limit) <= 0;
  const counted = { ...mandate, remaining, spent: sums ? mandate.limit.subtract(remaining) : spentCounted };

  const left = figure(remaining, network);
  const settled = figure(mandate.remaining, network);
  // Sized for the longest it is on the way, the figure it left included, so it does not change
  // size part-way: 10.00 going to 9.98 is five characters until the moment it is four.
  const longest = useRef(settled.length);
  longest.current = left === settled ? settled.length : Math.max(longest.current, left.length, settled.length);
  const figureSize = figureSizeFor(longest.current, ROOM, tokens.type.figure.fontSize, SMALLEST_FIGURE);
  // Said once and as it is, not as five separate things with two of them part-way through counting.
  const spoken = `${words}. ${settled} ${unitOf(network)} left, ${spentLine(mandate, network)}.${ended ? ` ${allowanceSentence(mandate, network)}` : ""}`;

  return (
    <Surface style={styles.card}>
      <View style={styles.words} accessible accessibilityLabel={spoken}>
        <View style={[styles.dot, { backgroundColor: ink }]} />
        <Text style={[styles.state, { color: ink }]}>{words}</Text>
      </View>

      <View style={styles.ring}>
        <Beat count={payments} size={RING} color={c.untested} />
        <ArcRing spent={spent} ended={ended} size={RING} label="" />
        <View style={styles.inRing} pointerEvents="none" aria-hidden>
          <Text
            style={[styles.figure, { color: ended ? c.dim : c.paper, fontSize: figureSize, lineHeight: Math.round(figureSize * FIGURE_LEADING) }]}
            numberOfLines={1}
          >
            {left}
          </Text>
          <Text style={[styles.unit, { color: c.dim }]}>{`${unitOf(network)} left`}</Text>
        </View>
      </View>

      <View aria-hidden>
        <Text style={[styles.spent, { color: c.muted }]}>{spentLine(counted, network)}</Text>
        {ended && <Text style={[styles.sentence, { color: c.stop }]}>{allowanceSentence(mandate, network)}</Text>}
      </View>

      <PulseLine pulse={pulse} label="" />
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: { gap: tokens.space.sm },
  words: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs },
  dot: { width: DOT, height: DOT, borderRadius: tokens.radius.pill },
  state: { ...tokens.type.caption, fontWeight: "600" },
  // Clear of the words above and below by as far as a halo travels, so one never runs through them.
  ring: { alignSelf: "center", alignItems: "center", justifyContent: "center", marginVertical: HALO_REACH },
  inRing: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  figure: { ...tokens.type.figure, fontVariant: [...tokens.font.tabular] },
  unit: tokens.type.footnote,
  spent: { ...tokens.type.footnote, textAlign: "center", fontVariant: [...tokens.font.tabular] },
  sentence: { ...tokens.type.footnote, textAlign: "center" },
});

/** The figure's line height as a share of its size, the figure role's own. */
const FIGURE_LEADING = tokens.type.figure.lineHeight / tokens.type.figure.fontSize;
