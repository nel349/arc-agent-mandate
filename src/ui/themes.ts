/**
 * Four palettes, one shape.
 *
 * All were designed against the same screens, so switching is a colour change and nothing else —
 * no layout moves, no component learns which theme it is in. Named the way Kuira names its own
 * (`Appearance · Void`), because a person picks a *look*, not a hex value.
 *
 * Structural values — spacing, radii, type scale — are **not** part of a theme. A theme that can
 * change spacing is a second layout in disguise, and the second one is always the one nobody
 * tested.
 *
 * **In the three older palettes the meaning colours are the web's.** `signal`, `untested` and `good`
 * carry the values the maze draws in `arc-maze/src/web/brand.ts`, so the number that matters is the
 * same orange on the phone and on the page. Pulse has its own three, described where it is defined.
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
  /** **The number that matters**: nearly out of allowance, where the agent is. Never decoration. */
  readonly signal: string;
  /** Allowed but not yet spent. Established's opposite, on every surface that shows both. */
  readonly untested: string;
  /** It landed: a payment settled, an address that checks out. */
  readonly good: string;
  /** The unfilled part of a meter: present, but clearly not spent. */
  readonly track: string;
  /**
   * The ring's two parts, and what each turns to when little is left.
   *
   * Stated per theme because the themes disagree about which part carries the news. The older ones
   * draw what is gone in ink over a quiet ring, and turn that ink to `signal` near the end. Pulse
   * draws what is left, alive, over a dark track, and it is the living part that turns.
   */
  readonly ring: {
    readonly left: string;
    readonly leftLow: string;
    readonly gone: string;
    readonly goneLow: string;
    /** An allowance whose window has closed: both parts without colour, since none of it can be spent. */
    readonly leftEnded: string;
    readonly goneEnded: string;
  };
  /** Something needs putting right or reading: a field that will not do, a notice that blocks. */
  readonly warn: string;
  /**
   * Stopped: refused by the chain, revoked, or ended, and the action that takes something away.
   *
   * Apart from `warn` because in Pulse it is the one meaning coral has, and a mistyped address is
   * not an agent being stopped. The older palettes have one amber for both, as they always did.
   */
  readonly stop: string;
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

export type ThemeId = "pulse" | "cipher" | "machine" | "arc";

/**
 * Pulse, the Mandate's own look. An agent with somebody's money is working where they cannot see
 * it, and this is where they see that it is alive.
 *
 * **Three colours, one meaning each.** Mint is alive: what is left, an agent at work, and the one
 * button that matters. Sun asks for attention: an allowance running low, or something to put right.
 * Coral is stopped, by the chain or by the owner, and nothing else is ever coral. The ground is a deep green that is neither Arc's blue nor Monad's
 * purple, so a network is a small tag on a card and never the look of the whole app.
 *
 * `muted` and `dim` are measured against `groundHigh`, as in every theme: about 11:1 and 7.6:1.
 */
const pulse: Theme = {
  id: "pulse",
  name: "Pulse",
  note: "Deep green, mint for what is alive",
  color: {
    groundHigh: "#0C1F1C",
    groundMid: "#071412",
    groundLow: "#040C0B",
    paper: "#E6F4EF",
    muted: "#B7D0C8",
    dim: "#8FB0A6",
    glass: "rgba(120, 230, 195, 0.055)",
    specular: "rgba(160, 255, 220, 0.16)",
    hairline: "rgba(120, 230, 195, 0.14)",
    signal: "#FFC857",
    untested: "#46F0B1",
    good: "#46F0B1",
    // The part that is gone is 3:1 against a card, so a ring with nothing left is still a ring. It
    // was #153530, 1.15:1: spent out and ended both read as an empty slot.
    track: "#33756A",
    ring: { left: "#46F0B1", leftLow: "#FFC857", gone: "#33756A", goneLow: "#33756A", leftEnded: "#86A39B", goneEnded: "#4E6F67" },
    warn: "#FFC857",
    stop: "#FF8A78",
    actionFill: "#46F0B1",
    actionText: "#04130F",
    blurTint: "dark",
  },
};

/**
 * Graphite, the wallet's own look: near-black with a cool cast, ink in place of colour, so that the
 * only hue on screen is a network's, on its allowance cards. Quiet on purpose; what is unusual about
 * it is the type, the squared corners and the cards printed like key listings, not the colour.
 *
 * `muted` and `dim` are measured against `groundHigh`, the lightest stop, as the others are: about
 * 7.9:1 and 5.6:1.
 */
const cipher: Theme = {
  id: "cipher",
  name: "Graphite",
  note: "Ink on near-black; colour only for a network",
  color: {
    groundHigh: "#17191B",
    groundMid: "#0E1011",
    groundLow: "#07080A",
    paper: "#E6E8E6",
    muted: "#A9AEAD",
    dim: "#8E9392",
    glass: "rgba(230, 232, 230, 0.035)",
    specular: "rgba(255, 255, 255, 0.18)",
    hairline: "rgba(230, 232, 230, 0.12)",
    signal: "#E39B5B",
    untested: "#9DB3C4",
    good: "#7FC4A0",
    track: "#22262A",
    ring: { left: "#9DB3C4", leftLow: "#9DB3C4", gone: "#E6E8E6", goneLow: "#E39B5B", leftEnded: "#22262A", goneEnded: "#8E9392" },
    warn: "#E8B44A",
    stop: "#E8B44A",
    actionFill: "#E6E8E6",
    actionText: "#0B0C0D",
    blurTint: "dark",
  },
};

/** Warm charcoal, the web's own ground. Reads as equipment rather than software. */
const machine: Theme = {
  id: "machine",
  name: "Machine",
  note: "Warm charcoal, as on the web",
  color: {
    groundHigh: "#1F1D1A",
    groundMid: "#12110F",
    groundLow: "#0A0908",
    paper: "#EAE7DE",
    muted: "#B6AFA2",
    dim: "#999389",
    glass: "rgba(236, 232, 224, 0.045)",
    specular: "rgba(255, 252, 244, 0.30)",
    hairline: "rgba(236, 232, 224, 0.10)",
    signal: "#E8874A",
    untested: "#7AA6D8",
    good: "#6BBF8F",
    track: "#2A2824",
    ring: { left: "#7AA6D8", leftLow: "#7AA6D8", gone: "#EAE7DE", goneLow: "#E8874A", leftEnded: "#2A2824", goneEnded: "#999389" },
    warn: "#E8B44A",
    stop: "#E8B44A",
    actionFill: "#EAE7DE",
    actionText: "#12110F",
    blurTint: "dark",
  },
};

/**
 * Arc's own navy. Belongs to the ecosystem at a glance.
 *
 * The meaning colours are shared with Machine, lifted slightly to hold their contrast on navy. Arc
 * blue moves to the primary action, where it is identity rather than information — as a signal it
 * sat too close to `untested` to tell apart.
 */
const arc: Theme = {
  id: "arc",
  name: "Arc",
  note: "Deep navy, Arc blue actions",
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
    signal: "#F0925A",
    untested: "#8DB8EC",
    good: "#72C89A",
    track: "#1E3049",
    ring: { left: "#8DB8EC", leftLow: "#8DB8EC", gone: "#E6EEF9", goneLow: "#F0925A", leftEnded: "#1E3049", goneEnded: "#8DA4C2" },
    warn: "#E8B44A",
    stop: "#E8B44A",
    actionFill: "#5FBFFF",
    actionText: "#071019",
    blurTint: "dark",
  },
};

export const THEMES: readonly Theme[] = [pulse, cipher, machine, arc];
export const DEFAULT_THEME_ID: ThemeId = "pulse";

export function themeById(id: string | null): Theme {
  return THEMES.find((t) => t.id === id) ?? pulse;
}
