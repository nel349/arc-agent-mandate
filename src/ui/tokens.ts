/**
 * Structure. Everything here is the same in every theme.
 *
 * **Colour lives in `themes.ts`**, reached through `useTheme()`. The split is deliberate: a theme
 * that can change spacing or type size is a second layout in disguise, and the second one is
 * always the one nobody tested. A palette swaps; a layout does not.
 *
 * Sizes, spacing, radii and opacity go through here rather than being inlined in a `StyleSheet`.
 * It is easy to wave layout literals through as "just styling" — they are the same magic numbers
 * as anywhere else, and the second screen is where scattered values start disagreeing.
 */
export const tokens = {
  space: { xs: 6, sm: 10, md: 12, base: 16, lg: 20, xl: 28 },

  /**
   * Depth, cast downward. Glass sits above its background rather than being painted onto it, and
   * without a shadow the translucency reads as a lighter patch of the same plane.
   */
  shadow: {
    panel: {
      shadowColor: "#000000",
      shadowOpacity: 0.35,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 6,
    },
  },
  radius: {
    md: 10,
    lg: 16,
    /** Fully rounded. Large enough that any control shorter than it becomes a pill. */
    pill: 999,
  },
  border: { hairline: 1 },

  /**
   * Shared type roles. Typography is structure, not palette — the same label reads the same in
   * every theme, only its colour changes. Defined once here because it was defined five times
   * across the screens, and five copies of a rule is four chances to drift.
   */
  type: {
    label: {
      fontFamily: "Menlo",
      fontSize: 12,
      letterSpacing: 1,
      textTransform: "uppercase",
    },
  },

  size: {
    /**
     * The smallest comfortable touch target, per Apple's guidance. Anything a finger has to hit
     * gets at least this, including rows that look tall enough already — "tall enough" depends on
     * the content, and content changes.
     */
    tapTarget: 44,
  },
  opacity: { disabled: 0.4 },
  font: {
    mono: "Menlo",
    small: 11,
    smallLineHeight: 16,
    label: 12,
    labelTracking: 1,
    body: 13,
    title: 17,
    display: 32,
    /**
     * Figures that change while you watch them.
     *
     * The allowance re-reads the chain every ten seconds. With proportional digits each update
     * changes the number's width and the whole row twitches; tabular figures are all one width,
     * so only the glyphs change.
     */
    tabular: ["tabular-nums"],
  },
} as const;
