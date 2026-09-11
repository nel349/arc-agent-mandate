import Svg, { Circle, G } from "react-native-svg";
import { useTheme } from "./theme-context.tsx";
import { ringGeometry } from "./ring-geometry.ts";
import { tokens } from "./tokens.ts";

/**
 * The mark: a ring, drawn part-way round.
 *
 * The full circle is a limit and the drawn part is what is gone, which is the whole product in one
 * shape. Unusually for a mark, **both extremes mean something**: an untouched allowance and an
 * exhausted one are the two states somebody opens the app to tell apart, and they are opposite
 * pictures rather than two similar ones.
 *
 * **Two colours, established and untested.** The part still allowed is drawn in `untested`, the
 * part spent in ink, and the spent arc turns `signal` near the end. An untouched allowance used to
 * be a dark hoop that read as a placeholder still loading; now it is a whole ring of what the agent
 * may still do. An allowance whose window has closed is drawn in the track colour throughout,
 * because nothing on it can be spent any more.
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
  const arcColour = ended ? c.dim : ring.warning ? c.signal : c.paper;

  return (
    <Svg
      width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`}
      accessible={label.length > 0}
      {...(label.length > 0 ? { accessibilityLabel: label } : {})}
    >
      <Circle
        cx={BOX / 2} cy={BOX / 2} r={radius}
        fill="none" stroke={ended ? c.track : c.untested} strokeWidth={stroke}
      />
      {/*
        Rotated so the arc starts at twelve o'clock. An SVG arc otherwise begins at three, which
        reads as a gauge that is already part-way along before anything has been spent.

        Omitted entirely when nothing is spent rather than drawn with a zero length: a zero-length
        dash with a round cap renders as a bead at the top, so an untouched allowance would show a
        mark where it should show none.
      */}
      {ring.empty ? null : (
        <G rotation={-90} originX={BOX / 2} originY={BOX / 2}>
          <Circle
            cx={BOX / 2} cy={BOX / 2} r={radius}
            fill="none"
            stroke={arcColour}
            strokeWidth={stroke}
            strokeLinecap={ring.fraction >= 1 ? "butt" : "round"}
            strokeDasharray={[ring.drawn, ring.circumference]}
          />
        </G>
      )}
    </Svg>
  );
}
