import { memo, useEffect, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { ArcRing } from "./ArcRing.tsx";
import { Beat } from "./Beat.tsx";
import { ARRIVE_MS, DEMO_STEP_MS, LIT_MS } from "./motion.ts";
import { PulseLine } from "./PulseLine.tsx";
import { Surface } from "./Surface.tsx";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";
import { useEased } from "./useEased.ts";
import { useReducedMotion } from "./useReducedMotion.ts";
import {
  DEMO_LIMIT, DEMO_PULSE, DEMO_STILL_STEP, REFUSED_BECAUSE, demoFigure, demoFrame, exampleLayout, nextDemoStep,
  type DemoFrame, type DemoRow, type DemoState,
} from "./welcome-demo.ts";

const STATUS: Readonly<Record<DemoState, string>> = {
  granted: "Granted",
  spending: "Spending now",
  refused: "Payment refused",
};

/**
 * The product, playing: an agent on an allowance spends it down, and the payment that does not fit
 * is refused.
 *
 * The welcome screen used to describe this in a paragraph under a ring that did not move. Somebody
 * deciding whether to make a wallet learns more from watching it happen: the ring is what is left,
 * each payment is a beat, and the chain says no to the one that is more than is left.
 *
 * It is an example and says so in a tag on its face. Nothing here is read from a chain.
 *
 * **A refusal is a moment, not the allowance stopping.** What is left is still there and still the
 * agent's to spend, so the ring keeps its colour and the line goes still; the refusal is the line
 * that arrives, the word beside the dot, and one halo in the stop colour. It was drawn with the
 * whole ring in that colour and the line flat, which said the allowance was dead.
 *
 * For someone who has asked for less motion it rests on one frame, an agent part-way through its
 * allowance, which shows the same idea without anything changing under them.
 */
export function WelcomeExample({ unit }: { readonly unit: string }) {
  const c = useTheme().color;
  const reduced = useReducedMotion();
  const layout = exampleLayout(useWindowDimensions().height, tokens.size.shortWindow, tokens.size.tinyWindow);
  const [step, setStep] = useState(DEMO_STILL_STEP);

  useEffect(() => {
    if (reduced) { setStep(DEMO_STILL_STEP); return; }
    // From the beginning: started part-way, a newcomer's first sight of it was the refusal.
    setStep(0);
    const timer = setInterval(() => setStep(nextDemoStep), DEMO_STEP_MS);
    return () => clearInterval(timer);
  }, [reduced]);

  const frame = demoFrame(step, layout.rows);
  const refused = frame.state === "refused";
  const statusColour = refused ? c.stop : c.untested;
  const limit = `${demoFigure(DEMO_LIMIT)} ${unit}`;

  return (
    <Surface style={styles.card}>
      <View style={styles.head}>
        <View style={styles.what}>
          <View style={[styles.tag, { borderColor: c.muted }]}>
            <Text style={[styles.tagText, { color: c.paper }]}>Example</Text>
          </View>
          <Text style={[styles.caption, { color: c.muted }]} numberOfLines={1}>{`${limit} limit`}</Text>
        </View>
        <View style={styles.status}>
          <View style={[styles.dot, { backgroundColor: statusColour }]} />
          <Text style={[styles.caption, { color: statusColour }]}>{STATUS[frame.state]}</Text>
        </View>
      </View>

      <Gauge frame={frame} unit={unit} limit={limit} size={layout.short ? tokens.size.ring.welcomeShort : tokens.size.ring.welcome} still={reduced} />

      <PulseLine pulse={DEMO_PULSE[frame.state]} label="" />

      {layout.rows > 0 && (
        <View style={[styles.rows, { height: ROW_HEIGHT * layout.rows + tokens.space.xs * (layout.rows - 1) }]}>
          {frame.rows.length === 0 ? (
            <Text style={[styles.waiting, { color: c.dim }]}>Allowance granted. Waiting for the first payment.</Text>
          ) : (
            frame.rows.map((row) => <Payment key={row.key} row={row} still={reduced} />)
          )}
        </View>
      )}
    </Surface>
  );
}

/**
 * The ring, the figure inside it and the halos that leave it.
 *
 * Its own component because the figure and the ring are redrawn on every frame while they travel,
 * and that should redraw this and nothing else on the card.
 */
const Gauge = memo(function Gauge({ frame, unit, limit, size, still }: {
  readonly frame: DemoFrame;
  readonly unit: string;
  readonly limit: string;
  readonly size: number;
  readonly still: boolean;
}) {
  const c = useTheme().color;
  const left = useEased(frame.left, still);
  const spent = useEased(frame.spentFraction, still);

  return (
    <View
      style={styles.ring}
      accessible
      accessibilityLabel={`An example. ${demoFigure(frame.left)} ${unit} left of ${limit}. ${STATUS[frame.state]}.`}
    >
      <Beat count={frame.beat} size={size} color={c.untested} />
      <Beat count={frame.refusals} size={size} color={c.stop} />
      <ArcRing spent={spent} size={size} label="" />
      <View style={styles.inRing} pointerEvents="none">
        <Text style={[styles.figure, { color: c.paper }]}>{demoFigure(Math.round(left))}</Text>
        <Text style={[styles.unit, { color: c.dim }]}>{`${unit} left`}</Text>
      </View>
    </View>
  );
}, (a, b) =>
  a.frame.left === b.frame.left && a.frame.beat === b.frame.beat && a.frame.refusals === b.frame.refusals &&
  a.frame.state === b.frame.state && a.unit === b.unit && a.limit === b.limit && a.size === b.size && a.still === b.still,
);

/** One payment in the example: it arrives lit, and the light fades. */
const Payment = memo(function Payment({ row, still }: { readonly row: DemoRow; readonly still: boolean }) {
  const c = useTheme().color;
  // Decided when the line first appears and never again: a line that has moved down one place is
  // not arriving, and must not arrive a second time.
  const [moving] = useState(() => {
    const arrives = row.fresh && !still;
    const arrived = new Animated.Value(arrives ? 0 : 1);
    const lit = new Animated.Value(arrives ? 1 : 0);
    return {
      arrives, arrived, lit,
      rise: arrived.interpolate({ inputRange: [0, 1], outputRange: [ARRIVE_FROM, 0] }),
      light: lit.interpolate({ inputRange: [0, 1], outputRange: [0, LIT_AT] }),
    };
  });

  useEffect(() => {
    if (!moving.arrives) return;
    // The web has no native driver; asking for one there only logs a warning for every line.
    const native = Platform.OS !== "web";
    const run = Animated.parallel([
      Animated.timing(moving.arrived, { toValue: 1, duration: ARRIVE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: native }),
      Animated.timing(moving.lit, { toValue: 0, duration: LIT_MS, easing: Easing.in(Easing.quad), useNativeDriver: native }),
    ]);
    run.start();
    return () => run.stop();
  }, [moving]);

  const ink = row.refused ? c.stop : c.paper;
  return (
    <Animated.View
      style={[
        styles.row,
        { backgroundColor: c.glass, borderColor: row.refused ? c.stop : c.hairline },
        { opacity: moving.arrived, transform: [{ translateY: moving.rise }] },
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.light, { backgroundColor: row.refused ? c.stop : c.untested, opacity: moving.light }]}
      />
      <Text style={[styles.rowWhat, { color: ink }]} numberOfLines={1}>
        {row.refused ? `Refused: ${row.what}, ${REFUSED_BECAUSE}` : row.what}
      </Text>
      <Text style={[styles.amount, { color: ink }]}>{`${row.refused ? "" : "−"}${demoFigure(row.amount)}`}</Text>
    </Animated.View>
  );
});

/** How far below its place a new line starts. */
const ARRIVE_FROM = 10;
/** How strongly a new line is lit, at its brightest. */
const LIT_AT = 0.2;
const DOT = 8;
const ROW_HEIGHT = 40;

const styles = StyleSheet.create({
  card: { gap: tokens.space.sm },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: tokens.space.sm },
  what: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs, flexShrink: 1 },
  // Outlined and in the brightest ink on the card's head, because it is the one word on the card
  // that must not be missed: this is not the reader's money.
  tag: {
    borderWidth: tokens.border.hairline, borderRadius: tokens.radius.pill,
    paddingVertical: tokens.space.hair, paddingHorizontal: tokens.space.sm,
  },
  tagText: { ...tokens.type.caption, fontWeight: "700" },
  caption: { ...tokens.type.caption, fontWeight: "600", flexShrink: 1 },
  status: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs },
  dot: { width: DOT, height: DOT, borderRadius: tokens.radius.pill },
  ring: { alignSelf: "center", alignItems: "center", justifyContent: "center", marginVertical: tokens.space.sm },
  inRing: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  figure: { ...tokens.type.ringFigure, fontVariant: [...tokens.font.tabular] },
  unit: tokens.type.caption,
  // Its height is set where it is drawn: tall enough for every line it will ever hold, so the card
  // is one height from first frame to last. Lines fill from the top, so the first does not sit in
  // the middle of the space and then jump when the second arrives.
  rows: { gap: tokens.space.xs },
  waiting: { ...tokens.type.footnote, textAlign: "center", marginVertical: "auto" },
  row: {
    height: ROW_HEIGHT,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: tokens.space.sm,
    paddingHorizontal: tokens.space.base,
    borderRadius: tokens.radius.pill, borderWidth: tokens.border.hairline,
    overflow: "hidden",
  },
  light: StyleSheet.absoluteFillObject,
  rowWhat: { ...tokens.type.footnote, flexShrink: 1, fontWeight: "500" },
  amount: { ...tokens.type.footnote, fontFamily: tokens.font.display, fontWeight: "600", fontVariant: [...tokens.font.tabular] },
});
