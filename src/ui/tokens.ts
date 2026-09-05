/**
 * Design tokens.
 *
 * Sizes, spacing, radii, opacity and colour go through here rather than being inlined in a
 * `StyleSheet`. It is easy to wave layout literals through as "just styling" — they are the
 * same magic numbers as anywhere else, and the second screen is where scattered values start
 * disagreeing with each other.
 */
export const tokens = {
  color: {
    background: "#0b0b0c",
    surface: "#151517",
    text: "#e8e8ea",
    textMuted: "#8a8a8f",
    textDim: "#a0a0a6",
    accent: "#1f6feb",
    danger: "#e5534b",
    onAccent: "#ffffff",
  },
  space: { xs: 6, md: 12, base: 16, lg: 20 },
  radius: { md: 10, lg: 12 },
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
