/**
 * Design tokens, on Arc's own palette.
 *
 * Colours taken from `docs.arc.io` rather than invented: `#3E74BB` is the primary they configure,
 * over the deep navy their docs use in dark mode. Matching the chain's brand is not decoration
 * here — this is an app whose whole argument is that it belongs to Arc's ecosystem, and looking
 * like it costs nothing.
 *
 * Sizes, spacing, radii and opacity go through here rather than being inlined in a `StyleSheet`.
 * It is easy to wave layout literals through as "just styling" — they are the same magic numbers
 * as anywhere else, and the second screen is where scattered values start disagreeing.
 */
export const tokens = {
  color: {
    /** Arc's dark canvas. */
    background: "#0D1B2F",
    surface: "#1F2F44",
    surfaceRaised: "#263A52",
    text: "#F5F5F8",
    /** Muted, but still blue — grey text on navy reads as a different product. */
    textMuted: "#8B9CC7",
    textDim: "#A7A3B5",
    /** Arc's configured primary. */
    accent: "#3E74BB",
    /** Their brighter blue, for the one thing on a screen that should pull the eye. */
    accentBright: "#5FBFFF",
    onAccent: "#FFFFFF",
    /** Arc's palette carries no red. Restrained on purpose: revoking is a normal, safe action,
     *  not an alarm, and colouring it like a warning would discourage the thing we want easy. */
    danger: "#E5837B",

    /**
     * Glass surfaces, after Netflix's mobile chrome: a translucent fill with a hairline light
     * edge, which reads as depth without a blur pass.
     *
     * Deliberately not `expo-blur`. Real blur earns its cost over imagery, and these screens are
     * flat colour — there is nothing behind a card to blur, so it would add a native dependency
     * to produce the same pixels.
     */
    glass: "rgba(255, 255, 255, 0.06)",
    glassRaised: "rgba(255, 255, 255, 0.10)",
    glassBorder: "rgba(255, 255, 255, 0.12)",
  },
  space: { xs: 6, md: 12, base: 16, lg: 20 },
  radius: {
    md: 10,
    lg: 16,
    /** Fully rounded. Large enough that any control shorter than it becomes a pill. */
    pill: 999,
  },
  border: { hairline: 1 },
  opacity: { disabled: 0.4 },
  font: {
    mono: "Menlo",
    small: 11,
    smallLineHeight: 16,
    label: 12,
    labelTracking: 1,
    body: 13,
    display: 28,
  },
} as const;
