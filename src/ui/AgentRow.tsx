import Ionicons from "@expo/vector-icons/Ionicons";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { NetworkProfile } from "@kuiralabs/mandate-core";
import type { Mandate } from "../arc/mandate.ts";
import { figure, unitOf } from "./coin.ts";
import { ArcRing } from "./ArcRing.tsx";
import { Beat } from "./Beat.tsx";
import type { Pulse } from "./pulse.ts";
import { useCountedAmount } from "./useCountedAmount.ts";
import { useEased } from "./useEased.ts";
import { useReducedMotion } from "./useReducedMotion.ts";
import { useRises } from "./useRises.ts";
import { identityLabel } from "./activity-format.ts";
import { shortFingerprint } from "./fingerprint.ts";
import { agentRowLabel, endsLine, fractionUsed, hasEnded } from "./mandate-format.ts";
import { accentOf } from "./network-look.ts";
import { DIMS_ON_PRESS, ripple } from "./press.ts";
import { RING_WARNS_AT } from "./ring-geometry.ts";
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
  mandate, network, name, identity = null, onPress, first, pulse = "resting",
}: {
  /** How the agent is. A spending one says so before when its allowance ends. */
  readonly pulse?: Pulse;
  readonly mandate: Mandate;
  /** the network the allowance is on, which names its coin */
  readonly network: NetworkProfile;
  readonly name: string | null;
  /**
   * The agent's ERC-8004 identity, or null while there is none confirmed.
   *
   * Shown here because its absence was read as its absence: the identity is set up silently by the
   * connector, so the only place it appeared was a screen you had to tap into, and not seeing it on
   * the list looked like it had never happened. The number itself is what a seller is given, and
   * that belongs on the agent's own screen; what the list owes is the confirmation.
   */
  readonly identity?: bigint | null;
  readonly onPress: (agent: `0x${string}`) => void;
  /** The first row in a group has no rule above it. */
  readonly first: boolean;
}) {
  const c = useTheme().color;
  const ended = hasEnded(mandate);
  // The figure warns at the ring's own threshold, so the number is never calm beside a ring that is not.
  const low = !ended && fractionUsed(mandate) >= RING_WARNS_AT;
  // A payment: the ring moves to its new place, a halo leaves it, and the figure counts down.
  const reduced = useReducedMotion();
  const spent = useEased(fractionUsed(mandate), reduced);
  const payments = useRises(mandate.spent.toNativeUnits());
  const remaining = useCountedAmount(mandate.remaining);
  const spending = pulse === "spending";

  return (
    <Pressable
      onPress={() => onPress(mandate.agent)}
      accessibilityRole="button"
      accessibilityLabel={`${agentRowLabel(mandate, name, network)}${spending ? ` ${SPENDING}.` : ""}`}
      accessibilityHint="Opens this allowance"
      android_ripple={ripple(c.specular)}
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopWidth: tokens.border.hairline, borderTopColor: c.hairline },
        DIMS_ON_PRESS && pressed && { backgroundColor: c.glass },
      ]}
    >
      <View style={styles.ring}>
        <Beat count={payments} size={tokens.size.ring.row} color={c.untested} />
        <ArcRing spent={spent} ended={ended} label="" size={tokens.size.ring.row} />
      </View>

      <View style={styles.who}>
        {name !== null ? (
          <Text style={[styles.name, { color: c.paper }]} numberOfLines={1}>{name}</Text>
        ) : (
          <Text style={[styles.address, { color: c.paper }]} numberOfLines={1}>
            {shortFingerprint(mandate.agent)}
          </Text>
        )}
        {spending ? (
          <View style={styles.spending}>
            <View style={[styles.dot, { backgroundColor: c.untested }]} />
            <Text style={[styles.ends, styles.news, { color: c.untested }]} numberOfLines={1}>{SPENDING}</Text>
            {/* When it ends is still said, after the news and cut short if there is no room for both. */}
            <Text style={[styles.ends, styles.after, { color: c.dim }]} numberOfLines={1}>{`· ${endsLine(mandate)}`}</Text>
          </View>
        ) : (
          <Text style={[styles.ends, { color: ended ? c.stop : c.dim }]} numberOfLines={1}>
            {endsLine(mandate)}
          </Text>
        )}
        {/*
          Its own line, and named in full.

          Squeezed onto the line above as a bare "#894344" it was the very thing this was meant to
          fix: a number with nothing saying what it is. It also carries its own colour rather than
          the warn an ended allowance takes, because the identity is not what ended.
        */}
        {identity !== null && (
          <Text style={[styles.identity, { color: c.dim }]} numberOfLines={1}>
            {identityLabel(identity)}
          </Text>
        )}
      </View>

      <View style={styles.figure}>
        <Text style={[styles.amount, { color: ended ? c.dim : low ? c.signal : c.paper }]}>
          {figure(remaining, network)}
        </Text>
        {/* The network's one colour, as a dot beside the coin it is counted in. */}
        <View style={styles.unitRow}>
          <View style={[styles.dot, { backgroundColor: accentOf(network) }]} />
          <Text style={[styles.unit, { color: c.dim }]}>{unitOf(network)} left</Text>
        </View>
      </View>

      <Ionicons name="chevron-forward" size={tokens.size.chevron} color={c.dim} />
    </Pressable>
  );
}

/** Compared by value: the list is rebuilt from fresh chain reads every ten seconds. */
export const AgentRow = memo(AgentRowView, (a, b) =>
  a.name === b.name &&
  a.network.chainId === b.network.chainId &&
  a.identity === b.identity &&
  a.first === b.first &&
  a.pulse === b.pulse &&
  a.onPress === b.onPress &&
  a.mandate.agent === b.mandate.agent &&
  a.mandate.limit.toNativeUnits() === b.mandate.limit.toNativeUnits() &&
  a.mandate.spent.toNativeUnits() === b.mandate.spent.toNativeUnits() &&
  a.mandate.expiresAt === b.mandate.expiresAt,
);

/** The network's dot beside the coin, and the dot beside "Spending now". */
const DOT = 6;
const SPENDING = "Spending now";

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.md,
    paddingHorizontal: tokens.space.base,
    minHeight: tokens.size.tapTarget,
  },
  ring: { alignItems: "center", justifyContent: "center" },
  spending: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs },
  // The news keeps its width and is never broken; what follows it gives way.
  news: { flexShrink: 0 },
  after: { flexShrink: 1 },
  who: { flex: 1, gap: tokens.space.hair },
  name: tokens.type.headline,
  address: tokens.type.data,
  ends: tokens.type.footnote,
  identity: tokens.type.caption,
  figure: { alignItems: "flex-end" },
  amount: { ...tokens.type.headline, fontVariant: [...tokens.font.tabular] },
  unitRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs },
  dot: { width: DOT, height: DOT, borderRadius: tokens.radius.pill },
  unit: tokens.type.caption,
});
