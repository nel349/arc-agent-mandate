import Svg, { Circle, G } from "react-native-svg";
import { useTheme } from "./theme-context.tsx";
import { ringGeometry, roundedArc } from "./ring-geometry.ts";
import { tokens } from "./tokens.ts";

/**
 * The mark: a ring, drawn part-way round.
 *
 * The full circle is a limit, part of it is gone and the rest is left, which is the whole product in
 * one shape. Unusually for a mark, **both extremes mean something**: an untouched allowance and an
 * exhausted one are the two states somebody opens the app to tell apart, and they are opposite
 * pictures rather than two similar ones.
 *
 * **What is left is the arc that is drawn**, over a ring of what is gone, and each theme says which
 * of the two carries the news near the end (`Palette.ring`). In Pulse the living part is mint over a
 * dark track and turns to sun when little is left. An untouched allowance is a whole ring of what
 * the agent may still do, and one with nothing left is the track alone. An allowance whose window
 * has closed is drawn without colour, because nothing on it can be spent any more.
 *
 * The same shape the web draws on every page of the maze. Neither can import the other — separate
 * repositories — so what they share is the rule in `ring-geometry.ts` and the note in `BRAND.md`.
 *
 * Presentational on purpose: it takes a number and draws it. No state, no effects, nothing fetched.
 * The arithmetic it needs lives next door where a test can reach it, because nothing in this
 * directory with JSX in it is reachable by the unit suite.
 */
export function ArcRing({
  spent, size = tokens.size.ring.card, label, ended = false,
}: {
  /** Nought to one. Values outside that, and non-finite ones, are clamped rather than trusted. */
  readonly spent: number;
  readonly size?: number;
  /**
   * What the ring is saying, for anyone who cannot see it. Empty when the ring sits inside
   * something that already says it, such as a row with its own sentence, so it is not read twice.
   */
  readonly label: string;
  /** The window has closed: drawn without colour, since none of it can be spent. */
  readonly ended?: boolean;
}) {
  const c = useTheme().color;

  // Drawn in a fixed hundred-unit box and scaled by `size`, so one set of numbers describes the
  // mark at any size and the stroke keeps its proportion.
  const BOX = 100;
  const stroke = BOX * tokens.size.ring.strokeRatio;
  const radius = (BOX - stroke) / 2;
  const ring = ringGeometry(spent, radius);
  const arc = roundedArc(ring, stroke);
  const leftColour = ended ? c.ring.leftEnded : ring.warning ? c.ring.leftLow : c.ring.left;
  const goneColour = ended ? c.ring.goneEnded : ring.warning ? c.ring.goneLow : c.ring.gone;

  return (
    <Svg
      width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`}
      accessible={label.length > 0}
      {...(label.length > 0 ? { accessibilityLabel: label } : {})}
    >
      {/* Whole in the colour of what is left when nothing is spent: there is no gone part to show. */}
      <Circle
        cx={BOX / 2} cy={BOX / 2} r={radius}
        fill="none" stroke={ring.empty ? leftColour : goneColour} strokeWidth={stroke}
      />
      {/*
        Rotated so the gone part starts at twelve o'clock and what is left begins where it ends. An
        SVG arc otherwise begins at three, which reads as a gauge already part-way along.

        Omitted when the ring is whole, which the circle above already is, and when nothing is left:
        a zero-length dash with a round end draws as a bead, so an exhausted allowance would show a
        dot of life where it should show none.
      */}
      {ring.empty || ring.spentOut ? null : (
        <G rotation={arc.from - 90} originX={BOX / 2} originY={BOX / 2}>
          <Circle
            cx={BOX / 2} cy={BOX / 2} r={radius}
            fill="none"
            stroke={leftColour}
            strokeWidth={stroke}
            strokeLinecap="round"
            // Shortened by its own round ends, so they are inside what is left and not added to it.
            strokeDasharray={[arc.dash, ring.circumference]}
          />
        </G>
      )}
    </Svg>
  );
}
