/**
 * Two palettes, one shape.
 *
 * Both were designed against the same screen, so switching is a colour change and nothing else —
 * no layout moves, no component learns which theme it is in. Named the way Kuira names its own
 * (`Appearance · Void`), because a person picks a *look*, not a hex value.
 *
 * Structural values — spacing, radii, type scale — are **not** part of a theme. A theme that can
 * change spacing is a second layout in disguise, and the second one is always the one nobody
 * tested.
 */

export interface Palette {
  /** Three neutral stops, high to low, that light the ground. Value only, never hue-shifted away
   *  from the theme's own temperature — the glass has to pick up light, not colour. */
  readonly groundHigh: string;
  readonly groundMid: string;
  readonly groundLow: string;
  /**
   * Text, brightest first.
   *
   * Both `muted` and `dim` are chosen against the **lightest** ground stop, which is where light
   * text has least contrast — measuring against the average would pass on paper and fail at the
   * top of the screen. `muted` clears 7:1 and `dim` clears 5:1 there, so both are above the 4.5:1
   * that small text needs everywhere on the gradient, not just at the bottom of it.
   */
  readonly paper: string;
  readonly muted: string;
  readonly dim: string;
  /** Glass fill, its lit top edge, and the hairline that closes the shape. */
  readonly glass: string;
  readonly specular: string;
  readonly hairline: string;
  /** Means *live*, and nothing else — the pulse and the filled part of a meter. */
  readonly signal: string;
  /** The unfilled part of a meter: present, but clearly not spent. */
  readonly track: string;
  /** A refusal. Shared across themes on purpose: it is the one event that should never blend in. */
  readonly warn: string;
  /** Fill and text for the single primary action on a screen. */
  readonly actionFill: string;
  readonly actionText: string;
  /** iOS blur tint. `expo-blur` needs to know which way to lean. */
  readonly blurTint: "dark" | "light";
}

export interface Theme {
  readonly id: ThemeId;
  /** What the settings row shows. */
  readonly name: string;
  /** One line under it, so a person can choose without switching back and forth. */
  readonly note: string;
  readonly color: Palette;
}

export type ThemeId = "machine" | "arc";

/** Warm charcoal, acid lime. Reads as equipment rather than software. */
const machine: Theme = {
  id: "machine",
  name: "Machine",
  note: "Warm charcoal, lime status",
  color: {
    groundHigh: "#24242A",
    groundMid: "#141417",
    groundLow: "#0A0A0C",
    paper: "#E9E6DF",
    muted: "#B6AFA2",
    dim: "#999389",
    glass: "rgba(236, 232, 224, 0.045)",
    specular: "rgba(255, 252, 244, 0.30)",
    hairline: "rgba(236, 232, 224, 0.10)",
    signal: "#C7F04A",
    track: "#2A2A2E",
    warn: "#E8B44A",
    actionFill: "#E9E6DF",
    actionText: "#111013",
    blurTint: "dark",
  },
};

/** Arc's own navy and blue. Belongs to the ecosystem at a glance. */
const arc: Theme = {
  id: "arc",
  name: "Arc",
  note: "Deep navy, Arc blue status",
  color: {
    groundHigh: "#1D3350",
    groundMid: "#0F1E33",
    groundLow: "#060C16",
    paper: "#E6EEF9",
    muted: "#A8C3E7",
    dim: "#8DA4C2",
    glass: "rgba(198, 222, 255, 0.055)",
    specular: "rgba(232, 244, 255, 0.30)",
    hairline: "rgba(198, 222, 255, 0.12)",
    signal: "#5FBFFF",
    track: "#1E3049",
    warn: "#E8B44A",
    actionFill: "#5FBFFF",
    actionText: "#071019",
    blurTint: "dark",
  },
};

export const THEMES: readonly Theme[] = [machine, arc];
export const DEFAULT_THEME_ID: ThemeId = "machine";

export function themeById(id: string | null): Theme {
  return THEMES.find((t) => t.id === id) ?? machine;
}
